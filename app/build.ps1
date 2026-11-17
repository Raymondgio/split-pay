# Builds the Rust money core to WebAssembly and copies it next to the web files.
# Run from anywhere:  powershell -File "C:\Claude\Split Pay\app\build.ps1"
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location "$app\core"
try {
    cargo test --quiet
    if ($LASTEXITCODE -ne 0) { throw "Rust tests failed - not building." }
    cargo build --release --target wasm32-unknown-unknown
    if ($LASTEXITCODE -ne 0) { throw "WebAssembly build failed." }
    Copy-Item "target\wasm32-unknown-unknown\release\splitpay_core.wasm" "$app\web\core.wasm" -Force
    $kb = [math]::Round((Get-Item "$app\web\core.wasm").Length / 1KB)
    Write-Output "OK: web\core.wasm ($kb KB)"
} finally {
    Pop-Location
}
