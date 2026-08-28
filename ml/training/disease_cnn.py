"""
ml/training/disease_cnn.py

Fine-tunes a MobileNetV3-Small (ImageNet-pretrained) classifier head over
labeled leaf photos under dataset/plantvillage/, then exports the result to
ONNX for lightweight production inference (see ml/predict.py).

That folder is a small (~500 image) sample pulled from the public
spMohanty/PlantVillage-Dataset research benchmark (see
scripts/fetch_plantvillage_sample.py) -- real leaf photos, but from a
curated academic dataset shot under lab conditions, not this platform's own
farmer-submitted images. Report accuracy as a lab-bench figure, not a
field-validated one, and keep it clearly labeled as such wherever it's shown.

If dataset/plantvillage/ is missing or too small to fit reliably, this
reports NOT_APPLICABLE and clears any stale model files -- the live endpoint
(backend/main.py predict_disease_api) then falls back to its hand-tuned
HSV/texture decision tree. Nothing here ever reports a fabricated accuracy
number for an untrained/placeholder model.

torch/torchvision are training-only dependencies (requirements-dev.txt) --
production inference uses onnxruntime against the exported .onnx file only,
so this module must never be imported from the live request path.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset" / "plantvillage"
MIN_IMAGES_PER_CLASS = 10

IMAGE_SIZE = 224
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def _clear_stale_model() -> None:
    for name in ("disease_model.onnx", "disease_labels.json"):
        path = MODEL_DIR / name
        if path.exists():
            path.unlink()


def _class_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    if not DATASET_DIR.exists():
        return counts
    for class_dir in sorted(DATASET_DIR.iterdir()):
        if not class_dir.is_dir():
            continue
        n = len(list(class_dir.glob("*.jpg"))) + len(list(class_dir.glob("*.png")))
        if n:
            counts[class_dir.name] = n
    return counts


def train_disease_cnn(epochs: int = 12, batch_size: int = 16, seed: int = 42) -> dict[str, Any]:
    """Fine-tune MobileNetV3-Small on dataset/plantvillage/, or report NOT_APPLICABLE."""
    class_counts = _class_counts()
    usable_classes = sorted(c for c, n in class_counts.items() if n >= MIN_IMAGES_PER_CLASS)

    if len(usable_classes) < 2:
        _clear_stale_model()
        return {
            "model": "crop_disease",
            "status": "NOT_APPLICABLE",
            "note": (
                f"Fewer than 2 classes have {MIN_IMAGES_PER_CLASS}+ labeled images under "
                f"{DATASET_DIR}. Crop disease screening stays a rule-based HSV/texture "
                "heuristic (backend/main.py predict_disease_api) -- nothing to train."
            ),
            "metrics": None,
        }

    import torch
    from torch import nn
    from torch.utils.data import DataLoader, random_split
    from torchvision import datasets, models, transforms

    torch.manual_seed(seed)

    train_tf = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        transforms.RandomRotation(20),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    eval_tf = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])

    full_ds = datasets.ImageFolder(DATASET_DIR)
    # ImageFolder enumerates every subdirectory as a class; restrict to the
    # ones with enough samples by filtering the underlying sample list.
    keep_classes = set(usable_classes)
    kept_samples = [(p, y) for p, y in full_ds.samples if full_ds.classes[y] in keep_classes]
    class_to_idx = {c: i for i, c in enumerate(sorted(keep_classes))}
    idx_names = sorted(keep_classes)
    remapped = [(p, class_to_idx[full_ds.classes[y]]) for p, y in kept_samples]

    full_ds.samples = remapped
    full_ds.targets = [y for _, y in remapped]
    full_ds.classes = idx_names
    full_ds.class_to_idx = class_to_idx
    # No transform set here -- full_ds[i] yields a raw PIL image, and each
    # split below applies its own transform (train augmentation vs. plain
    # eval resize/normalize) via _Transformed.

    n_val = max(len(idx_names), int(0.2 * len(remapped)))
    n_train = len(remapped) - n_val
    generator = torch.Generator().manual_seed(seed)
    train_subset, val_subset = random_split(full_ds, [n_train, n_val], generator=generator)

    # random_split shares the underlying dataset object, so wrap each split
    # with its own transform via a thin dataset view.
    class _Transformed(torch.utils.data.Dataset):
        def __init__(self, subset, tf):
            self.subset = subset
            self.tf = tf

        def __len__(self):
            return len(self.subset)

        def __getitem__(self, i):
            img, label = self.subset[i]
            return self.tf(img), label

    train_ds = _Transformed(train_subset, train_tf)
    val_ds = _Transformed(val_subset, eval_tf)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    n_classes = len(idx_names)
    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    for param in model.features.parameters():
        param.requires_grad = False
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, n_classes)

    device = torch.device("cpu")
    model.to(device)

    optimizer = torch.optim.Adam(model.classifier.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    for _epoch in range(epochs):
        model.train()
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()

    model.eval()
    correct = 0
    total = 0
    all_preds: list[int] = []
    all_labels: list[int] = []
    with torch.no_grad():
        for images, labels in val_loader:
            images, labels = images.to(device), labels.to(device)
            preds = model(images).argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            all_preds.extend(preds.tolist())
            all_labels.extend(labels.tolist())

    test_accuracy = correct / total if total else 0.0

    # Macro F1 without pulling in sklearn's full metrics stack for a training-
    # only script that already needs torch/torchvision.
    from collections import defaultdict
    tp: dict[int, int] = defaultdict(int)
    fp: dict[int, int] = defaultdict(int)
    fn: dict[int, int] = defaultdict(int)
    for p, y in zip(all_preds, all_labels):
        if p == y:
            tp[y] += 1
        else:
            fp[p] += 1
            fn[y] += 1
    f1_scores = []
    for c in range(n_classes):
        precision = tp[c] / (tp[c] + fp[c]) if (tp[c] + fp[c]) else 0.0
        recall = tp[c] / (tp[c] + fn[c]) if (tp[c] + fn[c]) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        f1_scores.append(f1)
    macro_f1 = float(np.mean(f1_scores)) if f1_scores else 0.0

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE)
    torch.onnx.export(
        model,
        dummy_input,
        str(MODEL_DIR / "disease_model.onnx"),
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,  # legacy TorchScript-based exporter: no onnxscript dependency
    )
    with open(MODEL_DIR / "disease_labels.json", "w") as f:
        json.dump(idx_names, f, indent=2)

    metrics = {
        "test_accuracy": round(test_accuracy, 4),
        "macro_f1": round(macro_f1, 4),
        "train_samples": n_train,
        "val_samples": n_val,
        "classes_covered": idx_names,
        "classes_dropped_insufficient_data": sorted(set(class_counts) - keep_classes),
        "epochs": epochs,
    }

    return {
        "model": "crop_disease",
        "algorithm": "MobileNetV3-Small (fine-tuned, ImageNet-pretrained)",
        "status": "TRAINED",
        "note": (
            "Trained on a small real-photo sample from the public PlantVillage research "
            "benchmark (see scripts/fetch_plantvillage_sample.py) -- a curated academic "
            "dataset shot under controlled conditions, not this platform's own field "
            "photos. Treat accuracy as a lab-bench figure. The hand-tuned HSV heuristic "
            "remains the fallback whenever the exported model is unavailable, and both "
            "paths carry the same 'not a diagnosis' disclaimer at inference time."
        ),
        "metrics": metrics,
    }


if __name__ == "__main__":
    result = train_disease_cnn()
    print(json.dumps(result, indent=2))
