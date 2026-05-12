#!/usr/bin/env python3
"""Continuous Supabase-backed ML worker for GNC mobile AI Capture photos."""

from __future__ import annotations

import dataclasses
import io
import json
import logging
import mimetypes
import os
import pathlib
import socket
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple


LOGGER = logging.getLogger("gnc.supabase_ml_worker")
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
DEFAULT_JOB_TABLE = "v2_ml_image_jobs"
DEFAULT_PHOTO_BUCKET = "ml_capture_photos"
DEFAULT_MODELS_DIR = pathlib.Path("models")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def first_non_empty(*values: Any, default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def normalize_key(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def normalize_compact(value: Any) -> str:
    return "".join(char for char in normalize_key(value) if char.isalnum())


def normalize_grade(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text in {"A", "B", "C", "D", "X", "S1", "F1", "U1", "U2", "U3"}:
        return text
    return ""


def map_model_grade_to_app_grade(model_grade: Any, selected_season: Any) -> str:
    raw = normalize_grade(model_grade)
    season = normalize_grade(selected_season)
    if raw in {"S1", "F1", "U1", "U2", "U3", "X"}:
        return raw
    if raw == "A":
        return season if season in {"S1", "F1"} else "F1"
    if raw == "B":
        return "U1"
    if raw == "C":
        return "U2"
    if raw == "D":
        return "U3"
    return "X"


def parse_label_entry(label: Any) -> Dict[str, str]:
    if isinstance(label, dict):
        return {
            "label": str(label.get("label") or label.get("name") or "").strip(),
            "genus": str(label.get("genus") or label.get("genus_name") or "").strip(),
            "common_name": str(label.get("common_name") or label.get("commonname") or "").strip(),
            "grade": normalize_grade(label.get("grade") or label.get("class_grade") or ""),
            "diagnosis": str(label.get("diagnosis") or "").strip(),
            "treatment": str(label.get("treatment") or label.get("recommended_treatment") or "").strip(),
        }

    text = str(label or "").strip()
    parts = [part.strip() for part in text.replace(";", "|").split("|")]
    genus = parts[0] if len(parts) >= 1 else ""
    common_name = parts[1] if len(parts) >= 2 else ""
    grade = normalize_grade(parts[2] if len(parts) >= 3 else "")
    return {
        "label": text,
        "genus": genus,
        "common_name": common_name,
        "grade": grade,
        "diagnosis": text,
        "treatment": "",
    }


def load_labels(path: pathlib.Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    if path.suffix.lower() == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and "labels" in raw:
            raw = raw["labels"]
        if isinstance(raw, dict):
            ordered = [raw[key] for key in sorted(raw.keys(), key=lambda value: int(value) if str(value).isdigit() else str(value))]
            return [parse_label_entry(item) for item in ordered]
        if isinstance(raw, list):
            return [parse_label_entry(item) for item in raw]
    return [parse_label_entry(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def choose_first_existing(paths: Iterable[pathlib.Path]) -> Optional[pathlib.Path]:
    for path in paths:
        if path and path.exists():
            return path
    return None


def find_latest_model(models_dir: pathlib.Path, names: Iterable[str] = ()) -> Optional[pathlib.Path]:
    candidates: List[pathlib.Path] = []
    for name in names:
        if not name:
            continue
        path = pathlib.Path(name)
        if not path.is_absolute():
            path = models_dir / path
        if path.exists():
            candidates.append(path)
    for suffix in (".pt", ".pth"):
        candidates.extend(models_dir.glob(f"*{suffix}"))
    candidates = [path for path in candidates if path.is_file()]
    if not candidates:
        return None
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)[0]


def find_latest_labels(models_dir: pathlib.Path, explicit_path: str = "") -> Optional[pathlib.Path]:
    explicit = pathlib.Path(explicit_path) if explicit_path else None
    if explicit and not explicit.is_absolute():
        explicit = models_dir / explicit
    candidates = []
    if explicit:
        candidates.append(explicit)
    candidates.extend(models_dir.glob("*labels*.json"))
    candidates.extend(models_dir.glob("*labels*.txt"))
    return choose_first_existing(candidates)


@dataclasses.dataclass
class WorkerConfig:
    supabase_url: str
    supabase_service_role_key: str
    drive_inventory_file_id: str
    drive_service_account_json: str
    job_table: str = DEFAULT_JOB_TABLE
    photo_bucket: str = DEFAULT_PHOTO_BUCKET
    poll_seconds: float = 10.0
    batch_size: int = 3
    stale_processing_minutes: int = 30
    models_dir: pathlib.Path = DEFAULT_MODELS_DIR
    model_path: str = ""
    labels_path: str = ""
    diagnostics_model_path: str = ""
    diagnostics_labels_path: str = ""
    confidence_threshold: float = 0.62
    inventory_refresh_seconds: int = 900

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        return cls(
            supabase_url=first_non_empty(os.environ.get("SUPABASE_URL")),
            supabase_service_role_key=first_non_empty(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"), os.environ.get("SUPABASE_KEY")),
            drive_inventory_file_id=first_non_empty(os.environ.get("GDRIVE_INVENTORY_FILE_ID")),
            drive_service_account_json=first_non_empty(os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON"), os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")),
            job_table=first_non_empty(os.environ.get("ML_JOB_TABLE"), default=DEFAULT_JOB_TABLE),
            photo_bucket=first_non_empty(os.environ.get("ML_PHOTO_BUCKET"), default=DEFAULT_PHOTO_BUCKET),
            poll_seconds=float(first_non_empty(os.environ.get("ML_POLL_SECONDS"), default="10")),
            batch_size=int(first_non_empty(os.environ.get("ML_BATCH_SIZE"), default="3")),
            stale_processing_minutes=int(first_non_empty(os.environ.get("ML_STALE_PROCESSING_MINUTES"), default="30")),
            models_dir=pathlib.Path(first_non_empty(os.environ.get("ML_MODELS_DIR"), default=str(DEFAULT_MODELS_DIR))),
            model_path=first_non_empty(os.environ.get("ML_MODEL_PATH")),
            labels_path=first_non_empty(os.environ.get("ML_LABELS_PATH")),
            diagnostics_model_path=first_non_empty(os.environ.get("ML_DIAGNOSTICS_MODEL_PATH")),
            diagnostics_labels_path=first_non_empty(os.environ.get("ML_DIAGNOSTICS_LABELS_PATH")),
            confidence_threshold=float(first_non_empty(os.environ.get("ML_CONFIDENCE_THRESHOLD"), default="0.62")),
            inventory_refresh_seconds=int(first_non_empty(os.environ.get("ML_INVENTORY_REFRESH_SECONDS"), default="900")),
        )

    def validate(self) -> None:
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL")
        if not self.supabase_service_role_key:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if not self.drive_inventory_file_id:
            missing.append("GDRIVE_INVENTORY_FILE_ID")
        if not self.drive_service_account_json:
            missing.append("GDRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS")
        if missing:
            raise RuntimeError("Missing required environment value(s): " + ", ".join(missing))


@dataclasses.dataclass
class InventoryEntry:
    genus: str
    common_name: str
    itemcode: str = ""
    contsize: str = ""
    key: str = ""


class InventoryMatcher:
    def __init__(self, entries: Iterable[InventoryEntry]):
        self.entries = list(entries)
        self.by_common = {}
        self.by_genus_common = {}
        for entry in self.entries:
            common_key = normalize_compact(entry.common_name)
            combined_key = normalize_compact(f"{entry.genus} {entry.common_name}")
            if common_key and common_key not in self.by_common:
                self.by_common[common_key] = entry
            if combined_key and combined_key not in self.by_genus_common:
                self.by_genus_common[combined_key] = entry

    def match(self, genus: str = "", common_name: str = "") -> Tuple[Optional[InventoryEntry], float]:
        common_key = normalize_compact(common_name)
        combined_key = normalize_compact(f"{genus} {common_name}")
        if combined_key and combined_key in self.by_genus_common:
            return self.by_genus_common[combined_key], 1.0
        if common_key and common_key in self.by_common:
            return self.by_common[common_key], 0.98

        query = normalize_key(f"{genus} {common_name}")
        if not query:
            return None, 0.0

        try:
            from rapidfuzz import fuzz

            best_entry = None
            best_score = 0.0
            for entry in self.entries:
                candidate = normalize_key(f"{entry.genus} {entry.common_name}")
                score = float(fuzz.token_set_ratio(query, candidate)) / 100.0
                if score > best_score:
                    best_score = score
                    best_entry = entry
            return best_entry, best_score
        except Exception:
            best_entry = None
            best_score = 0.0
            for entry in self.entries:
                candidate = normalize_key(f"{entry.genus} {entry.common_name}")
                score = SequenceMatcher(None, query, candidate).ratio()
                if score > best_score:
                    best_score = score
                    best_entry = entry
            return best_entry, best_score


def read_service_account_info(raw_value: str) -> Dict[str, Any]:
    value = str(raw_value or "").strip()
    if not value:
        raise RuntimeError("Google service account JSON is required.")
    if not value.startswith("{"):
        path = pathlib.Path(value)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return json.loads(value)


def build_drive_service(service_account_json: str) -> Any:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    credentials = service_account.Credentials.from_service_account_info(
        read_service_account_info(service_account_json),
        scopes=[DRIVE_SCOPE],
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def download_drive_file_bytes(service: Any, file_id: str) -> Tuple[bytes, str]:
    from googleapiclient.http import MediaIoBaseDownload

    metadata = service.files().get(fileId=file_id, fields="id,name,mimeType", supportsAllDrives=True).execute()
    mime_type = str(metadata.get("mimeType") or "")
    if mime_type == "application/vnd.google-apps.spreadsheet":
        request = service.files().export_media(
            fileId=file_id,
            mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        extension = ".xlsx"
    else:
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        extension = pathlib.Path(str(metadata.get("name") or "")).suffix.lower() or mimetypes.guess_extension(mime_type) or ".bin"

    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buffer.getvalue(), extension


def dataframe_to_inventory_entries(dataframe: Any) -> List[InventoryEntry]:
    columns = {normalize_compact(column): column for column in dataframe.columns}

    def column_value(row: Any, *names: str) -> str:
        for name in names:
            column = columns.get(normalize_compact(name))
            if column is not None:
                value = row.get(column)
                if value is not None:
                    text = str(value).strip()
                    if text and text.lower() != "nan":
                        return text
        return ""

    entries: List[InventoryEntry] = []
    for _, row in dataframe.iterrows():
        common_name = column_value(row, "COMMONNAME", "COMMON_NAME", "Common Name", "REVERSECOMMON")
        genus = column_value(row, "GENUSNAME", "GENUS", "Genus")
        if not common_name and not genus:
            continue
        itemcode = column_value(row, "ITEMCODE", "ITEM_CODE")
        contsize = column_value(row, "CONTSIZE", "CONTAINER", "CONTAINER_SIZE")
        key = "|".join(part for part in [itemcode, genus, common_name, contsize] if part)
        entries.append(InventoryEntry(genus=genus, common_name=common_name, itemcode=itemcode, contsize=contsize, key=key))
    return entries


def parse_inventory_file(file_bytes: bytes, extension: str) -> List[InventoryEntry]:
    import pandas as pd

    ext = extension.lower()
    if ext in {".xlsx", ".xls"}:
        dataframe = pd.read_excel(io.BytesIO(file_bytes))
    elif ext in {".csv", ".txt"}:
        dataframe = pd.read_csv(io.BytesIO(file_bytes))
    else:
        raise RuntimeError(f"Unsupported inventory file type: {extension}")
    return dataframe_to_inventory_entries(dataframe)


class InventoryCache:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.matcher = InventoryMatcher([])
        self.loaded_at = datetime.fromtimestamp(0, timezone.utc)

    def get_matcher(self) -> InventoryMatcher:
        age = (utc_now() - self.loaded_at).total_seconds()
        if self.matcher.entries and age < self.config.inventory_refresh_seconds:
            return self.matcher

        service = build_drive_service(self.config.drive_service_account_json)
        file_bytes, extension = download_drive_file_bytes(service, self.config.drive_inventory_file_id)
        entries = parse_inventory_file(file_bytes, extension)
        self.matcher = InventoryMatcher(entries)
        self.loaded_at = utc_now()
        LOGGER.info("Loaded %s inventory row(s) from Google Drive.", len(entries))
        return self.matcher


@dataclasses.dataclass
class Prediction:
    genus: str = ""
    common_name: str = ""
    grade: str = ""
    confidence: float = 0.0
    diagnosis: str = ""
    treatment: str = ""
    manual_review: bool = False
    reason: str = ""


class TorchModelAdapter:
    def __init__(self, model_path: Optional[pathlib.Path], labels_path: Optional[pathlib.Path]):
        self.model_path = model_path
        self.labels_path = labels_path
        self.labels = load_labels(labels_path) if labels_path else []
        self.model = None
        self.torch = None
        self.transforms = None
        self.available = False
        self.reason = ""
        self._load()

    def _load(self) -> None:
        if not self.model_path or not self.model_path.exists():
            self.reason = "No model checkpoint found."
            return
        if not self.labels:
            self.reason = "No label metadata found."
            return

        try:
            import torch
            from torchvision import transforms

            self.torch = torch
            self.transforms = transforms.Compose(
                [
                    transforms.Resize((224, 224)),
                    transforms.ToTensor(),
                    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ]
            )
            try:
                model = torch.jit.load(str(self.model_path), map_location="cpu")
            except Exception:
                loaded = torch.load(str(self.model_path), map_location="cpu")
                if hasattr(loaded, "eval"):
                    model = loaded
                else:
                    self.reason = "Checkpoint is not a TorchScript file or serialized torch.nn.Module."
                    return
            model.eval()
            self.model = model
            self.available = True
        except Exception as exc:
            self.reason = f"Model load failed: {exc}"

    def predict(self, image_path: pathlib.Path) -> Prediction:
        if not self.available:
            return Prediction(manual_review=True, reason=self.reason)

        try:
            from PIL import Image

            image = Image.open(image_path).convert("RGB")
            tensor = self.transforms(image).unsqueeze(0)
            with self.torch.no_grad():
                output = self.model(tensor)
                if isinstance(output, (list, tuple)):
                    output = output[0]
                probabilities = self.torch.softmax(output, dim=1)[0]
                confidence, index = self.torch.max(probabilities, dim=0)
            label_index = int(index.item())
            label = self.labels[label_index] if label_index < len(self.labels) else {}
            confidence_value = float(confidence.item())
            return Prediction(
                genus=str(label.get("genus") or "").strip(),
                common_name=str(label.get("common_name") or label.get("label") or "").strip(),
                grade=normalize_grade(label.get("grade") or ""),
                confidence=confidence_value,
                diagnosis=str(label.get("diagnosis") or "").strip(),
                treatment=str(label.get("treatment") or "").strip(),
                manual_review=False,
            )
        except Exception as exc:
            return Prediction(manual_review=True, reason=f"Prediction failed: {exc}")


class ModelRegistry:
    def __init__(self, config: WorkerConfig):
        plant_model = find_latest_model(config.models_dir, [config.model_path])
        labels_path = find_latest_labels(config.models_dir, config.labels_path)
        self.plant = TorchModelAdapter(plant_model, labels_path)

        diagnostics_model = find_latest_model(config.models_dir, [config.diagnostics_model_path]) if config.diagnostics_model_path else None
        diagnostics_labels = find_latest_labels(config.models_dir, config.diagnostics_labels_path)
        self.diagnostics = TorchModelAdapter(diagnostics_model, diagnostics_labels) if diagnostics_model else None


class SupabaseMlWorker:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.config.validate()
        self.worker_id = f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        self.supabase = self._build_supabase_client()
        self.inventory_cache = InventoryCache(config)
        self.models = ModelRegistry(config)

    def _build_supabase_client(self) -> Any:
        from supabase import create_client

        return create_client(self.config.supabase_url, self.config.supabase_service_role_key)

    def recover_stale_jobs(self) -> None:
        cutoff = (utc_now() - timedelta(minutes=self.config.stale_processing_minutes)).isoformat()
        payload = {
            "status": "pending_ml",
            "processing_started_at": None,
            "worker_id": None,
            "last_error": "Recovered from stale processing state.",
        }
        self.supabase.table(self.config.job_table).update(payload).eq("status", "processing").lt("processing_started_at", cutoff).execute()

    def fetch_pending_jobs(self) -> List[Dict[str, Any]]:
        response = (
            self.supabase.table(self.config.job_table)
            .select("*")
            .eq("status", "pending_ml")
            .order("created_at")
            .limit(self.config.batch_size)
            .execute()
        )
        return list(response.data or [])

    def claim_job(self, job: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        job_id = str(job.get("unique_id") or "").strip()
        if not job_id:
            return None
        payload = {
            "status": "processing",
            "processing_started_at": iso_now(),
            "worker_id": self.worker_id,
            "attempts": int(job.get("attempts") or 0) + 1,
            "last_error": None,
        }
        response = (
            self.supabase.table(self.config.job_table)
            .update(payload)
            .eq("unique_id", job_id)
            .eq("status", "pending_ml")
            .execute()
        )
        rows = list(response.data or [])
        if rows:
            return rows[0]
        return None

    def download_job_image(self, job: Dict[str, Any], target_dir: pathlib.Path) -> pathlib.Path:
        bucket = first_non_empty(job.get("image_bucket"), default=self.config.photo_bucket)
        image_path = first_non_empty(job.get("image_path"))
        if not image_path:
            raise RuntimeError("Job is missing image_path.")

        image_bytes = self.supabase.storage.from_(bucket).download(image_path)
        suffix = pathlib.Path(image_path).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            suffix = ".jpg"
        target_path = target_dir / f"{job.get('unique_id') or uuid.uuid4().hex}{suffix}"
        target_path.write_bytes(image_bytes)
        return target_path

    def build_result_payload(self, job: Dict[str, Any], image_path: pathlib.Path) -> Dict[str, Any]:
        plant_prediction = self.models.plant.predict(image_path)
        diagnostics_prediction = self.models.diagnostics.predict(image_path) if self.models.diagnostics else Prediction(
            diagnosis="Manual review required",
            treatment="No diagnostics model is configured.",
            manual_review=True,
            reason="No diagnostics model is configured.",
        )

        matcher = self.inventory_cache.get_matcher()
        matched_entry, match_score = matcher.match(plant_prediction.genus, plant_prediction.common_name)

        season = first_non_empty(job.get("season"), default="")
        app_grade = map_model_grade_to_app_grade(plant_prediction.grade, season)
        low_confidence = plant_prediction.confidence < self.config.confidence_threshold
        manual_review = bool(plant_prediction.manual_review or diagnostics_prediction.manual_review or low_confidence or not matched_entry)

        genus = plant_prediction.genus
        common_name = plant_prediction.common_name
        if matched_entry:
            genus = matched_entry.genus or genus
            common_name = matched_entry.common_name or common_name

        reason_bits = [
            plant_prediction.reason,
            diagnostics_prediction.reason,
            "Low confidence" if low_confidence else "",
            "No inventory match" if not matched_entry else "",
        ]
        reason = "; ".join(bit for bit in reason_bits if bit)

        return {
            "status": "pending_approval",
            "ml_genus": genus or None,
            "ml_common_name": common_name or None,
            "ml_grade_raw": plant_prediction.grade or None,
            "ml_grade": app_grade,
            "ml_confidence": round(float(plant_prediction.confidence or 0.0), 4),
            "matched_inventory_key": matched_entry.key if matched_entry else None,
            "diagnosis": first_non_empty(diagnostics_prediction.diagnosis, plant_prediction.diagnosis, default="Manual review required" if manual_review else "No visible issue detected."),
            "recommended_treatment": first_non_empty(diagnostics_prediction.treatment, plant_prediction.treatment, default="Review image before logging quantities." if manual_review else "No treatment recommended."),
            "manual_review": manual_review,
            "ml_completed_at": iso_now(),
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": reason or None,
        }

    def mark_failed(self, job: Dict[str, Any], error: Exception) -> None:
        job_id = str(job.get("unique_id") or "").strip()
        if not job_id:
            return
        payload = {
            "status": "ml_failed",
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": str(error),
        }
        self.supabase.table(self.config.job_table).update(payload).eq("unique_id", job_id).execute()

    def process_job(self, job: Dict[str, Any]) -> bool:
        claimed = self.claim_job(job)
        if not claimed:
            return False

        job_id = str(claimed.get("unique_id") or "").strip()
        LOGGER.info("Processing ML job %s", job_id)
        try:
            with tempfile.TemporaryDirectory(prefix="gnc-ml-") as temp_dir:
                image_path = self.download_job_image(claimed, pathlib.Path(temp_dir))
                payload = self.build_result_payload(claimed, image_path)
                self.supabase.table(self.config.job_table).update(payload).eq("unique_id", job_id).execute()
            LOGGER.info("Completed ML job %s", job_id)
            return True
        except Exception as exc:
            LOGGER.exception("ML job %s failed", job_id)
            self.mark_failed(claimed, exc)
            return False

    def run_once(self) -> int:
        self.recover_stale_jobs()
        jobs = self.fetch_pending_jobs()
        processed = 0
        for job in jobs:
            if self.process_job(job):
                processed += 1
        return processed

    def run_forever(self) -> None:
        LOGGER.info("Starting GNC ML worker %s", self.worker_id)
        while True:
            try:
                processed = self.run_once()
                if not processed:
                    time.sleep(self.config.poll_seconds)
            except KeyboardInterrupt:
                LOGGER.info("Stopping worker.")
                return
            except Exception:
                LOGGER.exception("Worker loop error")
                time.sleep(max(5.0, self.config.poll_seconds))


def configure_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def main() -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass

    configure_logging()
    config = WorkerConfig.from_env()
    worker = SupabaseMlWorker(config)
    worker.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
