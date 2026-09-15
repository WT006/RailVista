param(
  [int]$Start = 0,
  [int]$End = 9,
  [int]$DelayMs = 1200
)

$root = Split-Path -Parent $PSScriptRoot
$headers = @{
  'User-Agent' = 'RailVistaScenicCalibrate/1.0'
  Accept       = 'application/sparql-results+json'
}

for ($i = $Start; $i -le $End; $i++) {
  $urlFile = Join-Path $root "data/presets/_scenic-wikidata-batch-$i.url.txt"
  $outFile = Join-Path $root "data/presets/_scenic-wikidata-batch-$i.json"
  if (-not (Test-Path $urlFile)) {
    Write-Host "Missing $urlFile"
    continue
  }
  $url = (Get-Content $urlFile -Raw).Trim()
  Write-Host "Fetching batch $i..."
  try {
    $resp = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 120
    $resp | ConvertTo-Json -Depth 20 | Set-Content -Path $outFile -Encoding utf8
    $count = $resp.results.bindings.Count
    Write-Host "  saved $outFile ($count bindings)"
  }
  catch {
    Write-Error "Batch $i failed: $($_.Exception.Message)"
    exit 1
  }
  if ($i -lt $End) { Start-Sleep -Milliseconds $DelayMs }
}
