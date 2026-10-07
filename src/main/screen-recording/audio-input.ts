import { execFile } from 'node:child_process';

// Opening a Bluetooth headset microphone switches its playback into call mode.
// Record with a local microphone instead, without changing the system output.
export async function recordingMicrophone(name: string | null): Promise<string | null> {
  if (name === null || process.platform !== 'darwin') return name;
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile('system_profiler', ['SPAudioDataType', '-json'], { timeout: 3000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    const data = JSON.parse(output) as { SPAudioDataType?: Array<{ _items?: Array<Record<string, unknown>> }> };
    const devices = data.SPAudioDataType?.flatMap((group) => group._items ?? []) ?? [];
    const input = name === 'default'
      ? devices.find((device) => device.coreaudio_default_audio_input_device === 'spaudio_yes')
      : devices.find((device) => device._name === name);
    if (!input) return null;
    if (input.coreaudio_device_transport !== 'coreaudio_device_type_bluetooth') return name;
    const inputs = devices.filter((device) => device.coreaudio_device_input === 1 && device.coreaudio_device_transport !== 'coreaudio_device_type_bluetooth');
    const replacement = inputs.find((device) => device.coreaudio_device_transport === 'coreaudio_device_type_builtin') ?? inputs[0];
    // Never silently open the headset when no safe microphone is available.
    return typeof replacement?._name === 'string' ? replacement._name : null;
  } catch {
    // An unknown route must not switch headphone playback into call mode.
    return null;
  }
}
