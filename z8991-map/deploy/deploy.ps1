# 从本机 Windows 上传 z8991-map 到云服务器
# 用法（PowerShell）:
#   cd d:\Project\AIProject\Route\z8991-map
#   .\deploy\deploy.ps1 -Server "root@1.2.3.4" -RemotePath "/var/www/z8991-map"
#
# 需要：OpenSSH 客户端（Windows 10+ 自带 scp/ssh）

param(
    [Parameter(Mandatory = $true)]
    [string]$Server,

    [Parameter(Mandatory = $false)]
    [string]$RemotePath = "/var/www/z8991-map"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Uploading from $ProjectRoot to ${Server}:${RemotePath} ..."

ssh $Server "mkdir -p '$RemotePath'"

# config.js 在 .gitignore 中，本地有的话一并上传
$includes = @(
    "index.html",
    "offline.html",
    "css",
    "js",
    "config.js",
    "config.example.js"
)

foreach ($item in $includes) {
    $local = Join-Path $ProjectRoot $item
    if (-not (Test-Path $local)) {
        if ($item -eq "config.js") {
            Write-Warning "Skip config.js (not found). Create it on server before using index.html."
        }
        continue
    }
    scp -r $local "${Server}:${RemotePath}/"
}

Write-Host "Done. Visit https://your.domain.com/ (after Nginx + SSL + Amap whitelist)."
