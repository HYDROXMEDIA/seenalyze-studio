# Lists visible top-level windows front to back for the screen-recording
# picker, as JSON on stdout. Positions are physical desktop pixels.
param([int]$ExcludedPid)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class StudioWindows {
  public class Window { public long id; public int pid; public string app; public string title; public int x; public int y; public int width; public int height; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect value, int size);
  public static void EnableDpi() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }

  // The visible frame, without the invisible resize borders and shadow GetWindowRect includes.
  static bool FrameRect(IntPtr hwnd, out Rect rect) {
    if (DwmGetWindowAttribute(hwnd, 9, out rect, Marshal.SizeOf(typeof(Rect))) == 0 && rect.right > rect.left && rect.bottom > rect.top) return true;
    return GetWindowRect(hwnd, out rect);
  }

  public static List<Window> Windows(int excludedPid) {
    var result = new List<Window>();
    EnumWindows((hwnd, data) => {
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      Rect rect; var title = new StringBuilder(1024);
      if (pid == excludedPid || !IsWindowVisible(hwnd) || IsIconic(hwnd) || !FrameRect(hwnd, out rect) || GetWindowText(hwnd, title, title.Capacity) == 0) return true;
      if (rect.right <= rect.left || rect.bottom <= rect.top) return true;
      string name = "";
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      result.Add(new Window { id=hwnd.ToInt64(), pid=(int)pid, app=name, title=title.ToString(), x=rect.left, y=rect.top, width=rect.right-rect.left, height=rect.bottom-rect.top });
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
try {
  [StudioWindows]::EnableDpi()
  [Console]::WriteLine((@{ windows=@([StudioWindows]::Windows($ExcludedPid)) } | ConvertTo-Json -Compress -Depth 4))
} catch {
  [Console]::WriteLine('{"windows":[]}')
}
