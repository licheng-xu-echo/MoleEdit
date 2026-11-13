# =============================================================================
# 创建 MolEdit 开始菜单快捷方式（当前用户，无需管理员权限）
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\create-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File tools\create-shortcut.ps1 -Desktop
#   powershell -ExecutionPolicy Bypass -File tools\create-shortcut.ps1 -OutputDir "D:\some\dir"
# 说明：快捷方式通过 wscript.exe 调用 launch.vbs，自动用 Chrome/Edge 打开 index.html。
# =============================================================================
param(
  [string]$ShortcutName = "MolEdit Molecular Editor",
  [string]$OutputDir = "",
  [switch]$SkipStartMenu,
  [switch]$Desktop
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$root = (Resolve-Path $root).Path

$html = Join-Path $root "index.html"
$vbs = Join-Path $root "launch.vbs"
$icon = Join-Path $root "assets\moledit.ico"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"

foreach ($p in @($html, $vbs, $icon, $wscript)) {
  if (-not (Test-Path $p)) { throw "缺少文件: $p" }
}

$targets = @()
if ($OutputDir -ne "") {
  $targets += $OutputDir
} else {
  if (-not $SkipStartMenu) {
    $targets += (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
  }
  if ($Desktop) {
    $targets += [Environment]::GetFolderPath("Desktop")
  }
}
if ($targets.Count -eq 0) { throw "没有指定输出位置（使用 -Desktop 或 -OutputDir）" }

$ws = New-Object -ComObject WScript.Shell
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $lnkPath = Join-Path $dir ($ShortcutName + ".lnk")

  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $wscript
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon + ",0"
  $lnk.Description = "MolEdit - GaussView-style molecular editor"
  $lnk.WindowStyle = 1
  $lnk.Save()

  $chk = $ws.CreateShortcut($lnkPath)
  Write-Host "Created: $lnkPath"
  Write-Host "  TargetPath : $($chk.TargetPath)"
  Write-Host "  Arguments  : $($chk.Arguments)"
  Write-Host "  WorkingDir : $($chk.WorkingDirectory)"
  Write-Host "  Icon       : $($chk.IconLocation)"
}
