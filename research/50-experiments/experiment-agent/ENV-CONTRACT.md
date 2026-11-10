# 实验环境使用契约（ENV-CONTRACT）

生效：2026-11-10　适用：DSH「实验」Bot、以及任何在本机跑实验的渠道
目的：**只维护一个实验环境，禁止新建。** 每次新建 conda env 要重下一套 CUDA 时代的 torch，约 5–8 GB、20–40 分钟，而且版本一漂移，历史结果就不可复现。

---

## 1. 唯一指定环境

| 项 | 值 |
|---|---|
| 环境名 | `Test` |
| 解释器 | `D:\Anaconda\envs\Test\python.exe` |
| Python | 3.11.16 |
| torch | 2.14.1+cu130（CUDA runtime 13.0） |
| GPU | RTX 5060 Laptop，7.96 GB 可用显存 |
| 工作目录 | `C:\Users\ZhouXuan\Desktop\OH-WorkSpace\research\50-experiments\experiment-agent` |

**所有实验一律用这个绝对路径的解释器调用，不依赖 `conda activate`，不改 PATH。**

## 2. 四条硬规则

1. **禁止新建 conda 环境。** 包括「为了跑某篇论文单独建一个」。新论文的依赖装进 `Test`，装不进去就报告，不许绕开。
2. **禁止无批准安装。** 需要新包时，先向用户报告「包名 + 版本 + 为什么必须 + 预计体积」，得到同意后再装。装完必须刷新 `requirements-lock.txt`。
3. **禁止在环境里跑与实验无关的东西。** 语音转写、爬虫、文档转换这类工具不许装进 `Test`——它们会引入 onnxruntime、ctranslate2 这类重依赖，污染解析器版本。
4. **改动先备份锁文件。** 装包前把 `requirements-lock.txt` 复制成 `requirements-lock.bak-YYYYMMDD-HHmmss.txt`。

## 3. 加一个依赖的标准动作

```powershell
# 1) 备份锁
Copy-Item .\requirements-lock.txt (".\requirements-lock.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")

# 2) 装（优先指定版本）
D:\Anaconda\envs\Test\python.exe -m pip install "包名==版本"

# 3) 验证 torch 没被顶掉
D:\Anaconda\envs\Test\python.exe -c "import torch;print(torch.__version__, torch.cuda.is_available())"

# 4) 刷新锁
D:\Anaconda\envs\Test\python.exe -m pip freeze > requirements-lock.txt

# 5) 在 ENV-STATUS.md 的变更记录里加一行
```

**第 3 步不能省。** pip 解依赖时可能顺手把 torch 换掉，而 `pip freeze` 不会告诉你 GPU 已经用不了。

## 4. 重建环境（只在环境损坏时）

```powershell
# 第一层：conda 层（离线蓝图，版本绝对锁定）
conda create -n Test2 --file conda-explicit.txt

# 第二层：pip 层
D:\Anaconda\envs\Test2\python.exe -m pip install -r requirements-lock.txt
```

重建前必须先确认现有环境**真的坏了**（解释器起不来 / torch 无法 import / CUDA 假死）。「报错看着像环境问题」不算。

## 5. 回滚

- 装包后异常：按第 3 步里的 `requirements-lock.bak-*` 反向安装对应版本，或直接 `pip install -r <bak文件>`。
- 环境彻底坏：按第 4 节重建为 `Test2`，验证通过后再改契约里的环境名，**不要直接删 `Test`**。

## 6. 已知的环境现状（2026-11-10 审计）

- 锁文件 71 个包；torch / torchvision / CUDA 版本与上次交付完全一致，无漂移。
- 环境中存在 17 个与实验无关的包（`faster-whisper`、`ctranslate2`、`av`、`onnxruntime`、`hf-xet`、`pypdf` 等语音/文档栈）。**暂不卸载**——不知道有没有别的渠道在用；但按第 2 条第 3 款，后续不得再往这里装同类工具。
- 本次新增（为五篇复现补齐）：`requests 2.34.2`、`seaborn 0.13.2`、`scikit-learn 1.9.1`、`einops 0.8.2`。

## 7. 验收（每次环境变更后跑）

```powershell
D:\Anaconda\envs\Test\python.exe "C:\Users\ZhouXuan\Desktop\OH-WorkSpace\tools\env_verify_lock.py"
```

必须全部满足：
- `torch 2.14.1+cu130`、`avail: True`
- 16 个关键包全部打印版本、无 MISS
- 锁文件包数与实际一致
