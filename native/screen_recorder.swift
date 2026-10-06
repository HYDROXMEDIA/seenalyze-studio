// Records the screen, a window, or an area to an MP4 with ScreenCaptureKit,
// leaving the pointer out of the picture so the editor can redraw it. Pointer
// movement, clicks, scrolling and shortcuts are reported on the video's clock.
// The microphone is written into the same file on the same clock.
//
// Usage:
//   screen-recorder --output PATH --fps N --width W --height H --rect X,Y,W,H
//                   (--display ID [--crop X,Y,W,H] | --window ID)
//                   [--mic default|NAME] [--camera default|NAME --camera-output PATH]
//                   [--exclude-pid PID]
//
// --rect is the recorded area in global points (top-left origin); positions
// are reported relative to it, from 0 to 1. For windows it follows the window.
//
// stdin commands, one per line: pause, resume, stop.
// stdout: one JSON object per line (t is milliseconds on the video clock):
//   {"type":"started"}                         first frame written
//   {"type":"input","clicks":bool}             whether clicks and keys are visible
//   {"type":"m","t","x","y"}                   pointer moved
//   {"type":"down"|"up","t","x","y","b"}       mouse button (0 left, 1 right, 2 other)
//   {"type":"scroll","t","x","y","dx","dy"}    scrolling
//   {"type":"typing","t"}                      a key was typed (never which one)
//   {"type":"shortcut","t","keys"}             a shortcut such as ⌘⇧S
//   {"type":"cursor","t","id",...}             pointer appearance changed
//   {"type":"finished"}                        file complete
//   {"type":"error","message"}

import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

struct Options {
    var output = ""
    var fps = 60
    var width = 0
    var height = 0
    var rect = CGRect.zero
    var displayId: CGDirectDisplayID?
    var windowId: CGWindowID?
    var crop: CGRect?
    var mic: String?
    var camera: String?
    var cameraOutput: String?
    var excludePid: pid_t?
    var systemAudio = false
    var systemAudioPid: pid_t?
}

let outputLock = NSLock()

// Set once the app stops reading; the recording is still finished properly.
var outputClosed = false

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    outputLock.lock()
    defer { outputLock.unlock() }
    guard !outputClosed else { return }
    // Plain writes: a closed pipe returns an error instead of ending the process.
    let bytes = Array(line.utf8)
    var written = 0
    while written < bytes.count {
        let result = bytes[written...].withUnsafeBufferPointer { Darwin.write(STDOUT_FILENO, $0.baseAddress, $0.count) }
        if result <= 0 {
            if result < 0 && errno == EINTR { continue }
            outputClosed = true
            return
        }
        written += result
    }
}

// Rounds for compact output (positions to 1/10000, times to 1/10 ms).
func rounded(_ value: Double, _ places: Double) -> NSDecimalNumber {
    NSDecimalNumber(value: (value * places).rounded() / places).rounding(accordingToBehavior: NSDecimalNumberHandler(
        roundingMode: .plain, scale: Int16(log10(places)), raiseOnExactness: false, raiseOnOverflow: false, raiseOnUnderflow: false, raiseOnDivideByZero: false))
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    exit(1)
}

func parseRect(_ value: String) -> CGRect? {
    let parts = value.split(separator: ",").compactMap { Double($0) }
    guard parts.count == 4, parts[2] > 0, parts[3] > 0 else { return nil }
    return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = CommandLine.arguments.dropFirst().makeIterator()
    while let flag = arguments.next() {
        guard let value = arguments.next() else { fail("Missing value for \(flag)") }
        switch flag {
        case "--output": options.output = value
        case "--fps": options.fps = min(240, max(1, Int(value) ?? 60))
        case "--width": options.width = Int(value) ?? 0
        case "--height": options.height = Int(value) ?? 0
        case "--display": options.displayId = CGDirectDisplayID(value)
        case "--window": options.windowId = CGWindowID(value)
        case "--mic": options.mic = value
        case "--system-audio": options.systemAudio = value == "1"
        case "--system-audio-pid": options.systemAudioPid = pid_t(value)
        case "--camera": options.camera = value
        case "--camera-output": options.cameraOutput = value
        case "--exclude-pid": options.excludePid = pid_t(value)
        case "--rect":
            guard let rect = parseRect(value) else { fail("Invalid rect") }
            options.rect = rect
        case "--crop":
            guard let rect = parseRect(value) else { fail("Invalid crop") }
            options.crop = rect
        default: fail("Unknown option \(flag)")
        }
    }
    guard !options.output.isEmpty, options.width >= 2, options.height >= 2, options.rect.width > 0,
          options.displayId != nil || options.windowId != nil else { fail("Missing options") }
    options.width -= options.width % 2
    options.height -= options.height % 2
    return options
}

func camera(named name: String) -> AVCaptureDevice? {
    if name == "default" { return AVCaptureDevice.default(for: .video) }
    let types: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) {
        types = [.builtInWideAngleCamera, .external, .continuityCamera]
    } else {
        types = [.builtInWideAngleCamera, .externalUnknown]
    }
    let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    return devices.first { $0.localizedName == name } ?? AVCaptureDevice.default(for: .video)
}

// Records the camera to its own file on the recording's clock, so the editor
// can place it over the screen and restyle it later.
final class CameraRecorder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "screen-recorder.camera")
    private let clock: VideoClock
    private let writer: AVAssetWriter
    private var input: AVAssetWriterInput?
    private var started = false
    private var stopping = false
    private var lastTime = CMTime.negativeInfinity

    init?(name: String, output: String, clock: VideoClock) {
        self.clock = clock
        let url = URL(fileURLWithPath: output)
        try? FileManager.default.removeItem(at: url)
        guard let device = camera(named: name), let deviceInput = try? AVCaptureDeviceInput(device: device),
              let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return nil }
        self.writer = writer
        super.init()
        session.beginConfiguration()
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
        let dataOutput = AVCaptureVideoDataOutput()
        dataOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        dataOutput.alwaysDiscardsLateVideoFrames = true
        guard session.canAddInput(deviceInput), session.canAddOutput(dataOutput) else { return nil }
        session.addInput(deviceInput)
        session.addOutput(dataOutput)
        session.commitConfiguration()
        dataOutput.setSampleBufferDelegate(self, queue: queue)
    }

    func start() {
        session.startRunning()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let time = hostTime(CMSampleBufferGetPresentationTimeStamp(buffer), from: session.synchronizationClock)
        guard !stopping, let start = clock.startTime, let offset = clock.shift(time), time - offset > lastTime, time - offset >= start,
              let image = CMSampleBufferGetImageBuffer(buffer) else { return }
        if !started {
            let width = CVPixelBufferGetWidth(image)
            let height = CVPixelBufferGetHeight(image)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width - width % 2,
                AVVideoHeightKey: height - height % 2,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 6_000_000,
                    AVVideoMaxKeyFrameIntervalKey: 30,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
                ]
            ])
            input.expectsMediaDataInRealTime = true
            guard writer.canAdd(input) else { return }
            writer.add(input)
            guard writer.startWriting() else { return }
            // Same start as the screen video, so camera and screen times match.
            writer.startSession(atSourceTime: start)
            self.input = input
            started = true
        }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: time - offset, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: buffer, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy)
        if let copy, let input, input.isReadyForMoreMediaData, input.append(copy) { lastTime = time - offset }
    }

    func finish(_ done: @escaping @Sendable () -> Void) {
        queue.async {
            self.stopping = true
            // Stopped away from its own delivery queue, which it waits on.
            let session = self.session
            DispatchQueue.global().async { session.stopRunning() }
            guard self.started, let input = self.input, self.writer.status == .writing else {
                // No usable camera video: the app is told, instead of finding a broken file.
                if self.writer.status == .writing { self.writer.cancelWriting() }
                emit(["type": "camera", "ok": false, "message": self.writer.error?.localizedDescription ?? "No camera picture was recorded"])
                done()
                return
            }
            input.markAsFinished()
            self.writer.finishWriting {
                if self.writer.status != .completed {
                    emit(["type": "camera", "ok": false, "message": self.writer.error?.localizedDescription ?? "The camera video could not be finished"])
                }
                done()
            }
        }
    }
}

func microphone(named name: String) -> AVCaptureDevice? {
    if name == "default" { return AVCaptureDevice.default(for: .audio) }
    let types: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) {
        types = [.microphone, .external]
    } else {
        types = [.builtInMicrophone, .externalUnknown]
    }
    let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .audio, position: .unspecified).devices
    return devices.first { $0.localizedName == name }
}

// Capture devices time their samples on their session's clock; the video
// clock uses host time, so device times are converted first.
func hostTime(_ time: CMTime, from clock: CMClock?) -> CMTime {
    guard let clock else { return time }
    return CMSyncConvertTime(time, from: clock, to: CMClockGetHostTimeClock())
}

// The video clock: host time since the first frame, without paused stretches.
// Read from the sample queue and from the input thread.
final class VideoClock: @unchecked Sendable {
    private let lock = NSLock()
    private var start: CMTime?
    private var pausedAt: CMTime?
    private var pausedTotal = CMTime.zero
    private var resumedAt = CMTime.zero

    static func now() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

    func begin(at time: CMTime) {
        lock.lock(); start = time; lock.unlock()
    }

    var startTime: CMTime? {
        lock.lock(); defer { lock.unlock() }
        return start
    }

    var started: Bool {
        lock.lock(); defer { lock.unlock() }
        return start != nil
    }

    func pause() {
        lock.lock(); if pausedAt == nil { pausedAt = VideoClock.now() }; lock.unlock()
    }

    func resume() {
        lock.lock()
        if let pausedAt {
            let now = VideoClock.now()
            pausedTotal = pausedTotal + (now - pausedAt)
            resumedAt = now
            self.pausedAt = nil
        }
        lock.unlock()
    }

    // Milliseconds on the video clock, or nil while paused or not started.
    func milliseconds() -> Double? {
        lock.lock(); defer { lock.unlock() }
        guard let start, pausedAt == nil else { return nil }
        return CMTimeGetSeconds(VideoClock.now() - pausedTotal - start) * 1000
    }

    // How much to move a sample back to remove paused stretches, read in one
    // step with the check; nil when the sample falls in a pause.
    func shift(_ time: CMTime) -> CMTime? {
        lock.lock(); defer { lock.unlock() }
        guard pausedAt == nil, time >= resumedAt else { return nil }
        return pausedTotal
    }

    // Milliseconds on the video clock at this moment, or at the pause if paused.
    func millisecondsIncludingPause() -> Double? {
        lock.lock(); defer { lock.unlock() }
        guard let start else { return nil }
        return CMTimeGetSeconds((pausedAt ?? VideoClock.now()) - pausedTotal - start) * 1000
    }

    var offset: CMTime {
        lock.lock(); defer { lock.unlock() }
        return pausedTotal
    }
}

// Watches the pointer and keyboard without changing any input.
final class InputWatcher: @unchecked Sendable {
    private let clock: VideoClock
    private var rect: CGRect
    private let rectLock = NSLock()
    private let windowId: CGWindowID?
    private var lastMove: (NSDecimalNumber, NSDecimalNumber)?
    private var tap: CFMachPort?
    private var timers: [DispatchSourceTimer] = []

    init(clock: VideoClock, rect: CGRect, windowId: CGWindowID?) {
        self.clock = clock
        self.rect = rect
        self.windowId = windowId
    }

    // Where the recorded picture sits in the video, as fractions of its size.
    // A recorded window that changes shape is fitted inside the fixed frame,
    // so it may no longer fill it.
    private var content = CGRect(x: 0, y: 0, width: 1, height: 1)

    func setContent(_ box: CGRect) {
        guard box.width > 0.01, box.height > 0.01 else { return }
        rectLock.lock(); content = box; rectLock.unlock()
    }

    private func normalized(_ point: CGPoint) -> (NSDecimalNumber, NSDecimalNumber) {
        rectLock.lock(); let area = rect; let box = content; rectLock.unlock()
        let x = box.minX + (point.x - area.minX) / area.width * box.width
        let y = box.minY + (point.y - area.minY) / area.height * box.height
        return (rounded(x, 10000), rounded(y, 10000))
    }

    private func time() -> NSDecimalNumber? {
        clock.milliseconds().map { rounded($0, 10) }
    }

    func start() {
        // Pointer position at 120 Hz; no permission is needed for this.
        let sampler = DispatchSource.makeTimerSource(queue: .main)
        sampler.schedule(deadline: .now(), repeating: .microseconds(8333))
        sampler.setEventHandler { [weak self] in self?.sample() }
        sampler.resume()
        timers.append(sampler)

        if let windowId {
            // Window recordings follow the window, so positions follow it too.
            let follower = DispatchSource.makeTimerSource(queue: .main)
            follower.schedule(deadline: .now(), repeating: .milliseconds(100))
            follower.setEventHandler { [weak self] in self?.followWindow(windowId) }
            follower.resume()
            timers.append(follower)
        }

        let types: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .scrollWheel, .keyDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, info in
            if let info {
                Unmanaged<InputWatcher>.fromOpaque(info).takeUnretainedValue().handle(type: type, event: event)
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: pointer)
        if let tap {
            let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        emit(["type": "input", "clicks": tap != nil])
    }

    func stop() {
        timers.forEach { $0.cancel() }
        timers.removeAll()
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
    }

    private func followWindow(_ windowId: CGWindowID) {
        guard let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]],
              let bounds = info.first?[kCGWindowBounds as String] as? NSDictionary,
              let frame = CGRect(dictionaryRepresentation: bounds), frame.width > 0, frame.height > 0 else { return }
        rectLock.lock(); rect = frame; rectLock.unlock()
    }

    private func sample() {
        guard let t = time(), let location = CGEvent(source: nil)?.location else { return }
        let point = normalized(location)
        if let lastMove, lastMove.0 == point.0, lastMove.1 == point.1 { return }
        lastMove = point
        emit(["type": "m", "t": t, "x": point.0, "y": point.1])
    }

    private func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        guard let t = time() else { return }
        let point = normalized(event.location)
        switch type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            emit(["type": "down", "t": t, "x": point.0, "y": point.1, "b": button(type)])
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            emit(["type": "up", "t": t, "x": point.0, "y": point.1, "b": button(type)])
        case .scrollWheel:
            let dx = event.getDoubleValueField(.scrollWheelEventPointDeltaAxis2)
            let dy = event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1)
            if dx != 0 || dy != 0 { emit(["type": "scroll", "t": t, "x": point.0, "y": point.1, "dx": rounded(dx, 10), "dy": rounded(dy, 10)]) }
        case .keyDown:
            if let keys = shortcutLabel(event) {
                if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 { emit(["type": "shortcut", "t": t, "keys": keys]) }
            } else {
                emit(["type": "typing", "t": t])
            }
        default:
            break
        }
    }

    private func button(_ type: CGEventType) -> Int {
        switch type {
        case .leftMouseDown, .leftMouseUp: return 0
        case .rightMouseDown, .rightMouseUp: return 1
        default: return 2
        }
    }

    private static let namedKeys: [Int64: String] = [
        36: "↩", 48: "⇥", 49: "Space", 51: "⌫", 53: "⎋", 117: "⌦", 115: "↖", 119: "↘", 116: "⇞", 121: "⇟",
        123: "←", 124: "→", 125: "↓", 126: "↑",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12"
    ]

    // A label like ⌘⇧S for key presses held with ⌘ or ⌃ (or ⌥ with a non-letter
    // key). Plain typing returns nil and is never identified.
    private func shortcutLabel(_ event: CGEvent) -> String? {
        let flags = event.flags
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let named = InputWatcher.namedKeys[code]
        let command = flags.contains(.maskCommand)
        let control = flags.contains(.maskControl)
        let option = flags.contains(.maskAlternate)
        guard command || control || (option && named != nil) else { return nil }
        var label = ""
        if control { label += "⌃" }
        if option { label += "⌥" }
        if flags.contains(.maskShift) { label += "⇧" }
        if command { label += "⌘" }
        if let named { return label + named }
        guard let characters = NSEvent(cgEvent: event)?.charactersIgnoringModifiers, let first = characters.first,
              !first.isWhitespace, first.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return label + String(first).uppercased()
    }
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let options: Options
    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private var audioInput: AVAssetWriterInput?
    private var systemAudioInput: AVAssetWriterInput?
    private var audioStream: SCStream?
    private var lastSystemAudioTime = CMTime.negativeInfinity
    private var stream: SCStream?
    private var audioSession: AVCaptureSession?
    private let queue = DispatchQueue(label: "screen-recorder.samples")
    private let clock = VideoClock()
    private let input: InputWatcher
    private var cameraRecorder: CameraRecorder?

    // Used on `queue`.
    private var sessionStart: CMTime?
    private var lastFrame: CMSampleBuffer?
    private var reportedFailure = false
    private var lastAudioTime = CMTime.negativeInfinity
    private var stopping = false
    // Pointer images seen so far, by a hash of their pixels. Animated pointers
    // can have many frames, so only the first ones get their own image.
    private var cursorIds: [Int: Int] = [:]
    private let maxCursorImages = 48
    private var lastCursor: Int?
    private var cursorTimer: DispatchSourceTimer?

    init(options: Options) {
        self.options = options
        input = InputWatcher(clock: clock, rect: options.rect, windowId: options.windowId)
        let url = URL(fileURLWithPath: options.output)
        try? FileManager.default.removeItem(at: url)
        do {
            writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        } catch {
            fail("The video file could not be created")
        }
        // Screen text needs a generous bitrate to stay crisp when zoomed in.
        let pixels = options.width * options.height
        let bitrate = min(80_000_000, max(8_000_000, pixels * options.fps / 5))
        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: options.width,
            AVVideoHeightKey: options.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoExpectedSourceFrameRateKey: options.fps,
                AVVideoMaxKeyFrameIntervalKey: options.fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        videoInput.expectsMediaDataInRealTime = true
        super.init()
        writer.add(videoInput)
    }

    func start() async {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            fail("Screen recording permission is missing")
        }

        let filter: SCContentFilter
        let configuration = SCStreamConfiguration()
        if let windowId = options.windowId {
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else { fail("Window unavailable") }
            filter = SCContentFilter(desktopIndependentWindow: window)
        } else {
            guard let display = content.displays.first(where: { $0.displayID == options.displayId }) else { fail("Display unavailable") }
            // Keep the app's own windows, like the recording controls and camera bubble, out of the video.
            let excluded = content.applications.filter { $0.processID == options.excludePid }
            filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
            if let crop = options.crop { configuration.sourceRect = crop }
        }
        configuration.width = options.width
        configuration.height = options.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(options.fps))
        configuration.showsCursor = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.colorSpaceName = CGColorSpace.sRGB
        configuration.queueDepth = 6
        configuration.scalesToFit = true

        if let name = options.mic { setUpMicrophone(name) }
        if let name = options.camera, let output = options.cameraOutput {
            cameraRecorder = CameraRecorder(name: name, output: output, clock: clock)
            emit(["type": "camera", "ok": cameraRecorder != nil])
        }

        if options.systemAudio {
            let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160000])
            audio.expectsMediaDataInRealTime = true
            if writer.canAdd(audio) { writer.add(audio); systemAudioInput = audio }
            if let pid = options.systemAudioPid {
                guard let application = content.applications.first(where: { $0.processID == pid }), let display = content.displays.first else { fail("The selected audio app is no longer available") }
                let audioConfiguration = SCStreamConfiguration(); audioConfiguration.width = 2; audioConfiguration.height = 2; audioConfiguration.capturesAudio = true; audioConfiguration.excludesCurrentProcessAudio = true; audioConfiguration.sampleRate = 48000; audioConfiguration.channelCount = 2
                let audioFilter = SCContentFilter(display: display, including: [application], exceptingWindows: [])
                let audioStream = SCStream(filter: audioFilter, configuration: audioConfiguration, delegate: self)
                do { try audioStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue); try await audioStream.startCapture(); self.audioStream = audioStream }
                catch { fail("System audio could not start") }
            } else {
                configuration.capturesAudio = true; configuration.excludesCurrentProcessAudio = true; configuration.sampleRate = 48000; configuration.channelCount = 2
            }
        }
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            if options.systemAudio && audioStream == nil { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
            try await stream.startCapture()
        } catch {
            fail("Screen capture could not start: \(error.localizedDescription)")
        }
        self.stream = stream
        audioSession?.startRunning()
        cameraRecorder?.start()
    }

    private func setUpMicrophone(_ name: String) {
        guard let device = microphone(named: name), let input = try? AVCaptureDeviceInput(device: device) else { return }
        let session = AVCaptureSession()
        let output = AVCaptureAudioDataOutput()
        guard session.canAddInput(input), session.canAddOutput(output) else { return }
        session.addInput(input)
        session.addOutput(output)
        output.setSampleBufferDelegate(self, queue: queue)
        let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 160_000
        ])
        audio.expectsMediaDataInRealTime = true
        guard writer.canAdd(audio) else { return }
        writer.add(audio)
        audioInput = audio
        audioSession = session
    }

    private func retimed(_ buffer: CMSampleBuffer, deviceClock: CMClock? = nil) -> CMSampleBuffer? {
        let original = CMSampleBufferGetPresentationTimeStamp(buffer)
        let converted = hostTime(original, from: deviceClock)
        guard let pausedOffset = clock.shift(converted) else { return nil }
        // Moves device time onto host time, then removes paused stretches.
        let offset = pausedOffset - (converted - original)
        let count = CMSampleBufferGetNumSamples(buffer)
        var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: max(1, count))
        var entries = 0
        guard CMSampleBufferGetSampleTimingInfoArray(buffer, entryCount: timing.count, arrayToFill: &timing, entriesNeededOut: &entries) == noErr,
              entries > 0 else { return nil }
        for index in 0..<min(entries, timing.count) {
            timing[index].presentationTimeStamp = timing[index].presentationTimeStamp - offset
            if timing[index].decodeTimeStamp.isValid {
                timing[index].decodeTimeStamp = timing[index].decodeTimeStamp - offset
            }
        }
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: buffer, sampleTimingEntryCount: min(entries, timing.count), sampleTimingArray: &timing, sampleBufferOut: &copy)
        return copy
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio {
            guard !stopping, let start = sessionStart, let input = systemAudioInput, let sample = retimed(buffer) else { return }
            let time = CMSampleBufferGetPresentationTimeStamp(sample)
            if time >= start && time > lastSystemAudioTime && input.isReadyForMoreMediaData && input.append(sample) { lastSystemAudioTime = time }
            return
        }
        guard type == .screen, !stopping, buffer.isValid else { return }
        // Only complete frames carry an image; idle frames mean nothing changed.
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete else { return }
        if options.windowId != nil, let info = attachments.first { noteContent(info) }
        guard let frame = retimed(buffer) else { return }
        // Times only move forward, even around a quick pause and resume.
        if let lastFrame, CMSampleBufferGetPresentationTimeStamp(frame) <= CMSampleBufferGetPresentationTimeStamp(lastFrame) { return }
        if sessionStart == nil {
            guard writer.startWriting() else { fail("The video file could not be written") }
            let start = CMSampleBufferGetPresentationTimeStamp(frame)
            writer.startSession(atSourceTime: start)
            sessionStart = start
            clock.begin(at: start)
            emit(["type": "started"])
            DispatchQueue.main.async {
                self.input.start()
                self.startCursorWatch()
            }
        }
        if videoInput.isReadyForMoreMediaData, videoInput.append(frame) { lastFrame = frame }
        if writer.status == .failed && !reportedFailure {
            reportedFailure = true
            // Recording on into a broken file helps no one: stop now and say why.
            finish(reason: writer.error?.localizedDescription ?? "The video could not be written")
        }
    }

    // Where a recorded window's picture sits in the frame. ScreenCaptureKit
    // reports it in points of the frame (pixels divided by the scale factor);
    // a window resized to another shape stays pinned to the top left.
    private func noteContent(_ info: [SCStreamFrameInfo: Any]) {
        guard let value = info[.contentRect], CFGetTypeID(value as CFTypeRef) == CFDictionaryGetTypeID(),
              let contentRect = CGRect(dictionaryRepresentation: value as! CFDictionary) else { return }
        let scale = (info[.scaleFactor] as? CGFloat).flatMap { $0 > 0 ? $0 : nil } ?? 1
        let width = CGFloat(options.width)
        let height = CGFloat(options.height)
        let box = CGRect(x: contentRect.minX * scale / width, y: contentRect.minY * scale / height,
                         width: contentRect.width * scale / width, height: contentRect.height * scale / height)
        guard box.maxX <= 1.01, box.maxY <= 1.01 else { return }
        input.setContent(box)
    }

    // The screen sends no frames while nothing changes, so the last picture is
    // repeated at the stop moment to keep the video as long as the recording.
    private func holdLastFrame() {
        guard let lastFrame, let start = sessionStart, let elapsed = clock.millisecondsIncludingPause() else { return }
        let end = start + CMTime(seconds: elapsed / 1000, preferredTimescale: 600)
        guard end > CMSampleBufferGetPresentationTimeStamp(lastFrame) + CMTime(value: 1, timescale: 120) else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: end, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: lastFrame, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy)
        if let copy, videoInput.isReadyForMoreMediaData { videoInput.append(copy) }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !stopping, let start = sessionStart, let audioInput, let sample = retimed(buffer, deviceClock: audioSession?.synchronizationClock) else { return }
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        guard time >= start, time > lastAudioTime, audioInput.isReadyForMoreMediaData else { return }
        if audioInput.append(sample) { lastAudioTime = time }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.finish(reason: error.localizedDescription) }
    }

    // Reports the pointer's look (arrow, hand, text beam...) whenever it changes.
    private func startCursorWatch() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(33))
        timer.setEventHandler { [weak self] in
            guard let self, let cursor = NSCursor.currentSystem else { return }
            let image = cursor.image
            guard let tiff = image.tiffRepresentation else { return }
            let hotSpot = cursor.hotSpot
            self.queue.async { self.noteCursor(tiff: tiff, size: image.size, hotSpot: hotSpot) }
        }
        timer.resume()
        cursorTimer = timer
    }

    private func noteCursor(tiff: Data, size: NSSize, hotSpot: NSPoint) {
        guard let time = clock.milliseconds() else { return }
        let t = rounded(time, 10)
        let key = tiff.hashValue
        if let id = cursorIds[key] {
            if id != lastCursor {
                lastCursor = id
                emit(["type": "cursor", "t": t, "id": id])
            }
            return
        }
        guard cursorIds.count < maxCursorImages,
              let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { return }
        let id = cursorIds.count
        cursorIds[key] = id
        lastCursor = id
        emit([
            "type": "cursor", "t": t, "id": id,
            "png": png.base64EncodedString(),
            "w": size.width, "h": size.height, "hx": hotSpot.x, "hy": hotSpot.y
        ])
    }

    func handle(command: String) {
        switch command {
        case "pause": clock.pause()
        case "resume": clock.resume()
        case "stop": queue.async { self.finish(reason: nil) }
        default: break
        }
    }

    private func finish(reason: String?) {
        guard !stopping else { return }
        holdLastFrame()
        stopping = true
        DispatchQueue.main.async {
            self.cursorTimer?.cancel()
            self.input.stop()
        }
        if let audioSession { DispatchQueue.global().async { audioSession.stopRunning() } }
        let stream = self.stream
        let cameraRecorder = self.cameraRecorder
        Task {
            try? await stream?.stopCapture()
            try? await self.audioStream?.stopCapture()
            if let cameraRecorder {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    cameraRecorder.finish { continuation.resume() }
                }
            }
            self.queue.async {
                guard self.sessionStart != nil, self.writer.status == .writing else {
                    let message = self.sessionStart == nil ? "Nothing was recorded" : self.writer.error?.localizedDescription ?? "The video could not be written"
                    if self.writer.status == .writing { self.writer.cancelWriting() }
                    fail(reason ?? message)
                }
                self.videoInput.markAsFinished()
                self.audioInput?.markAsFinished()
                self.systemAudioInput?.markAsFinished()
                self.writer.finishWriting {
                    if self.writer.status == .completed {
                        emit(["type": "recorded"])
                        Task {
                            if self.systemAudioInput != nil && self.audioInput != nil { await mixRecordedAudio(at: URL(fileURLWithPath: self.options.output)) }
                            emit(["type": "finished"]); exit(0)
                        }
                        return
                    }
                    fail(self.writer.error?.localizedDescription ?? "The video could not be finished")
                }
            }
        }
    }
}

func mixRecordedAudio(at url: URL) async {
    let asset = AVURLAsset(url: url)
    guard let tracks = try? await asset.loadTracks(withMediaType: .audio), tracks.count > 1,
          let duration = try? await asset.load(.duration) else { return }
    let temporaryName = ".studio-mix-\(UUID().uuidString)"
    let audioURL = url.deletingLastPathComponent().appendingPathComponent(temporaryName + ".m4a"); let mergedURL = url.deletingLastPathComponent().appendingPathComponent(temporaryName + ".mp4")
    defer { try? FileManager.default.removeItem(at: audioURL); try? FileManager.default.removeItem(at: mergedURL) }
    let range = CMTimeRange(start: .zero, duration: duration)
    let composition = AVMutableComposition(); let mix = AVMutableAudioMix(); var params: [AVAudioMixInputParameters] = []
    do {
        for source in tracks {
            guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { return }
            try track.insertTimeRange(range, of: source, at: .zero)
            let parameter = AVMutableAudioMixInputParameters(track: track); parameter.setVolume(0.7, at: .zero); params.append(parameter)
        }
        mix.inputParameters = params
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else { return }
        export.outputURL = audioURL; export.outputFileType = .m4a; export.audioMix = mix
        await export.export(); guard export.status == .completed else { return }
        let result = AVMutableComposition()
        for source in try await asset.loadTracks(withMediaType: .video) { let track = result.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid); try track?.insertTimeRange(range, of: source, at: .zero) }
        if let source = try await AVURLAsset(url: audioURL).loadTracks(withMediaType: .audio).first { let track = result.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid); try track?.insertTimeRange(range, of: source, at: .zero) }
        guard let merge = AVAssetExportSession(asset: result, presetName: AVAssetExportPresetPassthrough) else { return }
        merge.outputURL = mergedURL; merge.outputFileType = .mp4; await merge.export()
        if merge.status == .completed { _ = try FileManager.default.replaceItemAt(url, withItemAt: mergedURL) }
    } catch { /* Preserve the valid original tracks if mixing cannot finish. */ }
}

let recorder = Recorder(options: parseOptions())
signal(SIGPIPE, SIG_IGN)

Thread.detachNewThread {
    while let line = readLine() {
        recorder.handle(command: line.trimmingCharacters(in: .whitespaces))
    }
    // The app went away: keep what was recorded.
    recorder.handle(command: "stop")
}

Task {
    await recorder.start()
}

NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
