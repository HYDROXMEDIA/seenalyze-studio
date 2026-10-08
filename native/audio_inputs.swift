// Lists audio input devices with their connection type, so the studio can
// avoid opening a Bluetooth headset's microphone when the user picked the
// system default (opening it switches the headset to its call mode, which
// lowers and degrades everything it plays).
//   audio-inputs  ->  {"inputs":[{"uid","name","transport","isDefault"}]}
import Foundation
import CoreAudio

func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ initial: T) -> T? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    var value = initial
    var size = UInt32(MemoryLayout<T>.size)
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
    return status == noErr ? value : nil
}

func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    guard let value: Unmanaged<CFString> = property(object, selector, Unmanaged.passUnretained("" as CFString)) else { return nil }
    return value.takeRetainedValue() as String
}

func hasInput(_ device: AudioObjectID) -> Bool {
    var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr && size > 0
}

func transportName(_ value: UInt32) -> String {
    switch value {
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
    case kAudioDeviceTransportTypeBuiltIn: return "builtIn"
    case kAudioDeviceTransportTypeUSB: return "usb"
    case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate: return "virtual"
    default: return "other"
    }
}

let system = AudioObjectID(kAudioObjectSystemObject)
var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0
var devices: [AudioObjectID] = []
if AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr {
    devices = Array(repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    if AudioObjectGetPropertyData(system, &address, 0, nil, &size, &devices) != noErr { devices = [] }
}
let defaultInput: AudioObjectID = property(system, kAudioHardwarePropertyDefaultInputDevice, AudioObjectID(0)) ?? 0

var inputs: [[String: Any]] = []
for device in devices where hasInput(device) {
    guard let uid = string(device, kAudioDevicePropertyDeviceUID) else { continue }
    let transport: UInt32 = property(device, kAudioDevicePropertyTransportType, UInt32(0)) ?? 0
    inputs.append(["uid": uid, "name": string(device, kAudioObjectPropertyName) ?? "", "transport": transportName(transport), "isDefault": device == defaultInput])
}
if let data = try? JSONSerialization.data(withJSONObject: ["inputs": inputs]) { FileHandle.standardOutput.write(data) }
