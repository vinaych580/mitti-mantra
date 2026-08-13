"""
One-off script: pull a small, real sample of labeled leaf photos from the
public spMohanty/PlantVillage-Dataset GitHub mirror (CC0 / public research
dataset, widely cited) to replace the flat-color placeholder swatches that
previously lived in dataset/plantvillage/.

Not part of the app's runtime — run manually to (re)populate the sample:
    venv\\Scripts\\python.exe scripts\\fetch_plantvillage_sample.py
"""
from __future__ import annotations

import random
import time
from pathlib import Path

import requests

REPO_API = "https://api.github.com/repos/spMohanty/PlantVillage-Dataset/contents/raw/color"
OUT_DIR = Path(__file__).resolve().parents[1] / "dataset" / "plantvillage"
PER_CLASS = 30
SEED = 42

# Local class name -> upstream folder name
CLASS_MAP = {
    "maize_common_rust": "Corn_(maize)___Common_rust_",
    "maize_gray_leaf_spot": "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "maize_healthy": "Corn_(maize)___healthy",
    "maize_northern_leaf_blight": "Corn_(maize)___Northern_Leaf_Blight",
    "potato_early_blight": "Potato___Early_blight",
    "potato_healthy": "Potato___healthy",
    "potato_late_blight": "Potato___Late_blight",
    "soybean_healthy": "Soybean___healthy",
    "tomato_bacterial_spot": "Tomato___Bacterial_spot",
    "tomato_early_blight": "Tomato___Early_blight",
    "tomato_healthy": "Tomato___healthy",
    "tomato_late_blight": "Tomato___Late_blight",
    "tomato_leaf_mold": "Tomato___Leaf_Mold",
    "tomato_mosaic_virus": "Tomato___Tomato_mosaic_virus",
    "tomato_septoria_leaf_spot": "Tomato___Septoria_leaf_spot",
    "tomato_spider_mites": "Tomato___Spider_mites Two-spotted_spider_mite",
    "tomato_target_spot": "Tomato___Target_Spot",
    "tomato_yellow_leaf_curl_virus": "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
}


def list_folder(remote_name: str) -> list[dict]:
    # Unauthenticated GitHub API is capped at 60 req/hour; these class folders
    # hold hundreds-to-thousands of files each, so only page 1 (100 items) is
    # fetched -- plenty for a PER_CLASS=30 sample without exhausting the quota.
    r = requests.get(
        f"{REPO_API}/{requests.utils.quote(remote_name)}",
        params={"per_page": 100, "page": 1},
        timeout=30,
    )
    r.raise_for_status()
    batch = r.json()
    return batch if isinstance(batch, list) else []


def main() -> None:
    rng = random.Random(SEED)
    total = 0
    MIN_ACCEPTABLE = 10

    for local_name, remote_name in CLASS_MAP.items():
        dest = OUT_DIR / local_name
        dest.mkdir(parents=True, exist_ok=True)

        try:
            listing = list_folder(remote_name)
        except Exception as e:
            print(f"  FAILED to list {remote_name}: {e} -- keeping existing files")
            continue

        files = [it for it in listing if it.get("type") == "file"]
        rng.shuffle(files)
        picked = files[:PER_CLASS]

        downloaded: dict[str, bytes] = {}
        for item in picked:
            url = item.get("download_url")
            if not url:
                continue
            try:
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                downloaded[item["name"]] = resp.content
            except Exception as e:
                print(f"    skip {item.get('name')}: {e}")
            time.sleep(0.05)

        if len(downloaded) < MIN_ACCEPTABLE:
            print(f"{local_name:35s} <- {remote_name:60s} only {len(downloaded)} downloaded, keeping existing placeholders")
            continue

        # Only replace on-disk files once we know the download actually worked.
        for f in dest.glob("img_*.jpg"):
            f.unlink()
        for i, content in enumerate(downloaded.values()):
            (dest / f"img_{i}.jpg").write_bytes(content)

        total += len(downloaded)
        print(f"{local_name:35s} <- {remote_name:60s} {len(downloaded)}/{len(picked)} saved")

    print(f"\nDone. {total} real images saved under {OUT_DIR}")


if __name__ == "__main__":
    main()
