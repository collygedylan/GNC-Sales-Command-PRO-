#!/usr/bin/env python3
"""Train the GNC diagnostics vision model from Supabase disease assets.

The app's disease folders are mirrored into Supabase by Code.gs. This trainer
uses those mirrored rows as the source of truth, downloads image assets and
embedded photos from PDF lab reports when present, then writes:

  models/diagnostics_classifier.pt
  models/diagnostics_labels.json
  models/diagnostics_training_report.json

The ML worker consumes the first two files directly.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import math
import os
import pathlib
import random
import re
import tempfile
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageOps, UnidentifiedImageError

from supabase_ml_worker import (
    IMAGE_EXTENSIONS,
    RestSupabaseClient,
    WorkerConfig,
    first_non_empty,
    normalize_key,
)


LOGGER = logging.getLogger("gnc.train_diagnostics_model")
PDF_EXTENSIONS = {".pdf"}
DEFAULT_OUTPUT_DIR = pathlib.Path("models")
DEFAULT_MODEL_NAME = "diagnostics_classifier.pt"
DEFAULT_LABELS_NAME = "diagnostics_labels.json"
DEFAULT_REPORT_NAME = "diagnostics_training_report.json"

NON_ISSUE_LABEL_PHRASES = (
    "no pathogen",
    "all negative",
    "negative",
    "healthy",
    "no issue",
    "no disease",
)


@dataclasses.dataclass
class TrainingAsset:
    unique_id: str
    label: str
    asset_kind: str
    bucket: str
    storage_path: str
    file_name: str
    mime_type: str
    public_url: str = ""
    plant_folder: str = ""
    commonname: str = ""
    locationcode: str = ""
    lotcode: str = ""
    contsize: str = ""
    itemcode: str = ""
    metadata: Dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class PreparedSample:
    source_asset_id: str
    image_path: pathlib.Path
    label: str
    file_name: str
    extracted_from_pdf: bool = False


class DiagnosticsTrainingError(RuntimeError):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_diagnostic_label(value: Any) -> str:
    text = normalize_key(value)
    text = text.replace("(", " ").replace(")", " ")
    if not text:
        return ""
    if any(phrase in text for phrase in NON_ISSUE_LABEL_PHRASES):
        return "healthy/no pathogen found"
    replacements = {
        "phompsis": "phomopsis",
        "anthraenoge": "anthracnose",
        "anthrancnose": "anthracnose",
        "fausarium": "fusarium",
        "colletrichum": "colletotrichum",
        "botrysphaeria": "botryosphaeria",
        "botrysphaeria": "botryosphaeria",
        "pestalotia": "pestalotiopsis",
        "catapiller": "caterpillar",
        "leaf spot leaf spot": "leaf spot",
        "mosiac": "mosaic",
        "cucumber mosaic": "virus/mosaic",
        "tobacco streak": "virus/mosaic",
        "arabis mosaic": "virus/mosaic",
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    text = re.sub(r"\b(?:cmv|tsv)\b", "", text)
    if "mosaic" in text:
        text = "virus/mosaic"
    text = re.sub(r"\bsp\.?\b|\bspp\.?\b", " ", text)
    text = re.sub(r"\b\d+\b", " ", text)
    parts = []
    seen = set()
    for part in re.split(r"\s*;\s*", text):
        clean = " ".join(part.split()).strip(" .,-_/")
        if clean and clean not in seen:
            seen.add(clean)
            parts.append(clean)
    return "; ".join(parts)


def label_from_asset(row: Dict[str, Any]) -> str:
    label = first_non_empty(row.get("label"), row.get("diagnosis"))
    if label:
        return normalize_diagnostic_label(label)
    file_name = first_non_empty(row.get("file_name"), row.get("source_file_title"), row.get("storage_path"))
    stem = pathlib.Path(file_name).stem
    parts = [part.strip() for part in stem.replace("_", " ").split("-") if part.strip()]
    if len(parts) > 1:
        return normalize_diagnostic_label(" ".join(parts[1:]))
    return normalize_diagnostic_label(row.get("plant_folder") or row.get("folder_path"))


def asset_from_row(row: Dict[str, Any], default_bucket: str) -> Optional[TrainingAsset]:
    storage_path = first_non_empty(row.get("storage_path"))
    unique_id = first_non_empty(row.get("unique_id"))
    label = label_from_asset(row)
    if not unique_id or not storage_path or not label:
        return None
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return TrainingAsset(
        unique_id=unique_id,
        label=label,
        asset_kind=first_non_empty(row.get("asset_kind"), default="other"),
        bucket=first_non_empty(row.get("bucket"), default=default_bucket),
        storage_path=storage_path,
        file_name=first_non_empty(row.get("file_name"), row.get("source_file_title"), pathlib.Path(storage_path).name),
        mime_type=first_non_empty(row.get("mime_type")),
        public_url=first_non_empty(row.get("public_url")),
        plant_folder=first_non_empty(row.get("plant_folder")),
        commonname=first_non_empty(row.get("commonname")),
        locationcode=first_non_empty(row.get("locationcode")),
        lotcode=first_non_empty(row.get("lotcode")),
        contsize=first_non_empty(row.get("contsize")),
        itemcode=first_non_empty(row.get("itemcode")),
        metadata=metadata,
    )


def fetch_training_assets(client: RestSupabaseClient, config: WorkerConfig, max_assets: int = 0) -> List[TrainingAsset]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    limit = 1000
    while True:
        response = (
            client.table(config.training_assets_table)
            .select("*")
            .order("created_at")
            .limit(limit)
            .offset(offset)
            .execute()
        )
        batch = list(response.data or [])
        if not batch:
            break
        rows.extend(batch)
        if max_assets and len(rows) >= max_assets:
            rows = rows[:max_assets]
            break
        if len(batch) < limit:
            break
        offset += len(batch)

    assets = []
    for row in rows:
        asset = asset_from_row(row, config.training_assets_bucket)
        if asset:
            assets.append(asset)
    return assets


def is_image_asset(asset: TrainingAsset) -> bool:
    suffix = pathlib.Path(asset.file_name or asset.storage_path).suffix.lower()
    mime = asset.mime_type.lower()
    return suffix in IMAGE_EXTENSIONS or mime.startswith("image/")


def is_pdf_asset(asset: TrainingAsset) -> bool:
    suffix = pathlib.Path(asset.file_name or asset.storage_path).suffix.lower()
    return suffix in PDF_EXTENSIONS or asset.mime_type.lower() == "application/pdf"


def write_downloaded_asset(client: RestSupabaseClient, asset: TrainingAsset, target_dir: pathlib.Path) -> pathlib.Path:
    extension = pathlib.Path(asset.file_name or asset.storage_path).suffix.lower()
    if not extension:
        extension = ".bin"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{asset.unique_id}{extension}"
    target.write_bytes(client.storage.from_(asset.bucket).download(asset.storage_path))
    return target


def verify_and_copy_image(source: pathlib.Path, target: pathlib.Path) -> bool:
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((2400, 2400))
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, format="JPEG", quality=92)
        return True
    except (UnidentifiedImageError, OSError) as exc:
        LOGGER.warning("Skipping unreadable image %s: %s", source.name, exc)
        return False


def extract_pdf_images(pdf_path: pathlib.Path, output_dir: pathlib.Path, max_images: int) -> List[pathlib.Path]:
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        raise DiagnosticsTrainingError("PyMuPDF is required to extract images from lab-report PDFs.") from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    extracted: List[pathlib.Path] = []
    document = fitz.open(str(pdf_path))
    try:
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            for image_index, image_info in enumerate(page.get_images(full=True)):
                if len(extracted) >= max_images:
                    return extracted
                xref = image_info[0]
                pixmap = fitz.Pixmap(document, xref)
                try:
                    if pixmap.width < 180 or pixmap.height < 180:
                        continue
                    if pixmap.n >= 5:
                        pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
                    output_path = output_dir / f"{pdf_path.stem}-p{page_index + 1}-img{image_index + 1}.jpg"
                    pixmap.save(str(output_path))
                    extracted.append(output_path)
                finally:
                    pixmap = None
    finally:
        document.close()
    return extracted


def prepare_samples(
    client: RestSupabaseClient,
    assets: Sequence[TrainingAsset],
    work_dir: pathlib.Path,
    include_pdf_images: bool,
    max_pdf_images_per_asset: int,
) -> Tuple[List[PreparedSample], Dict[str, Any]]:
    source_dir = work_dir / "source"
    sample_dir = work_dir / "samples"
    pdf_image_dir = work_dir / "pdf-images"
    samples: List[PreparedSample] = []
    stats: Dict[str, Any] = {
        "assets_seen": len(assets),
        "image_assets": 0,
        "pdf_assets": 0,
        "pdf_images_extracted": 0,
        "skipped_assets": 0,
        "skipped_reasons": Counter(),
    }

    for asset in assets:
        try:
            if is_image_asset(asset):
                stats["image_assets"] += 1
                downloaded = write_downloaded_asset(client, asset, source_dir)
                target = sample_dir / asset.label / f"{asset.unique_id}.jpg"
                if verify_and_copy_image(downloaded, target):
                    samples.append(PreparedSample(asset.unique_id, target, asset.label, asset.file_name))
                else:
                    stats["skipped_assets"] += 1
                    stats["skipped_reasons"]["unreadable_image"] += 1
            elif include_pdf_images and is_pdf_asset(asset):
                stats["pdf_assets"] += 1
                downloaded = write_downloaded_asset(client, asset, source_dir)
                extracted_images = extract_pdf_images(downloaded, pdf_image_dir / asset.unique_id, max_pdf_images_per_asset)
                stats["pdf_images_extracted"] += len(extracted_images)
                if not extracted_images:
                    stats["skipped_assets"] += 1
                    stats["skipped_reasons"]["pdf_without_embedded_images"] += 1
                for index, image_path in enumerate(extracted_images, start=1):
                    target = sample_dir / asset.label / f"{asset.unique_id}-{index}.jpg"
                    if verify_and_copy_image(image_path, target):
                        samples.append(PreparedSample(asset.unique_id, target, asset.label, asset.file_name, extracted_from_pdf=True))
            else:
                stats["skipped_assets"] += 1
                stats["skipped_reasons"]["unsupported_asset_type"] += 1
        except Exception as exc:
            LOGGER.warning("Skipping asset %s (%s): %s", asset.unique_id, asset.file_name, exc)
            stats["skipped_assets"] += 1
            stats["skipped_reasons"]["download_or_extract_failed"] += 1

    stats["skipped_reasons"] = dict(stats["skipped_reasons"])
    return samples, stats


class DiagnosticsImageDataset:
    def __init__(self, samples: Sequence[PreparedSample], label_to_index: Dict[str, int], transform: Any):
        self.samples = list(samples)
        self.label_to_index = dict(label_to_index)
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> Tuple[Any, int]:
        sample = self.samples[index]
        with Image.open(sample.image_path) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            tensor = self.transform(image)
        return tensor, self.label_to_index[sample.label]


def split_samples(samples: Sequence[PreparedSample], validation_ratio: float, seed: int) -> Tuple[List[PreparedSample], List[PreparedSample]]:
    by_label: Dict[str, List[PreparedSample]] = defaultdict(list)
    for sample in samples:
        by_label[sample.label].append(sample)

    rng = random.Random(seed)
    train: List[PreparedSample] = []
    validation: List[PreparedSample] = []
    for label, label_samples in by_label.items():
        label_samples = list(label_samples)
        rng.shuffle(label_samples)
        if len(label_samples) >= 4:
            validation_count = max(1, int(round(len(label_samples) * validation_ratio)))
            validation.extend(label_samples[:validation_count])
            train.extend(label_samples[validation_count:])
        else:
            train.extend(label_samples)

    if not validation and len(train) > 5:
        rng.shuffle(train)
        validation_count = max(1, int(round(len(train) * validation_ratio)))
        validation = train[:validation_count]
        train = train[validation_count:]
    return train, validation


def build_model(class_count: int, use_pretrained: bool) -> Any:
    import torch
    from torchvision import models

    weights = None
    if use_pretrained:
        try:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
        except Exception:
            weights = None

    try:
        model = models.mobilenet_v3_small(weights=weights)
    except Exception as exc:
        LOGGER.warning("Could not load pretrained MobileNet weights; training from scratch: %s", exc)
        model = models.mobilenet_v3_small(weights=None)

    input_features = model.classifier[-1].in_features
    model.classifier[-1] = torch.nn.Linear(input_features, class_count)
    return model


def train_model(
    samples: Sequence[PreparedSample],
    output_dir: pathlib.Path,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    validation_ratio: float,
    use_pretrained: bool,
) -> Dict[str, Any]:
    import torch
    from torch.utils.data import DataLoader, WeightedRandomSampler
    from torchvision import transforms

    labels = sorted({sample.label for sample in samples})
    if len(labels) < 2:
        raise DiagnosticsTrainingError("Need at least two diagnostic labels to train a classifier.")
    if len(samples) < len(labels):
        raise DiagnosticsTrainingError("Training sample count is lower than class count.")

    random.seed(seed)
    torch.manual_seed(seed)
    train_samples, validation_samples = split_samples(samples, validation_ratio, seed)
    if not train_samples:
        raise DiagnosticsTrainingError("No training samples available after split.")

    label_to_index = {label: index for index, label in enumerate(labels)}
    train_transform = transforms.Compose(
        [
            transforms.Resize((256, 256)),
            transforms.RandomResizedCrop((224, 224), scale=(0.75, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.12),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    eval_transform = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    train_dataset = DiagnosticsImageDataset(train_samples, label_to_index, train_transform)
    validation_dataset = DiagnosticsImageDataset(validation_samples, label_to_index, eval_transform)

    label_counts = Counter(sample.label for sample in train_samples)
    weights = [1.0 / max(1, label_counts[sample.label]) for sample in train_samples]
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, sampler=sampler, num_workers=0)
    validation_loader = DataLoader(validation_dataset, batch_size=batch_size, shuffle=False, num_workers=0) if validation_samples else None

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model(len(labels), use_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    criterion = torch.nn.CrossEntropyLoss()

    history: List[Dict[str, Any]] = []
    for epoch in range(1, epochs + 1):
        started = time.time()
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        for images, targets in train_loader:
            images = images.to(device)
            targets = targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = criterion(logits, targets)
            loss.backward()
            optimizer.step()

            train_loss += float(loss.item()) * targets.size(0)
            train_correct += int((logits.argmax(dim=1) == targets).sum().item())
            train_total += int(targets.size(0))

        validation_loss = None
        validation_accuracy = None
        if validation_loader:
            model.eval()
            val_loss_sum = 0.0
            val_correct = 0
            val_total = 0
            with torch.no_grad():
                for images, targets in validation_loader:
                    images = images.to(device)
                    targets = targets.to(device)
                    logits = model(images)
                    loss = criterion(logits, targets)
                    val_loss_sum += float(loss.item()) * targets.size(0)
                    val_correct += int((logits.argmax(dim=1) == targets).sum().item())
                    val_total += int(targets.size(0))
            if val_total:
                validation_loss = val_loss_sum / val_total
                validation_accuracy = val_correct / val_total

        epoch_result = {
            "epoch": epoch,
            "train_loss": train_loss / max(1, train_total),
            "train_accuracy": train_correct / max(1, train_total),
            "validation_loss": validation_loss,
            "validation_accuracy": validation_accuracy,
            "seconds": round(time.time() - started, 2),
        }
        history.append(epoch_result)
        LOGGER.info(
            "Epoch %s/%s train_acc=%.3f val_acc=%s",
            epoch,
            epochs,
            epoch_result["train_accuracy"],
            "n/a" if validation_accuracy is None else f"{validation_accuracy:.3f}",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    model.eval()
    cpu_model = model.to("cpu")
    example = torch.zeros(1, 3, 224, 224)
    scripted = torch.jit.trace(cpu_model, example)
    model_path = output_dir / DEFAULT_MODEL_NAME
    scripted.save(str(model_path))

    class_counts = Counter(sample.label for sample in samples)
    labels_payload = [
        {
            "label": label,
            "diagnosis": label,
            "treatment": default_treatment_for_label(label),
            "sample_count": class_counts[label],
        }
        for label in labels
    ]
    labels_path = output_dir / DEFAULT_LABELS_NAME
    labels_path.write_text(json.dumps(labels_payload, indent=2, sort_keys=True), encoding="utf-8")

    report = {
        "created_at": utc_now_iso(),
        "model_path": str(model_path),
        "labels_path": str(labels_path),
        "class_count": len(labels),
        "sample_count": len(samples),
        "train_sample_count": len(train_samples),
        "validation_sample_count": len(validation_samples),
        "class_counts": dict(sorted(class_counts.items())),
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "use_pretrained": use_pretrained,
        "device": str(device),
        "history": history,
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def default_treatment_for_label(label: str) -> str:
    if label == "healthy/no pathogen found":
        return "No treatment recommended. Keep monitoring crop condition."
    return "Review matching lab report and current crop condition before selecting treatment."


def build_readiness_report(samples: Sequence[PreparedSample], prep_stats: Dict[str, Any], output_dir: pathlib.Path) -> Dict[str, Any]:
    label_counts = Counter(sample.label for sample in samples)
    report = {
        "created_at": utc_now_iso(),
        "ready_to_train": len(label_counts) >= 2 and len(samples) >= len(label_counts),
        "sample_count": len(samples),
        "class_count": len(label_counts),
        "class_counts": dict(sorted(label_counts.items())),
        "prep_stats": prep_stats,
        "message": "",
    }
    if not report["ready_to_train"]:
        report["message"] = (
            "Not enough visual samples were found to train diagnostics_classifier.pt. "
            "Add disease photos or lab-report PDFs with extractable embedded photos, then rerun this workflow."
        )
    else:
        report["message"] = "Visual samples are ready for training."
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / DEFAULT_REPORT_NAME).write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train GNC diagnostics model from Supabase disease assets.")
    parser.add_argument("--output-dir", default=os.environ.get("DIAGNOSTICS_MODEL_OUTPUT_DIR", str(DEFAULT_OUTPUT_DIR)))
    parser.add_argument("--epochs", type=int, default=int(os.environ.get("DIAGNOSTICS_TRAIN_EPOCHS", "8")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("DIAGNOSTICS_TRAIN_BATCH_SIZE", "12")))
    parser.add_argument("--learning-rate", type=float, default=float(os.environ.get("DIAGNOSTICS_TRAIN_LR", "0.0004")))
    parser.add_argument("--validation-ratio", type=float, default=float(os.environ.get("DIAGNOSTICS_VALIDATION_RATIO", "0.18")))
    parser.add_argument("--seed", type=int, default=int(os.environ.get("DIAGNOSTICS_TRAIN_SEED", "20260516")))
    parser.add_argument("--max-assets", type=int, default=int(os.environ.get("DIAGNOSTICS_MAX_ASSETS", "0")))
    parser.add_argument("--max-pdf-images", type=int, default=int(os.environ.get("DIAGNOSTICS_MAX_PDF_IMAGES", "4")))
    parser.add_argument("--no-pdf-images", action="store_true", default=os.environ.get("DIAGNOSTICS_EXTRACT_PDF_IMAGES", "true").lower() in {"0", "false", "no"})
    parser.add_argument("--no-pretrained", action="store_true", default=os.environ.get("DIAGNOSTICS_USE_PRETRAINED", "true").lower() in {"0", "false", "no"})
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("DIAGNOSTICS_DRY_RUN", "false").lower() in {"1", "true", "yes"})
    return parser.parse_args(argv)


def configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass

    configure_logging()
    args = parse_args(argv)
    config = WorkerConfig.from_env()
    client = RestSupabaseClient(config.supabase_url, config.supabase_service_role_key)
    output_dir = pathlib.Path(args.output_dir)

    assets = fetch_training_assets(client, config, max_assets=args.max_assets)
    LOGGER.info("Fetched %s disease training asset row(s).", len(assets))
    if not assets:
        raise DiagnosticsTrainingError("No disease training assets found in Supabase.")

    with tempfile.TemporaryDirectory(prefix="gnc-diagnostics-train-") as temp_root:
        samples, prep_stats = prepare_samples(
            client,
            assets,
            pathlib.Path(temp_root),
            include_pdf_images=not args.no_pdf_images,
            max_pdf_images_per_asset=max(1, args.max_pdf_images),
        )
        readiness = build_readiness_report(samples, prep_stats, output_dir)
        LOGGER.info(
            "Prepared %s visual sample(s) across %s label(s).",
            readiness["sample_count"],
            readiness["class_count"],
        )
        if args.dry_run:
            print(json.dumps(readiness, indent=2, sort_keys=True))
            return 0 if readiness["ready_to_train"] else 2
        if not readiness["ready_to_train"]:
            print(json.dumps(readiness, indent=2, sort_keys=True))
            return 2
        report = train_model(
            samples,
            output_dir=output_dir,
            epochs=max(1, args.epochs),
            batch_size=max(1, args.batch_size),
            learning_rate=args.learning_rate,
            seed=args.seed,
            validation_ratio=min(0.5, max(0.0, args.validation_ratio)),
            use_pretrained=not args.no_pretrained,
        )
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
