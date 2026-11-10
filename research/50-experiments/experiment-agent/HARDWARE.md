# 本机算力边界（实测，2026-10-26 19:04）

分两段：**F 实测**、**I 推断**。选基线与 batch 前先看这里，别先写完代码才发现跑不动。

## F：实测读数

| 项 | 读数 | 来源 |
|---|---|---|
| GPU | NVIDIA GeForce RTX 5060 Laptop GPU，**8151 MiB 显存** | `nvidia-smi` |
| 驱动 / CUDA 运行时 | 驱动 595.79，`nvidia-smi` 报 CUDA 13.2 | `nvidia-smi` |
| PyTorch | 2.14.1+cu130，`torch.version.cuda` = 13.0 | Test 解释器实跑 |
| `torch.cuda.is_available()` | **True**，已在 GPU 上完成张量运算 | `env_check.py` |
| CPU | 13th Gen Intel Core i7-13650HX，**20 逻辑核** | Win32_Processor |
| 物理内存 | **31.6 GB 总计**，测量时**空闲仅 1.5 GB** | Win32_OperatingSystem |
| 系统 | Windows 11 家庭中文版 build 26200 | Win32_OperatingSystem |
| 解释器 | `D:\Anaconda\envs\Test\python.exe`，Python 3.11.16 | `sys.executable` |

`nvidia-smi` 的 CUDA 13.2 是**驱动支持的版本**，`torch.version.cuda` 的 13.0 是**wheel 编译所用版本**，两者不必相同，不冲突。

## I：由此推得的可用范围（推断，非实测）

| 任务规模 | 判断 | 理由 |
|---|---|---|
| 传统方法（Otsu / 形态学 / Telea / PatchMatch） | 完全够，多核 CPU 即可 | 不占显存 |
| ResNet / VGG 级 backbone 分类与特征提取，224² | 可跑，AMP + batch 16～32 | 8 GB 显存有富余 |
| 小型 U-Net 图像修复，256² | 可跑，batch 4～8 | 显存是主约束 |
| ViT-B 级，224² | 勉强可跑，需 AMP + batch 8 起试 | 注意力显存随分辨率平方增长 |
| SD2-inpainting（512²） | 吃紧，需 fp16 + 梯度检查点/分块 | 8 GB 属官方建议下限之下 |
| SDXL-inpainting | 基本不可行 | 单卡 8 GB 不足 |
| 7B 级模型全参微调 | 不可行 | 显存差一个量级 |
| 多卡并行 | 不可行 | 只有一张卡 |

**更现实的瓶颈是内存**：测量时空闲只有 1.5 GB / 31.6 GB。`DataLoader(num_workers>0)` 会开子进程复制数据管线，容易触发换页，训练反而变慢。建议实验代码默认 `num_workers=0`，需要并行加载时先确认空闲内存回升。

## 使用约定

1. 任何论文复现先做一次「单 batch 前向 + 反传」显存探针，记录峰值显存，再决定 batch。
2. 显存不足优先降 batch，不要先降分辨率——修复任务的分辨率直接影响结论可比性。
3. 训练脚本必须记录 `torch.cuda.max_memory_allocated()`，写进 run manifest。
4. 这是笔记本显卡，长时间满载会降频。跑长任务前后各测一次吞吐，偏差大就在日志里标注。
