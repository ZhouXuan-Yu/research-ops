"""Import smoke for Test env. No training, no data. Prints versions and exits nonzero on failure."""
from __future__ import annotations

import importlib
import json
import sys

print("executable:", sys.executable)
print("python:", sys.version.split()[0])

mods = [
    "numpy", "scipy", "pandas", "matplotlib", "PIL",
    "torch", "torchvision", "cv2", "skimage", "tqdm", "lpips", "tensorboard",
]
versions = {}
failed = []
for name in mods:
    try:
        m = importlib.import_module(name)
        versions[name] = getattr(m, "__version__", "unknown")
    except Exception as exc:  # noqa: BLE001
        failed.append({"module": name, "error": repr(exc)})

import torch  # noqa: E402
import torchvision  # noqa: E402

cuda = torch.cuda.is_available()
detail = {
    "torch": torch.__version__,
    "torch_cuda": torch.version.cuda,
    "torchvision": torchvision.__version__,
    "cuda_available": cuda,
    "gpu": torch.cuda.get_device_name(0) if cuda else None,
}
if cuda:
    x = torch.ones(4, 3, 8, 8, device="cuda")
    y = torch.nn.Conv2d(3, 6, 3, padding=1).cuda()(x)
    detail["gpu_forward_shape"] = list(y.shape)
    detail["peak_mem_mb"] = round(torch.cuda.max_memory_allocated() / 1024**2, 2)

print(json.dumps({"versions": versions, "detail": detail, "failed": failed}, ensure_ascii=False, indent=1))
if failed:
    sys.exit(1)
