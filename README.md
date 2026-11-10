# research-ops · 科研工作流同步库

这个仓库**只放工具与流程**，不放研究内容。

## 它能给你什么

- 文献检索工具（Crossref / arXiv 直连，去重、按被引排序、产出归档表）
- 环境契约与可复现蓝图（conda 蓝图 + pip 锁文件 + 验证脚本）
- Bot 团队的操作工具（改配置、验证编制、记忆体检、备份）
- 一条可检查的边界规则：什么能上云、什么永远留在本机

## 它明确不包含什么

选题、证据台账、精读材料、实验日志与数值、数据集路径、导师与学校身份、论文正文与草稿、投稿策略。这些一律留在本机。

判断标准：如果一句话能让别人知道「我在做什么、做到哪、打算怎么发」，它就不会出现在这里。

## 结构

```
tools/                        检索与守卫脚本
DSH-Desktop-Bridge/           Bot 团队操作工具与协议说明
research/50-experiments/      实验环境的契约、锁文件、验证脚本
```

## 使用

环境验证：

```
D:\Anaconda\envs\Test\python.exe "research/50-experiments/experiment-agent/verify_imports.py"
```

文献检索：

```
node tools/litsearch.mjs --queries "bamboo slip restoration" --rows 15 --out out.md
```

## 注意

本仓库由本机白名单构建脚本生成，**不要在这里直接改文件**——改了下次构建会被覆盖。要改请改源工作区，然后重新构建。

## 自动同步

每天 18:00 由 Windows 计划任务 `Research-Ops-DailyPush` 自动执行：白名单构建 → 敏感词扫描 → 提交 → 推送。日志在 `_automation\logs\ops-daily-push.log`。构建或扫描失败时不会提交，也不会推送。
