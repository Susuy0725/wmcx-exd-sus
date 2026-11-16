param(
    [string]$OutDir = "Extensions",
    [string]$RepoName = "Susuy0725 WMCX Extensions",
    [string]$RepoIdentifier = "com.susuy0725.wmcx-exd-sus",
    [string]$RepoDescription = "Web mai Chart X 擴充程式儲存庫（WERP Schema v1）"
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
$relFile = ($OutDir.TrimEnd('\', '/') + "/" + $pkgName) -replace '\\', '/'

$indexObj = [ordered]@{
    schemaVersion = 1
    name          = $RepoName
    identifier    = $RepoIdentifier
    description   = $RepoDescription
    extensions    = @(
        [ordered]@{
            id          = $manifest.id
            name        = $manifest.name
            version     = $manifest.version
            description = $manifest.description
            file        = $relFile
            sha256      = $hash
        }
    )
}

$json = $indexObj | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "index.json"), $json + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Built WERP repository:"
Write-Host "  Package: $relFile"
Write-Host "  SHA-256: $hash"
Write-Host "  Index:   index.json"
