// Lists on-screen app windows front to back for the screen-recording picker,
// as JSON on stdout. Positions are global points with a top-left origin.
//   window-list EXCLUDED_PID
import AppKit

let excludedPid = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? -1 : -1
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let entries = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

var windows: [[String: Any]] = []
for entry in entries {
    let layer = entry[kCGWindowLayer as String] as? Int ?? 0
    let alpha = entry[kCGWindowAlpha as String] as? Double ?? 1
    let processId = entry[kCGWindowOwnerPID as String] as? Int ?? 0
    guard layer == 0, alpha > 0.01, processId != excludedPid else { continue }
    guard let boundsValue = entry[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: boundsValue as CFDictionary),
          bounds.width >= 40,
          bounds.height >= 24 else { continue }
    windows.append([
        "id": entry[kCGWindowNumber as String] as? Int ?? 0,
        "pid": processId,
        "app": entry[kCGWindowOwnerName as String] as? String ?? "",
        "title": entry[kCGWindowName as String] as? String ?? "",
        "x": Double(bounds.origin.x),
        "y": Double(bounds.origin.y),
        "width": Double(bounds.width),
        "height": Double(bounds.height)
    ])
}

let data = (try? JSONSerialization.data(withJSONObject: ["windows": windows])) ?? Data("{\"windows\":[]}".utf8)
FileHandle.standardOutput.write(data)
