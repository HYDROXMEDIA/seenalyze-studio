param([string]$Mode, [string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-Result($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}
function Await-Progress($Operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod([double]).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}
try {
  [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] > $null
  $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($InputPath)) ([Windows.Storage.StorageFile])
  if ($Mode -eq 'audio') {
    [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType=WindowsRuntime] > $null
    [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType=WindowsRuntime] > $null
    [Windows.Storage.StorageFolder, Windows.Storage, ContentType=WindowsRuntime] > $null
    [void][IO.Directory]::CreateDirectory($OutputPath)
    $folder = Await-Result ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($OutputPath)) ([Windows.Storage.StorageFolder])
    $target = Await-Result ($folder.CreateFileAsync('decoded.wav', [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
    $profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
    $profile.Audio.SampleRate = 16000; $profile.Audio.ChannelCount = 1; $profile.Audio.BitsPerSample = 16; $profile.Audio.Subtype = 'PCM'; $profile.Audio.Bitrate = 256000
    $transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
    $prepared = Await-Result ($transcoder.PrepareFileTranscodeAsync($file, $target, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
    if (!$prepared.CanTranscode) { throw 'This media format cannot be decoded on this device.' }
    Await-Progress ($prepared.TranscodeAsync())
    $stream=[IO.File]::OpenRead($target.Path); $reader=[IO.BinaryReader]::new($stream)
    Add-Type -TypeDefinition 'public static class InputAudioSignal { public static bool HasSignal(byte[] values) { for (int i=0; i+1<values.Length; i+=2) { short sample=(short)(values[i] | (values[i+1]<<8)); if (sample>15 || sample<-15) return true; } return false; } }'
    $chunks=@(); $partSize=192000
    try {
      if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') { throw 'Invalid audio file.' }
      [void]$reader.ReadUInt32()
      if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') { throw 'Invalid audio file.' }
      $audioSize=$null
      while ($stream.Position + 8 -le $stream.Length) {
        $name=[Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)); $size=$reader.ReadUInt32()
        if ($stream.Position + $size -gt $stream.Length) { throw 'The audio file is incomplete.' }
        if ($name -eq 'data') { $audioSize=$size; break }
        [void]$stream.Seek($size+($size%2),[IO.SeekOrigin]::Current)
      }
      if ($null -eq $audioSize) { throw 'The file has no audio data.' }
      if ($audioSize -gt 21600*32000 -or $audioSize%2 -ne 0) { throw 'This media file is too long.' }
      for ($at=0; $at -lt $audioSize; $at+=$partSize) {
        $length=[Math]::Min($partSize,$audioSize-$at); $audio=$reader.ReadBytes($length)
        if ($audio.Length -ne $length) { throw 'The audio file is incomplete.' }
        if (![InputAudioSignal]::HasSignal($audio)) { continue }
        $path=Join-Path $OutputPath ('part-'+$chunks.Count+'.wav')
        $output=[IO.MemoryStream]::new(); $writer=[IO.BinaryWriter]::new($output)
        try {
          $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $writer.Write([uint32]($length+36)); $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $writer.Write([uint32]16); $writer.Write([uint16]1); $writer.Write([uint16]1); $writer.Write([uint32]16000); $writer.Write([uint32]32000); $writer.Write([uint16]2); $writer.Write([uint16]16); $writer.Write([Text.Encoding]::ASCII.GetBytes('data')); $writer.Write([uint32]$length); $writer.Write($audio,0,$length)
          [IO.File]::WriteAllBytes($path,$output.ToArray())
        } finally { $writer.Dispose(); $output.Dispose() }
        $chunks+=@{ path=$path; start=$at/32000.0; end=($at+$length)/32000.0 }
      }
    } finally { $reader.Dispose(); $stream.Dispose() }
    [IO.File]::Delete($target.Path)
    [Console]::WriteLine((@{ chunks=$chunks } | ConvertTo-Json -Compress -Depth 5)); exit 0
  }
  throw 'Unknown local media action.'
} catch {
  [Console]::WriteLine((@{ error='The local media action could not finish. Check installed media and language support.' } | ConvertTo-Json -Compress)); exit 1
}
