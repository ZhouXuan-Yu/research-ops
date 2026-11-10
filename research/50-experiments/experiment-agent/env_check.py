"""Environment proof for the Test conda env. Writes a manifest; no research data used."""
from __future__ import annotations

import csv
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

OUT = Path(__file__).resolve().parent / "env_check"
OUT.mkdir(exist_ok=True)
SEED = 43126


def git_head() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[3],
            text=True, stderr=subprocess.DEVNULL, timeout=5,
        ).strip()
    except Exception:
        return "unavailable"


def main() -> None:
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    x = torch.randn(256, 1, 8, 8, device=device)
    target = torch.zeros_like(x)
    target[:, :, 2:6, 2:6] = 1.0
    net = torch.nn.Sequential(
        torch.nn.Conv2d(1, 8, 3, padding=1), torch.nn.ReLU(),
        torch.nn.Conv2d(8, 1, 3, padding=1), torch.nn.Sigmoid(),
    ).to(device)
    opt = torch.optim.Adam(net.parameters(), lr=0.05)
    rows = []
    for epoch in range(1, 6):
        opt.zero_grad(set_to_none=True)
        loss = torch.nn.functional.mse_loss(net(x[:192]), target[:192])
        loss.backward()
        opt.step()
        with torch.no_grad():
            val = torch.nn.functional.mse_loss(net(x[192:]), target[192:]).item()
        rows.append({"epoch": epoch, "train_mse": round(loss.item(), 6), "val_mse": round(val, 6)})

    with (OUT / "metrics.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["epoch", "train_mse", "val_mse"])
        w.writeheader()
        w.writerows(rows)

    fig, ax = plt.subplots(figsize=(5.6, 3.0), dpi=140)
    ax.plot([r["epoch"] for r in rows], [r["train_mse"] for r in rows], "o-", label="train MSE")
    ax.plot([r["epoch"] for r in rows], [r["val_mse"] for r in rows], "s-", label="held-out MSE")
    ax.set(xlabel="epoch", ylabel="MSE", title="ENV CHECK - SYNTHETIC, NOT PAPER DATA")
    ax.legend()
    fig.tight_layout()
    fig.savefig(OUT / "loss_curve.png")
    plt.close(fig)

    manifest = {
        "purpose": "verify Test env end-to-end; synthetic tensors only; never scientific evidence",
        "device": device,
        "gpu_name": torch.cuda.get_device_name(0) if device == "cuda" else None,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "torch": torch.__version__,
        "torch_cuda": torch.version.cuda,
        "numpy": np.__version__,
        "matplotlib": matplotlib.__version__,
        "platform": platform.platform(),
        "seed": SEED,
        "git_commit": git_head(),
        "dataset": "torch.randn 256x1x8x8, seed 43126",
        "dataset_hash": hashlib.sha256(b"randn:256:1:8:8:43126").hexdigest(),
        "final_val_mse": rows[-1]["val_mse"],
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    (OUT / "env-check.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"device": device, "torch": torch.__version__, "cuda": torch.version.cuda,
                      "python": sys.executable, "final_val_mse": rows[-1]["val_mse"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
