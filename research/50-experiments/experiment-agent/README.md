# 实验 Bot 独立工作区

本目录专供 DSH「科研论文组」的 **实验** Bot 搭建复现项目、实现 baseline、运行小规模验证。建立于 2026-10-26；不是任何论文已复现或模型已训练完成的证明。

- **工作目录**：`C:\Users\ZhouXuan\Desktop\OH-WorkSpace\research\50-experiments\experiment-agent`。Bot 的 `work_dir` 必须通过 DSH `update_bot` 正式入口设置并核对生效，不能只靠此 README。
- **隔离解释器**：Conda 环境 `Test`，路径 `D:\Anaconda\envs\Test\python.exe`，Python 3.11.16（创建结果已核；PyTorch/GPU 能力以最新验证为准）。执行使用 `conda run -n Test ...` 或解释器绝对路径，不默认调用系统 `python`（后者为 3.14/CPU PyTorch）。
- **目录用途**：`projects/` 放逐篇论文/逐项 idea 的代码、配置和测试；`runs/` 放机器产物（默认不提交 Git）；`data/` 放有授权的数据（默认不提交 Git）；`checkpoints/` 放权重（默认不提交 Git）；长期可审查的实验摘要登记到上级 `log/` 与 `log.md`。
- **门禁**：用户先选 idea/论文并确认数据可用、训练预算与停止条件；之后才读取真实数据或运行较长 GPU 训练。合成烟测须带“TEST ONLY”，不得入论文数据或图。第三方论文代码先审许可证与网络/凭据操作，未经批准不安装未知脚本、不外传资料。
- **每次运行最少留痕**：源数据许可与版本/哈希、划分键（按简号/篇目避免泄漏）、代码提交或源文件哈希、完整环境锁、随机种子、命令与机器信息、stdout/stderr、checkpoint、原始指标 CSV/JSON、由同份指标数据重生的图、异常和失败记录。没有结果时写失败，不补值。
- **回滚**：Bot 的工作目录可在 DSH 正式入口改回先前值；Conda `Test` 环境的删除或依赖回退必须先核对使用者与快照，**不得自动删除**。

当前可核验的合成短跑位于 `OH-WorkSpace/tasks/T20261026-02-4c8e/smoke/`，由 Hana 在系统默认 Python 中完成，仅证明机械链路可运行，**不代表 Test 环境或 DSH Bot 已经跑通**。
