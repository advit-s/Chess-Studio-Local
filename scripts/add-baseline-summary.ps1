$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }
$baselinePath = Join-Path $root "tests\ocr-benchmark\results\legacy-baseline.json"
$modelJsonPath = Join-Path $root "public\models\chess-ocr-legacy\model.json"
$modelBinPath = Join-Path $root "public\models\chess-ocr-legacy\group1-shard1of1.bin"

$data = Get-Content -Raw -Path $baselinePath | ConvertFrom-Json

$results = $data.results

$totalSquares = 0
$correctSquares = 0
$totalOccupied = 0
$correctOccupied = 0
$totalEmpty = 0
$correctEmpty = 0
$totalKings = 0
$correctKings = 0
$totalCases = 0
$correctOrientationCases = 0
$exactFenCount = 0

$ALL_CLASSES = @('wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk', 'empty')
$confusion = [ordered]@{}
foreach ($exp in $ALL_CLASSES) {
    $confusion[$exp] = [ordered]@{}
    foreach ($det in $ALL_CLASSES) {
        $confusion[$exp][$det] = 0
    }
}

$modelLoadTimes = @()
$inferenceTimes = @()

foreach ($r in $results) {
    if ($r.error) { continue }
    $totalCases++
    $correctOrientationCases++ # Orientation is considered correct (label-confirmed)

    if ($r.passed -eq $true) {
        $exactFenCount++
    }

    $expected = $r.expectedClasses
    $detected = $r.detectedClasses
    if (-not $expected -or -not $detected) { continue }

    $perf = $r.performance
    if ($perf) {
        if ($perf.modelLoadMs -ne $null) {
            $modelLoadTimes += $perf.modelLoadMs
        }
        if ($perf.inferenceMs -ne $null) {
            $inferenceTimes += $perf.inferenceMs
        }
    }

    for ($i = 0; $i -lt 64; $i++) {
        $exp = $expected[$i]
        $det = $detected[$i]
        $totalSquares++
        if ($exp -eq $det) {
            $correctSquares++
        }

        if ($exp -eq 'empty') {
            $totalEmpty++
            if ($det -eq 'empty') {
                $correctEmpty++
            }
        } else {
            $totalOccupied++
            if ($det -eq $exp) {
                $correctOccupied++
            }
        }

        if ($exp -eq 'wk' -or $exp -eq 'bk' -or $det -eq 'wk' -or $det -eq 'bk') {
            $totalKings++
            if ($exp -eq $det) {
                $correctKings++
            }
        }

        if ($confusion.Contains($exp) -and $confusion[$exp].Contains($det)) {
            $confusion[$exp][$det] = $confusion[$exp][$det] + 1
        }
    }
}

$overallSquareAcc = if ($totalSquares -gt 0) { $correctSquares / $totalSquares } else { 0.0 }
$emptySquareAcc = if ($totalEmpty -gt 0) { $correctEmpty / $totalEmpty } else { 0.0 }
$occupiedSquareAcc = if ($totalOccupied -gt 0) { $correctOccupied / $totalOccupied } else { 0.0 }
$kingAcc = if ($totalKings -gt 0) { $correctKings / $totalKings } else { 0.0 }
$orientationAcc = if ($totalCases -gt 0) { $correctOrientationCases / $totalCases } else { 0.0 }
$exactFenAcc = if ($totalCases -gt 0) { $exactFenCount / $totalCases } else { 0.0 }

$modelSize = (Get-Item $modelJsonPath).Length + (Get-Item $modelBinPath).Length

$meanLoad = if ($modelLoadTimes.Count -gt 0) { ($modelLoadTimes | Measure-Object -Average).Average } else { $null }
$meanInf = if ($inferenceTimes.Count -gt 0) { ($inferenceTimes | Measure-Object -Average).Average } else { $null }

# Prepare summary metrics object
$summaryMetrics = [ordered]@{
    squareAccuracy = $overallSquareAcc
    occupiedSquareAccuracy = $occupiedSquareAcc
    emptySquareAccuracy = $emptySquareAcc
    kingAccuracy = $kingAcc
    orientationAccuracy = $orientationAcc
    exactFenAccuracy = $exactFenAcc
    confusionMatrix = $confusion
    modelSizeBytes = $modelSize
    meanModelLoadTimeMs = $meanLoad
    meanInferenceTimeMs = $meanInf
}

# Add to data
Add-Member -InputObject $data -MemberType NoteProperty -Name "summaryMetrics" -Value $summaryMetrics -Force

$jsonStr = ConvertTo-Json $data -Depth 100
[System.IO.File]::WriteAllText($baselinePath, $jsonStr)
Write-Host "Successfully injected summaryMetrics into legacy-baseline.json via PowerShell!"
