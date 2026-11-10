# Post-reboot check for the Test research environment.
# Read-only: prints a report, trains nothing, deletes nothing.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File post-reboot-check.ps1

$ErrorActionPreference = 'Continue'
$py = 'D:\Anaconda\envs\Test\python.exe'
$agentDir = 'C:\Users\ZhouXuan\Desktop\OH-WorkSpace\research\50-experiments\experiment-agent'
$link = 'C:\Users\ZhouXuan\Desktop\OH-WorkSpace\.agents\skills'
$fail = 0

function Section($t) { Write-Output ""; Write-Output ("== " + $t + " ==") }
function Check($name, $ok, $detail) {
    if ($ok) { Write-Output ("[PASS] " + $name + " : " + $detail) }
    else { Write-Output ("[FAIL] " + $name + " : " + $detail); $script:fail++ }
}

Section 'MEMORY (the reason we restarted)'
$os = Get-CimInstance Win32_OperatingSystem
$perf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$committedGB = [math]::Round($perf.CommittedBytes / 1GB, 1)
$limitGB = [math]::Round($perf.CommitLimit / 1GB, 1)
$cacheGB = [math]::Round($perf.CacheBytes / 1GB, 2)
Write-Output ("free_GB=" + $freeGB + "  committed_GB=" + $committedGB + " / " + $limitGB + "  filecache_GB=" + $cacheGB)
Check 'memory headroom' ($freeGB -ge 8) ("free " + $freeGB + " GB (want >= 8 before a training run)")
Check 'commit pressure' ($committedGB -lt ($limitGB * 0.75)) ("committed " + [math]::Round(100 * $committedGB / $limitGB, 1) + "% of limit (want < 75%)")

Section 'GPU'
$smi = & nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv,noheader 2>$null
if ($LASTEXITCODE -eq 0 -and $smi) { Write-Output $smi } else { Write-Output "nvidia-smi unavailable" }

Section 'TEST ENV'
Check 'interpreter' (Test-Path -LiteralPath $py) $py
if (Test-Path -LiteralPath $py) {
    $out = & $py -c "import sys,torch,torchvision,numpy,cv2,skimage,scipy,pandas,lpips;print(sys.version.split()[0]);print(torch.__version__,torch.version.cuda,torch.cuda.is_available());print(torchvision.__version__)" 2>&1
    Write-Output ($out -join "`n")
    Check 'cuda_available' (($out -join " ") -match 'True') 'torch reports CUDA availability above'
}

Section 'AGENT WORKDIR'
Check 'dir exists' (Test-Path -LiteralPath $agentDir) $agentDir
$stamp = Join-Path $agentDir 'env_check\env-check.json'
if (Test-Path -LiteralPath $stamp) {
    $j = Get-Content -LiteralPath $stamp -Raw | ConvertFrom-Json
    Write-Output ("last env_check: device=" + $j.device + " torch=" + $j.torch + " at " + $j.finished_at)
}

Section 'PROJECT SKILL ROOT'
Check 'junction' (Test-Path -LiteralPath $link) $link
if (Test-Path -LiteralPath $link) {
    $n = (Get-ChildItem -LiteralPath $link -Directory).Count
    Check 'skill count' ($n -ge 15) ("" + $n + " skills visible")
}

Section 'DSH LINK'
# The desktop UI returns 401/403 without a session cookie, so probe the TCP port instead
# of asserting an HTTP status that is expected to be refused.
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', 43129, $null, $null)
    $okPort = $iar.AsyncWaitHandle.WaitOne(2000)
    $client.Close()
    Check 'port 43129' $okPort $(if ($okPort) { 'listening (HTTP 401 without cookie is normal)' } else { 'not listening — start DSH Desktop if you need the team' })
} catch {
    Check 'port 43129' $false ('probe error: ' + $_.Exception.Message)
}

Section 'RESULT'
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED" } else { Write-Output ("FAILED CHECKS: " + $fail) }
exit $fail
