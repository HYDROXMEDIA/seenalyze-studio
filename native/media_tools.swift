// Prepares a recording's sound for local captions: decodes it to 16 kHz mono
// and splits it at pauses into short WAV parts, reported with their times.
//   media-tools audio INPUT OUTPUT_FOLDER
import Foundation
import AVFoundation

func reply(_ value: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(data) }
    exit(0)
}
func wav(_ bytes: Data) -> Data {
    var result = Data()
    func string(_ value: String) { result.append(value.data(using: .ascii)!) }
    func number<T: FixedWidthInteger>(_ value: T) { var value = value.littleEndian; withUnsafeBytes(of: &value) { result.append(contentsOf: $0) } }
    string("RIFF"); number(UInt32(bytes.count + 36)); string("WAVEfmt "); number(UInt32(16)); number(UInt16(1)); number(UInt16(1)); number(UInt32(16000)); number(UInt32(32000)); number(UInt16(2)); number(UInt16(16)); string("data"); number(UInt32(bytes.count)); result.append(bytes)
    return result
}

// Reads the audio tracks and length with the asynchronous loaders, waiting here.
func loadAudio(_ asset: AVURLAsset) -> ([AVAssetTrack], Double) {
    final class Box: @unchecked Sendable { var tracks: [AVAssetTrack] = []; var duration = Double.nan }
    let box = Box(); let done = DispatchSemaphore(value: 0)
    Task {
        box.tracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []
        box.duration = (try? await asset.load(.duration))?.seconds ?? .nan
        done.signal()
    }
    done.wait()
    return (box.tracks, box.duration)
}

guard CommandLine.arguments.count >= 3 else { reply(["error": "Choose a media file."]) }
let mode = CommandLine.arguments[1]
let input = URL(fileURLWithPath: CommandLine.arguments[2])
if mode == "audio" {
    guard CommandLine.arguments.count >= 4 else { reply(["error": "Choose an output folder."]) }
    let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    let asset = AVURLAsset(url: input)
    let (tracks, duration) = loadAudio(asset)
    guard !tracks.isEmpty else { reply(["error": "This file has no audio track."]) }
    guard duration.isFinite && duration <= 21600 else { reply(["error": "This media file is too long."]) }
    do {
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let reader = try AVAssetReader(asset: asset)
        let audio = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false])
        guard reader.canAdd(audio) else { reply(["error": "This audio format is unavailable."]) }
        reader.add(audio); guard reader.startReading() else { reply(["error": "This audio could not be decoded."]) }
        var chunks: [[String: Any]] = []; var segment = Data(); var start = 0.0; var nextTime = 0.0; var quietSamples = 0; var peak = 0
        func save() throws {
            guard !segment.isEmpty else { return }
            let length = Double(segment.count) / 32000
            if peak < 16 { segment = Data(); start += length; quietSamples = 0; peak = 0; return }
            let path = output.appendingPathComponent("part-\(chunks.count).wav")
            try wav(segment).write(to: path, options: .atomic)
            chunks.append(["path": path.path, "start": start, "end": start + length]); segment = Data(); start += length; quietSamples = 0; peak = 0
        }
        while let sample = audio.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var bytes = Data(count: length)
            let status = bytes.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
            guard status == kCMBlockBufferNoErr else { throw NSError(domain: "Audio", code: 1) }
            let presentation = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            if presentation.isFinite && (nextTime == 0 || abs(presentation - nextTime) > 0.1) { try save(); start = max(start, max(0, presentation)) }
            nextTime = (presentation.isFinite ? presentation : nextTime) + Double(length) / 32000
            for index in stride(from: 0, to: bytes.count - 1, by: 2) {
                segment.append(bytes[index]); segment.append(bytes[index + 1])
                let level = abs(Int(Int16(bitPattern: UInt16(bytes[index]) | UInt16(bytes[index + 1]) << 8)))
                peak = max(peak, level)
                quietSamples = level < 280 ? quietSamples + 1 : 0
                if segment.count >= 192000 || (segment.count >= 48000 && quietSamples >= 4000) { try save() }
            }
        }
        _ = nextTime
        guard reader.status == .completed else { reply(["error": "Audio decoding was interrupted."]) }
        try save(); reply(["chunks": chunks])
    } catch { reply(["error": "The media file could not be prepared."]) }
}
reply(["error": "Unknown media action."])
