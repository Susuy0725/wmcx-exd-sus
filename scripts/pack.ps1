param(
    [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"

$manifest = Get-Content -Raw -Encoding UTF8 "manifest.json" | ConvertFrom-Json
$pkgName = "$($manifest.id)-$($manifest.version).zip"

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$destPath = Join-Path $OutDir $pkgName
Compress-Archive -Path "manifest.json", "index.js" -DestinationPath $destPath -Force

$hash = (Get-FileHash -Path $destPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Packed: $destPath"
Write-Host "SHA256: $hash"
