# 打云服务器上线包（不含 node_modules；服务器上 pnpm install）
# 用法：在仓库根目录执行  pwsh -File deploy/pack-release.ps1
# 可选：-Domain "https://rail.example.com"

param(
  [string]$Domain = "https://YOUR_DOMAIN"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root "deploy\out\railvista-release"
$ZipPath = Join-Path $Root "deploy\out\railvista-release.zip"

Write-Host "==> clean $OutDir"
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Copy-Tree($from, $to, $excludeDirs = @()) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $xd = @()
  foreach ($d in $excludeDirs) { $xd += "/XD"; $xd += $d }
  & robocopy $from $to /E /NFL /NDL /NJH /NJS /nc /ns /np @xd | Out-Null
  # robocopy exit 0-7 = success-ish
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from -> $to (code $LASTEXITCODE)" }
}

Write-Host "==> copy package manifests"
Copy-Item (Join-Path $Root "package.json") $OutDir
Copy-Item (Join-Path $Root "pnpm-lock.yaml") $OutDir
Copy-Item (Join-Path $Root "pnpm-workspace.yaml") $OutDir

Write-Host "==> copy apps/api (dist + package.json)"
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "apps\api") | Out-Null
Copy-Item (Join-Path $Root "apps\api\package.json") (Join-Path $OutDir "apps\api\")
Copy-Tree (Join-Path $Root "apps\api\dist") (Join-Path $OutDir "apps\api\dist")

Write-Host "==> copy apps/web/dist"
Copy-Tree (Join-Path $Root "apps\web\dist") (Join-Path $OutDir "apps\web\dist")
# web package.json 非运行必需，但 monorepo workspace 声明了 apps/*，放一个最小 package 避免 pnpm 警告
@"
{
  "name": "@railvista/web",
  "version": "0.7.0",
  "private": true
}
"@ | Set-Content -Encoding utf8 (Join-Path $OutDir "apps\web\package.json")

Write-Host "==> copy packages/shared"
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "packages\shared") | Out-Null
Copy-Item (Join-Path $Root "packages\shared\package.json") (Join-Path $OutDir "packages\shared\")
Copy-Tree (Join-Path $Root "packages\shared\dist") (Join-Path $OutDir "packages\shared\dist")

Write-Host "==> copy data (exclude cache / huge rebuildables)"
Copy-Tree (Join-Path $Root "data") (Join-Path $OutDir "data") @(
  "cache",
  "net",
  "geom.prev",
  "gapfill",
  "_china-railway.osm.pbf"
)

Write-Host "==> copy deploy configs"
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "deploy") | Out-Null
Copy-Item (Join-Path $Root "deploy\ecosystem.config.cjs") (Join-Path $OutDir "deploy\")
Copy-Item (Join-Path $Root "deploy\nginx.railvista.conf.example") (Join-Path $OutDir "deploy\")

Write-Host "==> write production .env (API)"
$apiEnvSrc = Join-Path $Root "apps\api\.env"
$apiEnvDst = Join-Path $OutDir "apps\api\.env"
if (Test-Path $apiEnvSrc) {
  $lines = Get-Content $apiEnvSrc -Encoding utf8
  $out = @()
  $hasCors = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*CORS_ORIGIN=') {
      $out += "CORS_ORIGIN=$Domain"
      $hasCors = $true
    } else {
      $out += $line
    }
  }
  if (-not $hasCors) { $out += "CORS_ORIGIN=$Domain" }
  if ($out -notcontains "NODE_ENV=production" -and ($out -notmatch '^NODE_ENV=')) {
    $out += "NODE_ENV=production"
  }
  $out | Set-Content -Encoding utf8 $apiEnvDst
} else {
  @"
PORT=3000
CORS_ORIGIN=$Domain
NODE_ENV=production
AMAP_KEY=
"@ | Set-Content -Encoding utf8 $apiEnvDst
}

# 前端密钥已 bake 进 dist，仍附一份说明用 .env.bak（可选重建）
$webEnvSrc = Join-Path $Root "apps\web\.env"
if (Test-Path $webEnvSrc) {
  Copy-Item $webEnvSrc (Join-Path $OutDir "apps\web\.env.baked-from-local")
}

# ecosystem 域名
$ecoPath = Join-Path $OutDir "deploy\ecosystem.config.cjs"
$eco = Get-Content $ecoPath -Raw -Encoding utf8
$eco = $eco -replace "https://your\.domain\.com", $Domain
Set-Content -Path $ecoPath -Value $eco -Encoding utf8 -NoNewline

# nginx 示例域名
$ngxPath = Join-Path $OutDir "deploy\nginx.railvista.conf.example"
$ngx = Get-Content $ngxPath -Raw -Encoding utf8
$hostOnly = $Domain -replace '^https?://', ''
$ngx = $ngx -replace "your\.domain\.com", $hostOnly
Set-Content -Path $ngxPath -Value $ngx -Encoding utf8 -NoNewline

@"
RailVista 上线包
================
本包含：已构建的 web/api、shared、data（无 cache）、deploy 配置、apps/api/.env

【上传】
把整个 railvista-release 目录（或 zip 解压后）上传到服务器，例如：
  /var/www/railvista

【你必须先改的 2 处】
1) apps/api/.env 里的 CORS_ORIGIN（当前: $Domain）
2) deploy/ecosystem.config.cjs 与 deploy/nginx*.conf 里的域名/证书路径

【服务器命令】
  cd /var/www/railvista
  # 安装 Node 20+ 与 pnpm 9 后：
  pnpm install --prod
  pm2 start deploy/ecosystem.config.cjs
  pm2 save

  # Nginx：把 deploy/nginx.railvista.conf.example 拷到 sites-enabled，改证书路径后
  sudo nginx -t && sudo systemctl reload nginx

【高德】
控制台把 https 域名加入 JS API 安全域名白名单。

【说明】
- 前端密钥已打进 apps/web/dist，一般不必再 build
- data/roads/geom 若本机有会打进包；没有则公路折线可能不完整
"@ | Set-Content -Encoding utf8 (Join-Path $OutDir "上传后请读.txt")

Write-Host "==> zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -CompressionLevel Optimal

$zipSize = (Get-Item $ZipPath).Length / 1MB
$dirSize = (Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ""
Write-Host "OK: $OutDir  ($([math]::Round($dirSize,1)) MB)"
Write-Host "OK: $ZipPath  ($([math]::Round($zipSize,1)) MB)"
Write-Host "Domain baked into CORS: $Domain"
