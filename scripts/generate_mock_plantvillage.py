import os
from pathlib import Path
from PIL import Image

DISEASE_CLASSES = [
    "maize_common_rust", "maize_gray_leaf_spot", "maize_northern_leaf_blight", "maize_healthy",
    "potato_early_blight", "potato_late_blight", "potato_healthy", "soybean_healthy",
    "tomato_bacterial_spot", "tomato_early_blight", "tomato_late_blight", "tomato_leaf_mold",
    "tomato_septoria_leaf_spot", "tomato_spider_mites", "tomato_target_spot",
    "tomato_yellow_leaf_curl_virus", "tomato_mosaic_virus", "tomato_healthy"
]

def generate_mock_dataset():
    dataset_dir = Path(__file__).resolve().parents[1] / "dataset" / "plantvillage"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    # Generate 5 images per class to ensure enough for train/val split (80/20 of 5 = 4/1)
    # Total images = 18 * 5 = 90
    print(f"Generating mock PlantVillage dataset in {dataset_dir}...")
    for disease in DISEASE_CLASSES:
        class_dir = dataset_dir / disease
        class_dir.mkdir(exist_ok=True)
        for i in range(5):
            img_path = class_dir / f"img_{i}.jpg"
            if not img_path.exists():
                # Create a 384x384 RGB image (e.g. solid green for healthy, brown for rust)
                color = (34, 139, 34) if "healthy" in disease else (139, 69, 19)
                img = Image.new('RGB', (384, 384), color=color)
                img.save(img_path)
    
    print("Mock dataset generation complete!")

if __name__ == "__main__":
    generate_mock_dataset()
