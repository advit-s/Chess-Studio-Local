# PowerShell script to integrate the newly trained model into the active production OCR path
$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

$srcDir = Join-Path $root "public\models\chess-ocr-new"
$destDir = Join-Path $root "public\models\chess-ocr"

if (-not (Test-Path $srcDir)) {
    Write-Error "New model folder public/models/chess-ocr-new does not exist. Please run training and export first."
    Exit 1
}

Write-Host "Copying new model files from $srcDir to $destDir..."
Copy-Item -Path "$srcDir\*" -Destination $destDir -Force

Write-Host "Updating model integrity manifest..."
# Run npm script to update integrity manifest
node "$root\scripts\update-integrity-manifest.mjs"

Write-Host "Model integration completed successfully!"
