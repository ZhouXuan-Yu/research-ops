# 实验专用解释器入口：所有实验一律用它，不新建环境
# 用法：  . .\env\activate.ps1      （点号导入，在当前会话生效）
# 只设环境变量，不修改系统 PATH，不改 conda 的默认环境。

$env:EXP_PY = "D:\Anaconda\envs\Test\python.exe"
$env:EXP_HOME = "C:\Users\ZhouXuan\Desktop\OH-WorkSpace\research\50-experiments\experiment-agent"
$env:CONDA_DEFAULT_ENV = "Test"

function py { & $env:EXP_PY @args }
function pyv {
    & $env:EXP_PY -c "import sys,torch;print('py',sys.version.split()[0]);print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
}

Write-Host "实验环境已就绪：$env:EXP_PY" -ForegroundColor Green
Write-Host "工作目录：$env:EXP_HOME" -ForegroundColor Green
Write-Host "命令：py <脚本>   查看环境：pyv" -ForegroundColor DarkGray
