$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$botDir = Join-Path $env:APPDATA "dsh-desktop\harness\bot"
$backRoot = "C:\Users\ZhouXuan\Desktop\OH-WorkSpace\_backups\dsh-bot"
if (-not (Test-Path -LiteralPath $backRoot)) { New-Item -ItemType Directory -Path $backRoot -Force | Out-Null }

$stateSrc = Join-Path $botDir "state.json"
$stateDst = Join-Path $backRoot ("state.bak-" + $stamp + ".json")
Copy-Item -LiteralPath $stateSrc -Destination $stateDst -Force

$memSrc = Join-Path $botDir "memory"
$memDst = Join-Path $backRoot ("memory-" + $stamp)
Copy-Item -LiteralPath $memSrc -Destination $memDst -Recurse -Force

$s1 = Get-Item -LiteralPath $stateSrc
$s2 = Get-Item -LiteralPath $stateDst
Write-Output ("STATE_SRC=" + $s1.Length + " STATE_BAK=" + $s2.Length + " MATCH=" + ($s1.Length -eq $s2.Length))
Write-Output ("MEM_DIR=" + $memDst)
Write-Output ("MEM_FILES=" + (Get-ChildItem -LiteralPath $memDst -Recurse -File | Measure-Object).Count)
Write-Output ("BACKROOT=" + $backRoot)
Write-Output ("STAMP=" + $stamp)
