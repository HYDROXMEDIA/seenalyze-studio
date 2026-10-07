// Writes an MP4 from H.264 frames that were already encoded (passed through
// unchanged) and raw audio (encoded here to AAC).
//
// Usage:
//   video-muxer --output PATH --width W --height H --fps N [--sample-rate R --channels C]
//
// stdin: messages of [1-byte type][4-byte little-endian length][payload]:
//   C  avcC decoder configuration (must come first)
//   V  8-byte presentation time (µs), 8-byte duration (µs), 1-byte key flag, then the frame (length-prefixed NAL units)
//   A  interleaved 32-bit float samples
//   E  end of input
// stdout: {"type":"finished"} or {"type":"error","message":"..."}

import AVFoundation
import CoreMedia
import Foundation

// Plain writes: a closed pipe (the app went away) returns an error instead of
// ending the process.
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    let bytes = Array((line + "\n").utf8)
    var written = 0
    while written < bytes.count {
        let result = bytes[written...].withUnsafeBufferPointer { Darwin.write(STDOUT_FILENO, $0.baseAddress, $0.count) }
        if result <= 0 {
            if result < 0 && errno == EINTR { continue }
            return
        }
        written += result
    }
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    exit(1)
}

struct Options {
    var output = ""
    var width = 0
    var height = 0
    var fps = 60
    var sampleRate = 0
    var channels = 0
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = CommandLine.arguments.dropFirst().makeIterator()
    while let flag = arguments.next() {
        guard let value = arguments.next() else { fail("Missing value for \(flag)") }
        switch flag {
        case "--output": options.output = value
        case "--width": options.width = Int(value) ?? 0
        case "--height": options.height = Int(value) ?? 0
        case "--fps": options.fps = Int(value) ?? 60
        case "--sample-rate": options.sampleRate = Int(value) ?? 0
        case "--channels": options.channels = Int(value) ?? 0
        default: fail("Unknown option \(flag)")
        }
    }
    guard !options.output.isEmpty, options.width > 0, options.height > 0 else { fail("Missing options") }
    return options
}

// Reads exactly `count` bytes from stdin, or nil at end of input.
func readExactly(_ count: Int) -> Data? {
    var data = Data()
    while data.count < count {
        guard let chunk = try? FileHandle.standardInput.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

extension Data {
    func littleEndian<T: FixedWidthInteger>(_ type: T.Type, at offset: Int) -> T {
        var value: T = 0
        _ = Swift.withUnsafeMutableBytes(of: &value) { copyBytes(to: $0, from: offset..<(offset + MemoryLayout<T>.size)) }
        return T(littleEndian: value)
    }
}

// Builds the video format from avcC: SPS and PPS parameter sets and the NAL length size.
func videoFormat(avcC: Data, width: Int, height: Int) -> CMVideoFormatDescription {
    let bytes = [UInt8](avcC)
    guard bytes.count > 6 else { fail("Invalid video configuration") }
    let lengthSize = Int32((bytes[4] & 0x03) + 1)
    var sets: [[UInt8]] = []
    var at = 5
    let spsCount = Int(bytes[at] & 0x1f)
    at += 1
    for _ in 0..<spsCount {
        guard at + 2 <= bytes.count else { fail("Invalid video configuration") }
        let length = Int(bytes[at]) << 8 | Int(bytes[at + 1])
        guard at + 2 + length <= bytes.count else { fail("Invalid video configuration") }
        sets.append(Array(bytes[(at + 2)..<(at + 2 + length)]))
        at += 2 + length
    }
    guard at < bytes.count else { fail("Invalid video configuration") }
    let ppsCount = Int(bytes[at])
    at += 1
    for _ in 0..<ppsCount {
        guard at + 2 <= bytes.count else { fail("Invalid video configuration") }
        let length = Int(bytes[at]) << 8 | Int(bytes[at + 1])
        guard at + 2 + length <= bytes.count else { fail("Invalid video configuration") }
        sets.append(Array(bytes[(at + 2)..<(at + 2 + length)]))
        at += 2 + length
    }
    var format: CMVideoFormatDescription?
    let status = sets.withUnsafeBufferPointers { pointers, sizes in
        CMVideoFormatDescriptionCreateFromH264ParameterSets(
            allocator: kCFAllocatorDefault, parameterSetCount: sets.count, parameterSetPointers: pointers,
            parameterSetSizes: sizes, nalUnitHeaderLength: lengthSize, formatDescriptionOut: &format)
    }
    guard status == noErr, let format else { fail("Invalid video configuration") }
    return format
}

extension Array where Element == [UInt8] {
    func withUnsafeBufferPointers<R>(_ body: (UnsafePointer<UnsafePointer<UInt8>>, UnsafePointer<Int>) -> R) -> R {
        let copies = map { bytes -> UnsafeMutablePointer<UInt8> in
            let pointer = UnsafeMutablePointer<UInt8>.allocate(capacity: bytes.count)
            pointer.initialize(from: bytes, count: bytes.count)
            return pointer
        }
        defer { copies.forEach { $0.deallocate() } }
        let pointers = copies.map { UnsafePointer($0) }
        let sizes = map { $0.count }
        return pointers.withUnsafeBufferPointer { pointerBuffer in
            sizes.withUnsafeBufferPointer { sizeBuffer in body(pointerBuffer.baseAddress!, sizeBuffer.baseAddress!) }
        }
    }
}

func blockBuffer(_ data: Data) -> CMBlockBuffer {
    var block: CMBlockBuffer?
    guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: data.count,
                                             blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
                                             dataLength: data.count, flags: 0, blockBufferOut: &block) == noErr, let block else {
        fail("Out of memory")
    }
    data.withUnsafeBytes { raw in
        _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count)
    }
    return block
}

// Samples wait in a queue per track; each track takes them whenever the writer
// is ready for it. The writer keeps tracks interleaved, so it may hold one
// track back until the other catches up; reading input never waits on that.
final class TrackFeed: @unchecked Sendable {
    let input: AVAssetWriterInput
    private let queue: DispatchQueue
    private let lock = NSCondition()
    private var pending: [CMSampleBuffer] = []
    private var finished = false
    private(set) var done = false

    init(input: AVAssetWriterInput, label: String) {
        self.input = input
        queue = DispatchQueue(label: label)
    }

    func start(_ writer: AVAssetWriter) {
        self.writer = writer
        input.requestMediaDataWhenReady(on: queue) { [self] in drain() }
    }

    private var writer: AVAssetWriter?

    // Hands waiting samples to the writer while it takes them. Runs on `queue`,
    // both when the writer asks for more and whenever a sample is added.
    private func drain() {
        while input.isReadyForMoreMediaData {
            lock.lock()
            if pending.isEmpty {
                if finished && !done {
                    done = true
                    input.markAsFinished()
                    lock.broadcast()
                }
                lock.unlock()
                return
            }
            let sample = pending.removeFirst()
            lock.broadcast()
            lock.unlock()
            if !input.append(sample) { fail(writer?.error?.localizedDescription ?? "The video could not be written") }
        }
    }

    var count: Int {
        lock.lock(); defer { lock.unlock() }
        return pending.count
    }

    func add(_ sample: CMSampleBuffer) {
        lock.lock(); pending.append(sample); lock.unlock()
        queue.async { [self] in drain() }
    }

    func finish() {
        lock.lock(); finished = true; lock.unlock()
        // Nudge the writer in case it is idle with nothing left.
        queue.async { [self] in
            lock.lock()
            if pending.isEmpty && !done {
                done = true
                input.markAsFinished()
                lock.broadcast()
            }
            lock.unlock()
        }
    }

    func waitUntilDone(_ writer: AVAssetWriter) {
        lock.lock()
        while !done {
            if writer.status == .failed {
                lock.unlock()
                fail(writer.error?.localizedDescription ?? "The video could not be written")
            }
            _ = lock.wait(until: Date().addingTimeInterval(0.1))
        }
        lock.unlock()
    }
}

// Keeps memory bounded: reading pauses while many samples are waiting.
let maxPending = 360
// Keeps reading while any track is empty, since the writer may be waiting
// for that track before it takes more of the others.
func throttle(_ feeds: [TrackFeed?], _ writer: AVAssetWriter) {
    let active = feeds.compactMap { $0 }
    // Never waits while a track is empty: the writer may be holding the others
    // back until that track gets more or is ended by the "E" message, which
    // only arrives if input keeps being read. (The app sends sound for the
    // whole video, so no track runs dry early.)
    while active.reduce(0, { $0 + $1.count }) > maxPending && active.allSatisfy({ $0.count > 0 }) {
        if writer.status == .failed { fail(writer.error?.localizedDescription ?? "The video could not be written") }
        usleep(1000)
    }
}

let options = parseOptions()
let url = URL(fileURLWithPath: options.output)
try? FileManager.default.removeItem(at: url)
guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { fail("The video file could not be created") }
writer.shouldOptimizeForNetworkUse = true

var videoInput: AVAssetWriterInput?
var videoFeed: TrackFeed?
var audioFeed: TrackFeed?
var videoFormatDescription: CMVideoFormatDescription?
var audioInput: AVAssetWriterInput?
var audioFormat: CMAudioFormatDescription?
var audioFrames: Int64 = 0
// Sound that arrives before the first video frame sets up the file waits here.
var earlyAudio: [Data] = []

if options.sampleRate > 0, options.channels > 0 {
    var description = AudioStreamBasicDescription(
        mSampleRate: Float64(options.sampleRate), mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: UInt32(4 * options.channels), mFramesPerPacket: 1,
        mBytesPerFrame: UInt32(4 * options.channels), mChannelsPerFrame: UInt32(options.channels),
        mBitsPerChannel: 32, mReserved: 0)
    CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &description, layoutSize: 0, layout: nil,
                                   magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &audioFormat)
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: options.sampleRate,
        AVNumberOfChannelsKey: options.channels,
        AVEncoderBitRateKey: options.channels > 1 ? 256_000 : 160_000
    ])
    input.expectsMediaDataInRealTime = false
    audioInput = input
}

func startIfNeeded(avcC: Data) {
    guard videoInput == nil else { return }
    let format = videoFormat(avcC: avcC, width: options.width, height: options.height)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: format)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { fail("The video could not be written") }
    writer.add(input)
    if let audioInput {
        if writer.canAdd(audioInput) {
            writer.add(audioInput)
        } else {
            // Without an audio track the sound is left out rather than failing.
            audioFormat = nil
        }
    }
    guard writer.startWriting() else { fail(writer.error?.localizedDescription ?? "The video could not be written") }
    writer.startSession(atSourceTime: .zero)
    videoInput = input
    videoFormatDescription = format
    videoFeed = TrackFeed(input: input, label: "video-muxer.video")
    videoFeed?.start(writer)
    if let audioInput, audioFormat != nil {
        audioFeed = TrackFeed(input: audioInput, label: "video-muxer.audio")
        audioFeed?.start(writer)
    }
    let waiting = earlyAudio
    earlyAudio.removeAll()
    for payload in waiting { appendAudio(payload) }
}

func appendVideo(_ payload: Data) {
    guard let input = videoInput, let format = videoFormatDescription, payload.count > 17 else { fail("Video frame before configuration") }
    let pts = payload.littleEndian(Int64.self, at: 0)
    let duration = payload.littleEndian(Int64.self, at: 8)
    let key = payload[payload.startIndex + 16] != 0
    let frame = payload.subdata(in: (payload.startIndex + 17)..<payload.endIndex)
    var timing = CMSampleTimingInfo(
        duration: CMTime(value: duration, timescale: 1_000_000),
        presentationTimeStamp: CMTime(value: pts, timescale: 1_000_000),
        decodeTimeStamp: .invalid)
    var size = frame.count
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: blockBuffer(frame), formatDescription: format,
                                    sampleCount: 1, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
                                    sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr, let sample else {
        fail("A video frame could not be written")
    }
    if !key, let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
        let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
        CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_NotSync).toOpaque(),
                             Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    _ = input
    videoFeed?.add(sample)
    throttle([videoFeed, audioFeed], writer)
}

func appendAudio(_ payload: Data) {
    guard let input = audioInput, let format = audioFormat, !payload.isEmpty else { return }
    guard videoInput != nil else {
        earlyAudio.append(payload)
        return
    }
    let frames = payload.count / (4 * options.channels)
    guard frames > 0 else { return }
    var sample: CMSampleBuffer?
    let time = CMTime(value: audioFrames, timescale: CMTimeScale(options.sampleRate))
    guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: kCFAllocatorDefault, dataBuffer: blockBuffer(payload), formatDescription: format,
        sampleCount: frames, presentationTimeStamp: time, packetDescriptions: nil, sampleBufferOut: &sample) == noErr, let sample else {
        fail("Sound could not be written")
    }
    audioFrames += Int64(frames)
    _ = input
    audioFeed?.add(sample)
    throttle([videoFeed, audioFeed], writer)
}

signal(SIGPIPE, SIG_IGN)
readLoop: while let header = readExactly(5) {
    let type = header[header.startIndex]
    let length = Int(header.littleEndian(UInt32.self, at: 1))
    guard let payload = length == 0 ? Data() : readExactly(length) else { break }
    switch type {
    case UInt8(ascii: "C"): startIfNeeded(avcC: payload)
    case UInt8(ascii: "V"): appendVideo(payload)
    case UInt8(ascii: "A"): appendAudio(payload)
    case UInt8(ascii: "E"): break readLoop
    default: fail("Unknown message")
    }
}

guard videoInput != nil, let videoFeed else {
    writer.cancelWriting()
    fail("Nothing was exported")
}
videoFeed.finish()
audioFeed?.finish()
videoFeed.waitUntilDone(writer)
audioFeed?.waitUntilDone(writer)
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
// Making the file quick to start streaming leaves a temporary copy
// ("<name>.sb-…") behind when the process ends right away; remove it.
func removeLeftovers() {
    let directory = url.deletingLastPathComponent()
    let prefix = url.lastPathComponent + ".sb-"
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    for name in names where name.hasPrefix(prefix) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }
}

removeLeftovers()
if writer.status == .completed {
    emit(["type": "finished"])
    exit(0)
}
fail(writer.error?.localizedDescription ?? "The video could not be finished")
