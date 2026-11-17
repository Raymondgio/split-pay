# Makes app\dist\split-pay-web.zip from app\web, ready to upload to the host.
# Uses forward slashes inside the zip (Compress-Archive on Windows uses
# backslashes, which web hosts read as part of the file name).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$web  = (Resolve-Path (Join-Path $here 'web')).Path
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist 'split-pay-web.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  Get-ChildItem $web -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($web.Length + 1) -replace '\\', '/'
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name)
  }
} finally { $archive.Dispose() }
Write-Host "Made $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
