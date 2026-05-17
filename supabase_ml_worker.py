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
import re
import socket
import tempfile
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple


LOGGER = logging.getLogger("gnc.supabase_ml_worker")
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
DEFAULT_JOB_TABLE = "v2_ml_image_jobs"
DEFAULT_PHOTO_BUCKET = "ml_capture_photos"
DEFAULT_TRAINING_ASSETS_TABLE = "v2_disease_training_assets"
DEFAULT_TRAINING_ASSETS_BUCKET = "disease_training_assets"
DEFAULT_LIVE_EVENT_TABLE = "v2_app_live_events"
DEFAULT_GROWER_SCOUT_REPORTS_TABLE = "v2_grower_scout_reports"
DEFAULT_GROWER_SCOUT_ASSETS_TABLE = "v2_grower_scout_assets"
DEFAULT_GROWER_SCOUT_AUDIO_BUCKET = "grower_scout_audio"
DEFAULT_GROWER_SCOUT_PHOTOS_BUCKET = "grower_scout_photos"
DEFAULT_MODELS_DIR = pathlib.Path("models")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ML_SOURCE_TABLE_ALLOWLIST = {
    "v2_master_inventory",
    "v2_active_request",
    "v2_soc_master",
    "v2_sales_office",
    "v2_inventory_office",
}


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


LOCATION_CODE_RE = re.compile(r"\b[A-Z]\.\d{2}\.\d{3}\b", re.IGNORECASE)
LOT_CODE_RE = re.compile(r"\b\d{2}\.(?:S1|F1|U1|U2|U3|X)\b", re.IGNORECASE)
ITEM_CODE_RE = re.compile(r"\b\d{6}\.\d{3}\.\d\b")
CONTSIZE_RE = re.compile(r"(?:^|[\s_-])(#\s*\d+|\d+\s*(?:DP|GP|GAL|GL|QT|PT)|\d+G|\d+P)(?=$|[\s_-])", re.IGNORECASE)


def normalize_location_code(value: Any) -> str:
    return str(value or "").strip().upper()


def normalize_lot_code(value: Any) -> str:
    return str(value or "").strip().upper()


def normalize_contsize(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().upper())


def parse_asset_filename_fields(value: Any) -> Dict[str, str]:
    name = pathlib.Path(str(value or "")).name
    stem = pathlib.Path(name).stem
    text = urllib.parse.unquote(stem).replace("_", " ").replace("-", " ")
    text = " ".join(text.split())

    location_match = LOCATION_CODE_RE.search(text)
    lot_match = LOT_CODE_RE.search(text)
    item_match = ITEM_CODE_RE.search(text)
    contsize_match = CONTSIZE_RE.search(text)

    common_name = text
    cut_indexes = [
        match.start()
        for match in [location_match, lot_match, item_match, contsize_match]
        if match and match.start() > 0
    ]
    if cut_indexes:
        common_name = text[: min(cut_indexes)]

    common_name = ITEM_CODE_RE.sub(" ", common_name)
    common_name = LOCATION_CODE_RE.sub(" ", common_name)
    common_name = LOT_CODE_RE.sub(" ", common_name)
    common_name = CONTSIZE_RE.sub(" ", common_name)
    common_name = " ".join(common_name.replace("_", " ").replace("-", " ").split())

    return {
        "commonname": common_name,
        "locationcode": normalize_location_code(location_match.group(0) if location_match else ""),
        "lotcode": normalize_lot_code(lot_match.group(0) if lot_match else ""),
        "contsize": normalize_contsize(contsize_match.group(1) if contsize_match else ""),
        "itemcode": item_match.group(0) if item_match else "",
    }


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


def is_actionable_diagnostic_text(value: Any) -> bool:
    text = normalize_key(value)
    if not text:
        return False
    non_actionable_phrases = [
        "manual review required",
        "no visible issue",
        "no issue",
        "no disease",
        "healthy",
        "no treatment recommended",
        "no diagnosis returned",
        "no diagnostics model",
        "diagnostics model is not configured",
        "model is not configured",
        "waiting for ml worker",
        "worker has not processed",
    ]
    return not any(phrase in text for phrase in non_actionable_phrases)


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
    training_assets_table: str = DEFAULT_TRAINING_ASSETS_TABLE
    training_assets_bucket: str = DEFAULT_TRAINING_ASSETS_BUCKET
    app_live_events_table: str = DEFAULT_LIVE_EVENT_TABLE
    grower_scout_reports_table: str = DEFAULT_GROWER_SCOUT_REPORTS_TABLE
    grower_scout_assets_table: str = DEFAULT_GROWER_SCOUT_ASSETS_TABLE
    grower_scout_audio_bucket: str = DEFAULT_GROWER_SCOUT_AUDIO_BUCKET
    grower_scout_photos_bucket: str = DEFAULT_GROWER_SCOUT_PHOTOS_BUCKET
    ollama_url: str = "http://localhost:11434"
    scout_summary_model: str = "qwen2.5:3b-instruct"
    whisper_model_size: str = "base"
    push_function_url: str = ""
    pest_management_alert_usernames: str = "dylan_collyge"
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
            training_assets_table=first_non_empty(os.environ.get("ML_TRAINING_ASSETS_TABLE"), default=DEFAULT_TRAINING_ASSETS_TABLE),
            training_assets_bucket=first_non_empty(os.environ.get("ML_TRAINING_ASSETS_BUCKET"), default=DEFAULT_TRAINING_ASSETS_BUCKET),
            app_live_events_table=first_non_empty(os.environ.get("APP_LIVE_EVENTS_TABLE"), default=DEFAULT_LIVE_EVENT_TABLE),
            grower_scout_reports_table=first_non_empty(os.environ.get("GROWER_SCOUT_REPORTS_TABLE"), default=DEFAULT_GROWER_SCOUT_REPORTS_TABLE),
            grower_scout_assets_table=first_non_empty(os.environ.get("GROWER_SCOUT_ASSETS_TABLE"), default=DEFAULT_GROWER_SCOUT_ASSETS_TABLE),
            grower_scout_audio_bucket=first_non_empty(os.environ.get("GROWER_SCOUT_AUDIO_BUCKET"), default=DEFAULT_GROWER_SCOUT_AUDIO_BUCKET),
            grower_scout_photos_bucket=first_non_empty(os.environ.get("GROWER_SCOUT_PHOTOS_BUCKET"), default=DEFAULT_GROWER_SCOUT_PHOTOS_BUCKET),
            ollama_url=first_non_empty(os.environ.get("OLLAMA_URL"), default="http://localhost:11434"),
            scout_summary_model=first_non_empty(os.environ.get("SCOUT_SUMMARY_MODEL"), default="qwen2.5:3b-instruct"),
            whisper_model_size=first_non_empty(os.environ.get("WHISPER_MODEL_SIZE"), default="base"),
            push_function_url=first_non_empty(os.environ.get("PUSH_FUNCTION_URL")),
            pest_management_alert_usernames=first_non_empty(os.environ.get("PEST_MANAGEMENT_ALERT_USERNAMES"), default="dylan_collyge"),
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


def extract_lab_report_text(path: pathlib.Path, max_chars: int = 24000) -> str:
    suffix = path.suffix.lower()
    text = ""
    if suffix == ".pdf":
        try:
            import fitz

            with fitz.open(str(path)) as document:
                chunks = []
                for page in document:
                    page_text = page.get_text("text") or ""
                    if page_text.strip():
                        chunks.append(page_text)
                    if sum(len(chunk) for chunk in chunks) >= max_chars:
                        break
                text = "\n".join(chunks)
        except Exception as exc:
            LOGGER.warning("Could not extract PDF lab report text from %s: %s", path.name, exc)
    elif suffix in {".txt", ".csv"}:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            text = path.read_text(errors="ignore")
    cleaned = re.sub(r"[ \t]+", " ", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()[:max_chars]


def rewrite_lab_report_text(report_text: str, label: str = "", file_name: str = "") -> str:
    text = " ".join(str(report_text or "").replace("\r", "\n").split())
    diagnosis = first_non_empty(label, default="Referenced lab report")
    title = first_non_empty(file_name, default="Lab report")
    if not text:
        return f"{title}\n\nDiagnosis referenced by the ML worker: {diagnosis}.\n\nNo extractable report text was found in the uploaded lab file."
    sentences = re.split(r"(?<=[.!?])\s+", text)
    selected: List[str] = []
    priority_patterns = [
        r"diagnos",
        r"identif",
        r"isolat",
        r"symptom",
        r"recommend",
        r"treat",
        r"fung",
        r"pest",
        r"sample",
    ]
    for sentence in sentences:
        clean = sentence.strip()
        if not clean:
            continue
        if any(re.search(pattern, clean, re.IGNORECASE) for pattern in priority_patterns):
            selected.append(clean)
        if len(selected) >= 8:
            break
    if len(selected) < 4:
        selected = [sentence.strip() for sentence in sentences[:8] if sentence.strip()]
    body = "\n".join(f"- {sentence}" for sentence in selected)
    return (
        f"{title}\n\n"
        f"Referenced diagnosis: {diagnosis}.\n\n"
        "Rewritten lab report notes:\n"
        f"{body}"
    ).strip()


class InventoryCache:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.matcher = InventoryMatcher([])
        self.loaded_at = datetime.fromtimestamp(0, timezone.utc)

    def load_from_supabase_inventory(self) -> List[InventoryEntry]:
        client = RestSupabaseClient(self.config.supabase_url, self.config.supabase_service_role_key)
        entries: List[InventoryEntry] = []
        offset = 0
        limit = 1000
        while True:
            response = (
                client.table("v2_master_inventory")
                .select("*")
                .order("commonname")
                .limit(limit)
                .offset(offset)
                .execute()
            )
            rows = list(response.data or [])
            if not rows:
                break
            for row in rows:
                common_name = first_non_empty(row.get("commonname"), row.get("COMMONNAME"))
                genus = first_non_empty(row.get("genusname"), row.get("GENUSNAME"), row.get("genus"), row.get("GENUS"))
                if not common_name and not genus:
                    continue
                itemcode = first_non_empty(row.get("itemcode"), row.get("ITEMCODE"))
                contsize = first_non_empty(row.get("contsize"), row.get("CONTSIZE"))
                key = "|".join(part for part in [itemcode, genus, common_name, contsize] if part)
                entries.append(InventoryEntry(genus=genus, common_name=common_name, itemcode=itemcode, contsize=contsize, key=key))
            if len(rows) < limit:
                break
            offset += len(rows)
        return entries

    def load_from_drive_inventory(self) -> List[InventoryEntry]:
        service = build_drive_service(self.config.drive_service_account_json)
        file_bytes, extension = download_drive_file_bytes(service, self.config.drive_inventory_file_id)
        return parse_inventory_file(file_bytes, extension)

    def get_matcher(self) -> InventoryMatcher:
        age = (utc_now() - self.loaded_at).total_seconds()
        if self.matcher.entries and age < self.config.inventory_refresh_seconds:
            return self.matcher

        entries: List[InventoryEntry] = []
        drive_error = None
        if self.config.drive_inventory_file_id and self.config.drive_service_account_json:
            try:
                entries = self.load_from_drive_inventory()
                LOGGER.info("Loaded %s inventory row(s) from Google Drive.", len(entries))
            except Exception as exc:
                drive_error = exc
                LOGGER.warning("Could not load inventory from Google Drive; falling back to Supabase v2_master_inventory: %s", exc)
        if not entries:
            entries = self.load_from_supabase_inventory()
            LOGGER.info("Loaded %s inventory row(s) from Supabase v2_master_inventory.", len(entries))
        if not entries and drive_error:
            raise RuntimeError(f"Inventory loading failed. Drive error: {drive_error}")
        self.matcher = InventoryMatcher(entries)
        self.loaded_at = utc_now()
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


@dataclasses.dataclass
class DiseaseReference:
    unique_id: str
    label: str
    asset_kind: str
    plant_folder: str = ""
    commonname: str = ""
    locationcode: str = ""
    lotcode: str = ""
    contsize: str = ""
    itemcode: str = ""
    file_name: str = ""
    public_url: str = ""
    report_text: str = ""
    report_rewrite: str = ""


def disease_reference_from_row(row: Dict[str, Any]) -> DiseaseReference:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    parsed = metadata.get("parsed_file_fields") if isinstance(metadata.get("parsed_file_fields"), dict) else {}
    parsed_from_name = parse_asset_filename_fields(first_non_empty(row.get("file_name"), row.get("source_file_title"), row.get("storage_path")))
    return DiseaseReference(
        unique_id=first_non_empty(row.get("unique_id")),
        label=first_non_empty(row.get("label"), row.get("diagnosis")),
        asset_kind=first_non_empty(row.get("asset_kind")),
        plant_folder=first_non_empty(row.get("plant_folder"), parsed.get("plantFolder"), row.get("folder_path")),
        commonname=first_non_empty(row.get("commonname"), parsed.get("commonname"), parsed_from_name.get("commonname")),
        locationcode=normalize_location_code(first_non_empty(row.get("locationcode"), parsed.get("locationcode"), parsed_from_name.get("locationcode"))),
        lotcode=normalize_lot_code(first_non_empty(row.get("lotcode"), parsed.get("lotcode"), parsed_from_name.get("lotcode"))),
        contsize=normalize_contsize(first_non_empty(row.get("contsize"), parsed.get("contsize"), parsed_from_name.get("contsize"))),
        itemcode=first_non_empty(row.get("itemcode"), parsed.get("itemcode"), parsed_from_name.get("itemcode")),
        file_name=first_non_empty(row.get("file_name"), row.get("source_file_title")),
        public_url=first_non_empty(row.get("public_url")),
        report_text=first_non_empty(row.get("report_text")),
        report_rewrite=first_non_empty(row.get("report_rewrite")),
    )


class DiseaseReferenceCache:
    def __init__(self, config: WorkerConfig, supabase: Any):
        self.config = config
        self.supabase = supabase
        self.references: List[DiseaseReference] = []
        self.loaded_at = datetime.fromtimestamp(0, timezone.utc)

    def get_references(self) -> List[DiseaseReference]:
        age = (utc_now() - self.loaded_at).total_seconds()
        if self.references and age < self.config.inventory_refresh_seconds:
            return self.references

        references: List[DiseaseReference] = []
        offset = 0
        limit = 1000
        try:
            while True:
                response = (
                    self.supabase.table(self.config.training_assets_table)
                    .select("*")
                    .order("created_at")
                    .limit(limit)
                    .offset(offset)
                    .execute()
                )
                rows = list(response.data or [])
                if not rows:
                    break
                for row in rows:
                    reference = disease_reference_from_row(row)
                    if reference.unique_id and reference.label:
                        references.append(reference)
                if len(rows) < limit:
                    break
                offset += len(rows)
        except Exception as exc:
            LOGGER.warning("Could not load disease reference assets from Supabase: %s", exc)

        self.references = references
        self.loaded_at = utc_now()
        if references:
            LOGGER.info("Loaded %s disease reference asset(s) from Supabase.", len(references))
        return self.references

    def match_job(self, job: Dict[str, Any]) -> Optional[Tuple[DiseaseReference, float]]:
        references = self.get_references()
        if not references:
            return None

        parsed = parse_asset_filename_fields(first_non_empty(job.get("image_path"), job.get("image_url"), job.get("unique_id")))
        job_fields = {
            "commonname": first_non_empty(job.get("common_name"), job.get("commonname"), parsed.get("commonname")),
            "locationcode": normalize_location_code(first_non_empty(job.get("locationcode"), parsed.get("locationcode"))),
            "lotcode": normalize_lot_code(first_non_empty(job.get("lotcode"), parsed.get("lotcode"))),
            "contsize": normalize_contsize(first_non_empty(job.get("contsize"), parsed.get("contsize"))),
            "itemcode": first_non_empty(job.get("itemcode"), parsed.get("itemcode")),
        }

        best: Optional[Tuple[DiseaseReference, float]] = None
        for reference in references:
            score = 0.0
            if job_fields["locationcode"] and reference.locationcode and job_fields["locationcode"] == reference.locationcode:
                score += 75
            if job_fields["lotcode"] and reference.lotcode and job_fields["lotcode"] == reference.lotcode:
                score += 55
            if job_fields["contsize"] and reference.contsize and job_fields["contsize"] == reference.contsize:
                score += 25
            if job_fields["itemcode"] and reference.itemcode and job_fields["itemcode"] == reference.itemcode:
                score += 90
            if job_fields["commonname"] and reference.commonname:
                score += 45 * SequenceMatcher(None, normalize_compact(job_fields["commonname"]), normalize_compact(reference.commonname)).ratio()
            elif job_fields["commonname"] and reference.plant_folder:
                score += 20 * SequenceMatcher(None, normalize_compact(job_fields["commonname"]), normalize_compact(reference.plant_folder)).ratio()
            if reference.asset_kind == "lab_report":
                score += 5

            if score >= 70 and (best is None or score > best[1]):
                best = (reference, score)
        return best

    def prediction_from_match(self, matched: Optional[Tuple[DiseaseReference, float]]) -> Optional[Prediction]:
        if not matched:
            return None
        reference, score = matched
        diagnosis = first_non_empty(reference.label, default="Disease reference match")
        treatment = "Review matching lab report and current crop condition before selecting treatment."
        reason = f"Matched disease reference {reference.unique_id} from {reference.file_name or reference.plant_folder} at score {round(score, 1)}."
        return Prediction(
            confidence=min(0.95, max(0.25, score / 220.0)),
            diagnosis=diagnosis,
            treatment=treatment,
            manual_review=True,
            reason=reason,
        )

    def prediction_for_job(self, job: Dict[str, Any]) -> Optional[Prediction]:
        return self.prediction_from_match(self.match_job(job))


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


class RestResponse:
    def __init__(self, data: Any = None):
        self.data = data


class RestTableQuery:
    def __init__(self, client: "RestSupabaseClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.method = "GET"
        self.payload: Any = None
        self.params: List[Tuple[str, str]] = []
        self.prefer = ""

    def select(self, columns: str = "*") -> "RestTableQuery":
        self.method = "GET"
        self.params.append(("select", columns or "*"))
        return self

    def update(self, payload: Dict[str, Any]) -> "RestTableQuery":
        self.method = "PATCH"
        self.payload = payload
        self.prefer = "return=representation"
        return self

    def insert(self, payload: Any) -> "RestTableQuery":
        self.method = "POST"
        self.payload = payload
        self.prefer = "return=minimal"
        return self

    def eq(self, column: str, value: Any) -> "RestTableQuery":
        self.params.append((str(column), f"eq.{value}"))
        return self

    def lt(self, column: str, value: Any) -> "RestTableQuery":
        self.params.append((str(column), f"lt.{value}"))
        return self

    def order(self, column: str, desc: bool = False) -> "RestTableQuery":
        direction = "desc" if desc else "asc"
        self.params.append(("order", f"{column}.{direction}"))
        return self

    def limit(self, count: int) -> "RestTableQuery":
        self.params.append(("limit", str(max(0, int(count or 0)))))
        return self

    def offset(self, count: int) -> "RestTableQuery":
        self.params.append(("offset", str(max(0, int(count or 0)))))
        return self

    def execute(self) -> RestResponse:
        return self.client.execute_table_query(self)


class RestStorageBucket:
    def __init__(self, client: "RestSupabaseClient", bucket_name: str):
        self.client = client
        self.bucket_name = bucket_name

    def download(self, storage_path: str) -> bytes:
        safe_bucket = urllib.parse.quote(str(self.bucket_name or "").strip(), safe="")
        safe_path = urllib.parse.quote(str(storage_path or "").strip().lstrip("/"), safe="/")
        url = f"{self.client.base_url}/storage/v1/object/{safe_bucket}/{safe_path}"
        request = urllib.request.Request(url, headers=self.client.headers(), method="GET")
        with urllib.request.urlopen(request, timeout=self.client.timeout_seconds) as response:
            return response.read()


class RestStorageClient:
    def __init__(self, client: "RestSupabaseClient"):
        self.client = client

    def from_(self, bucket_name: str) -> RestStorageBucket:
        return RestStorageBucket(self.client, bucket_name)


class RestSupabaseClient:
    """Minimal Supabase REST/Storage client that supports sb_secret API keys.

    The official supabase-py client may reject Supabase's newer sb_secret keys
    in some versions. The worker only needs a small PostgREST/Storage surface,
    so this adapter keeps the background ML loop compatible with both legacy
    service_role JWTs and new secret API keys.
    """

    def __init__(self, supabase_url: str, service_key: str, timeout_seconds: int = 60):
        self.base_url = str(supabase_url or "").strip().rstrip("/")
        self.service_key = str(service_key or "").strip()
        self.timeout_seconds = timeout_seconds
        self.storage = RestStorageClient(self)

    def headers(self, method: str = "GET", prefer: str = "") -> Dict[str, str]:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        elif method in {"POST", "PATCH"}:
            headers["Prefer"] = "return=representation"
        return headers

    def table(self, table_name: str) -> RestTableQuery:
        return RestTableQuery(self, table_name)

    def execute_table_query(self, query: RestTableQuery) -> RestResponse:
        query_string = urllib.parse.urlencode(query.params, doseq=True)
        safe_table = urllib.parse.quote(str(query.table_name or "").strip(), safe="")
        url = f"{self.base_url}/rest/v1/{safe_table}{'?' + query_string if query_string else ''}"
        body = None
        if query.payload is not None and query.method != "GET":
            body = json.dumps(query.payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers=self.headers(query.method, query.prefer),
            method=query.method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Supabase REST {query.method} {query.table_name} failed HTTP {exc.code}: {details}") from exc
        if not text:
            return RestResponse([])
        try:
            return RestResponse(json.loads(text))
        except json.JSONDecodeError:
            return RestResponse(text)


class SupabaseMlWorker:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.config.validate()
        self.worker_id = f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        self.supabase = self._build_supabase_client()
        self.inventory_cache = InventoryCache(config)
        self.disease_reference_cache = DiseaseReferenceCache(config, self.supabase)
        self.models = ModelRegistry(config)
        self.whisper_model = None

    def _build_supabase_client(self) -> Any:
        return RestSupabaseClient(self.config.supabase_url, self.config.supabase_service_role_key)

    def recover_stale_jobs(self) -> None:
        cutoff = (utc_now() - timedelta(minutes=self.config.stale_processing_minutes)).isoformat()
        payload = {
            "status": "pending_ml",
            "processing_started_at": None,
            "worker_id": None,
            "last_error": "Recovered from stale processing state.",
        }
        self.supabase.table(self.config.job_table).update(payload).eq("status", "processing").lt("processing_started_at", cutoff).execute()

    def recover_stale_training_assets(self) -> None:
        if not self.config.training_assets_table:
            return
        cutoff = (utc_now() - timedelta(minutes=self.config.stale_processing_minutes)).isoformat()
        payload = {
            "processed_status": "pending_ml",
            "processing_started_at": None,
            "worker_id": None,
            "last_error": "Recovered from stale processing state.",
        }
        try:
            self.supabase.table(self.config.training_assets_table).update(payload).eq("processed_status", "processing").lt("processing_started_at", cutoff).execute()
        except Exception as exc:
            LOGGER.warning("Could not recover stale disease training assets: %s", exc)

    def recover_stale_scout_reports(self) -> None:
        if not self.config.grower_scout_reports_table:
            return
        cutoff = (utc_now() - timedelta(minutes=self.config.stale_processing_minutes)).isoformat()
        payload = {
            "status": "pending_ai",
            "processing_started_at": None,
            "worker_id": None,
            "last_error": "Recovered from stale processing state.",
        }
        try:
            self.supabase.table(self.config.grower_scout_reports_table).update(payload).eq("status", "processing").lt("processing_started_at", cutoff).execute()
        except Exception as exc:
            LOGGER.warning("Could not recover stale grower scout reports. Run grower_scouting_migration.sql if this table is missing: %s", exc)

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

    def fetch_pending_training_assets(self) -> List[Dict[str, Any]]:
        if not self.config.training_assets_table:
            return []
        try:
            response = (
                self.supabase.table(self.config.training_assets_table)
                .select("*")
                .eq("processed_status", "pending_ml")
                .order("created_at")
                .limit(self.config.batch_size)
                .execute()
            )
            return list(response.data or [])
        except Exception as exc:
            LOGGER.warning("Could not fetch disease training assets. Run ml_disease_training_assets_migration.sql if this table is missing: %s", exc)
            return []

    def fetch_pending_scout_reports(self) -> List[Dict[str, Any]]:
        if not self.config.grower_scout_reports_table:
            return []
        try:
            response = (
                self.supabase.table(self.config.grower_scout_reports_table)
                .select("*")
                .eq("status", "pending_ai")
                .order("created_at")
                .limit(self.config.batch_size)
                .execute()
            )
            return list(response.data or [])
        except Exception as exc:
            LOGGER.warning("Could not fetch grower scout reports. Run grower_scouting_migration.sql if this table is missing: %s", exc)
            return []

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

    def fetch_source_row_for_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        source_table = first_non_empty(job.get("source_table")).strip().lower()
        source_unique_id = first_non_empty(job.get("source_unique_id"))
        if not source_table or not source_unique_id or source_table not in ML_SOURCE_TABLE_ALLOWLIST:
            return {}
        try:
            response = (
                self.supabase.table(source_table)
                .select("*")
                .eq("unique_id", source_unique_id)
                .limit(1)
                .execute()
            )
            rows = list(response.data or [])
            return rows[0] if rows else {}
        except Exception as exc:
            LOGGER.warning("Could not resolve ML source row %s/%s: %s", source_table, source_unique_id, exc)
            return {}

    def get_source_identity_for_job(self, job: Dict[str, Any]) -> Dict[str, str]:
        source_row = self.fetch_source_row_for_job(job)
        parsed = parse_asset_filename_fields(first_non_empty(job.get("image_path"), job.get("image_url"), job.get("unique_id")))
        source_identity = {
            "genus": first_non_empty(
                source_row.get("genus"),
                source_row.get("genusname"),
                source_row.get("GENUS"),
                source_row.get("GENUSNAME"),
                job.get("genus"),
            ),
            "common_name": first_non_empty(
                source_row.get("commonname"),
                source_row.get("common_name"),
                source_row.get("COMMONNAME"),
                source_row.get("COMMON_NAME"),
                job.get("common_name"),
                job.get("commonname"),
                parsed.get("commonname"),
            ),
            "itemcode": first_non_empty(source_row.get("itemcode"), source_row.get("ITEMCODE"), job.get("itemcode"), parsed.get("itemcode")),
            "contsize": normalize_contsize(first_non_empty(source_row.get("contsize"), source_row.get("CONTSIZE"), job.get("contsize"), parsed.get("contsize"))),
            "locationcode": normalize_location_code(first_non_empty(source_row.get("locationcode"), source_row.get("LOCATIONCODE"), job.get("locationcode"), parsed.get("locationcode"))),
            "lotcode": normalize_lot_code(first_non_empty(source_row.get("lotcode"), source_row.get("LOTCODE"), job.get("lotcode"), parsed.get("lotcode"))),
        }
        return source_identity

    def claim_training_asset(self, asset: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        asset_id = str(asset.get("unique_id") or "").strip()
        if not asset_id or not self.config.training_assets_table:
            return None
        payload = {
            "processed_status": "processing",
            "processing_started_at": iso_now(),
            "worker_id": self.worker_id,
            "attempts": int(asset.get("attempts") or 0) + 1,
            "last_error": None,
        }
        try:
            response = (
                self.supabase.table(self.config.training_assets_table)
                .update(payload)
                .eq("unique_id", asset_id)
                .eq("processed_status", "pending_ml")
                .execute()
            )
            rows = list(response.data or [])
            if rows:
                return rows[0]
        except Exception as exc:
            LOGGER.warning("Could not claim disease training asset %s: %s", asset_id, exc)
        return None

    def download_training_asset(self, asset: Dict[str, Any], target_dir: pathlib.Path) -> pathlib.Path:
        bucket = first_non_empty(asset.get("bucket"), default=self.config.training_assets_bucket)
        storage_path = first_non_empty(asset.get("storage_path"))
        if not storage_path:
            raise RuntimeError("Training asset is missing storage_path.")
        file_bytes = self.supabase.storage.from_(bucket).download(storage_path)
        suffix = pathlib.Path(storage_path).suffix.lower()
        if not suffix:
            suffix = ".bin"
        target_path = target_dir / f"{asset.get('unique_id') or uuid.uuid4().hex}{suffix}"
        target_path.write_bytes(file_bytes)
        return target_path

    def claim_scout_report(self, report: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        report_id = str(report.get("unique_id") or "").strip()
        if not report_id or not self.config.grower_scout_reports_table:
            return None
        payload = {
            "status": "processing",
            "processing_started_at": iso_now(),
            "worker_id": self.worker_id,
            "attempts": int(report.get("attempts") or 0) + 1,
            "last_error": None,
        }
        try:
            response = (
                self.supabase.table(self.config.grower_scout_reports_table)
                .update(payload)
                .eq("unique_id", report_id)
                .eq("status", "pending_ai")
                .execute()
            )
            rows = list(response.data or [])
            if rows:
                return rows[0]
        except Exception as exc:
            LOGGER.warning("Could not claim grower scout report %s: %s", report_id, exc)
        return None

    def fetch_scout_assets(self, report_id: str) -> List[Dict[str, Any]]:
        if not self.config.grower_scout_assets_table or not report_id:
            return []
        try:
            response = (
                self.supabase.table(self.config.grower_scout_assets_table)
                .select("*")
                .eq("report_id", report_id)
                .order("created_at")
                .execute()
            )
            return list(response.data or [])
        except Exception as exc:
            LOGGER.warning("Could not fetch grower scout assets for %s: %s", report_id, exc)
            return []

    def download_storage_object(self, bucket: str, storage_path: str, target_dir: pathlib.Path, fallback_suffix: str = ".bin") -> pathlib.Path:
        safe_bucket = first_non_empty(bucket)
        safe_path = first_non_empty(storage_path)
        if not safe_bucket or not safe_path:
            raise RuntimeError("Storage object is missing bucket or path.")
        file_bytes = self.supabase.storage.from_(safe_bucket).download(safe_path)
        suffix = pathlib.Path(safe_path).suffix.lower() or fallback_suffix
        target_path = target_dir / f"{uuid.uuid4().hex}{suffix}"
        target_path.write_bytes(file_bytes)
        return target_path

    def get_whisper_model(self) -> Any:
        if self.whisper_model is not None:
            return self.whisper_model
        from faster_whisper import WhisperModel

        self.whisper_model = WhisperModel(
            self.config.whisper_model_size,
            device=first_non_empty(os.environ.get("WHISPER_DEVICE"), default="cpu"),
            compute_type=first_non_empty(os.environ.get("WHISPER_COMPUTE_TYPE"), default="int8"),
        )
        return self.whisper_model

    def transcribe_scout_audio(self, audio_path: pathlib.Path, language: str = "") -> Tuple[str, str]:
        if not audio_path or not audio_path.exists():
            return "", ""
        try:
            model = self.get_whisper_model()
            language_hint = str(language or "").strip().lower()
            kwargs: Dict[str, Any] = {"vad_filter": True, "beam_size": 5}
            if language_hint in {"en", "es"}:
                kwargs["language"] = language_hint
            segments, info = model.transcribe(str(audio_path), **kwargs)
            transcript = " ".join(str(segment.text or "").strip() for segment in segments if str(segment.text or "").strip()).strip()
            detected_language = getattr(info, "language", "") if info else ""
            LOGGER.info("Transcribed scout audio %s with language=%s.", audio_path.name, detected_language or language_hint or "auto")
            return transcript, ""
        except Exception as exc:
            return "", f"Transcription failed: {exc}"

    def call_ollama_json(self, prompt: str) -> Tuple[Dict[str, Any], str]:
        base_url = first_non_empty(self.config.ollama_url).rstrip("/")
        model = first_non_empty(self.config.scout_summary_model)
        if not base_url or not model:
            return {}, "Ollama URL or model is not configured."
        request_payload = json.dumps({
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{base_url}/api/generate",
            data=request_payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = json.loads(response.read().decode("utf-8"))
            text = str(raw.get("response") or "").strip()
            if not text:
                return {}, "Ollama returned an empty response."
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}, ""
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            return {}, f"Ollama summary failed: {exc}"

    def fallback_scout_summary(self, note: str, report: Dict[str, Any]) -> Dict[str, Any]:
        text = str(note or "").strip()
        lowered = normalize_key(text)
        issue_keywords = {
            "pest": ["aphid", "mite", "spider mite", "scale", "thrip", "whitefly", "beetle", "bagworm", "caterpillar", "borer", "snail", "slug", "insect"],
            "disease": ["blight", "mildew", "rot", "fungus", "fungal", "leaf spot", "canker", "rust", "wilt", "dieback", "disease"],
            "nutrient": ["chlorosis", "yellowing", "deficiency", "nutrient", "iron", "nitrogen", "magnesium"],
        }
        matched_types = []
        for issue_type, keywords in issue_keywords.items():
            if any(keyword in lowered for keyword in keywords):
                matched_types.append(issue_type)
        severity = "none"
        if any(word in lowered for word in ["severe", "heavy", "widespread", "critical", "bad"]):
            severity = "high"
        elif matched_types:
            severity = "medium" if any(word in lowered for word in ["several", "spots", "some", "moderate"] ) else "low"
        summary = text[:900] if text else "No spoken or typed scouting note was available."
        diagnosis = ", ".join(matched_types).title() if matched_types else "No pest or disease issue called out in the note."
        treatment = "Review the block and confirm treatment plan." if matched_types else "No treatment recommended from the note."
        return {
            "summary": summary,
            "pest_issue": "pest" in matched_types,
            "disease_issue": "disease" in matched_types,
            "nutrient_issue": "nutrient" in matched_types,
            "issue_type": ", ".join(matched_types),
            "severity": severity,
            "diagnosis": diagnosis,
            "recommended_treatment": treatment,
            "manual_review": not bool(text),
        }

    def summarize_scout_report(self, note: str, report: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        block = first_non_empty(report.get("block"), report.get("blockalpha"))
        crop = first_non_empty(report.get("common_name"), report.get("genus"), report.get("itemcode"), default="Unknown crop")
        language = first_non_empty(report.get("report_language"), default="en")
        prompt = f"""
You are summarizing a nursery crop scouting report for Greenleaf Nursery Company.
Return only valid JSON with these keys:
summary, pest_issue, disease_issue, nutrient_issue, issue_type, severity, diagnosis, recommended_treatment, follow_up_date, manual_review.
severity must be one of none, low, medium, high, critical.
The summary should be concise but detailed enough for an operations manager to act on.
If the note is uncertain or lacks enough detail, set manual_review true.

Context:
Block: {block or "unknown"}
Crop: {crop}
Language: {language}

Scouting note:
{note or "No note provided."}
""".strip()
        parsed, error = self.call_ollama_json(prompt)
        if not parsed:
            return self.fallback_scout_summary(note, report), error
        return parsed, error

    def normalize_scout_summary_result(self, raw: Dict[str, Any], fallback_note: str = "") -> Dict[str, Any]:
        source = raw if isinstance(raw, dict) else {}

        def as_bool(value: Any) -> bool:
            if isinstance(value, bool):
                return value
            return str(value or "").strip().lower() in {"1", "true", "yes", "y"}

        severity = normalize_key(first_non_empty(source.get("severity"), default="none"))
        if severity not in {"none", "low", "medium", "high", "critical"}:
            severity = "none"
        summary = first_non_empty(source.get("summary"), source.get("ai_summary"), default=fallback_note[:900])
        pest_issue = as_bool(source.get("pest_issue"))
        disease_issue = as_bool(source.get("disease_issue"))
        nutrient_issue = as_bool(source.get("nutrient_issue"))
        manual_review = as_bool(source.get("manual_review"))
        if severity != "none" and not (pest_issue or disease_issue or nutrient_issue):
            manual_review = True
        return {
            "summary": summary,
            "pest_issue": pest_issue,
            "disease_issue": disease_issue,
            "nutrient_issue": nutrient_issue,
            "issue_type": first_non_empty(source.get("issue_type"), source.get("issue"), default=""),
            "severity": severity,
            "diagnosis": first_non_empty(source.get("diagnosis"), source.get("issue"), default="No diagnosis returned."),
            "recommended_treatment": first_non_empty(source.get("recommended_treatment"), source.get("treatment"), default="Review manually."),
            "follow_up_date": first_non_empty(source.get("follow_up_date"), default="") or None,
            "manual_review": manual_review,
            "raw": source,
        }

    def build_scout_report_result_payload(self, report: Dict[str, Any], assets: List[Dict[str, Any]], temp_dir: pathlib.Path) -> Tuple[Dict[str, Any], bool]:
        audio_path_value = first_non_empty(report.get("audio_path"))
        audio_bucket = first_non_empty(report.get("audio_bucket"), default=self.config.grower_scout_audio_bucket)
        transcript = first_non_empty(report.get("transcript"))
        notes = first_non_empty(report.get("manual_note"))
        errors = []
        if audio_path_value and not transcript:
            audio_path = self.download_storage_object(audio_bucket, audio_path_value, temp_dir, ".webm")
            transcript, transcribe_error = self.transcribe_scout_audio(audio_path, first_non_empty(report.get("report_language")))
            if transcribe_error:
                errors.append(transcribe_error)

        source_note = first_non_empty(transcript, notes)
        summary_raw, summary_error = self.summarize_scout_report(source_note, report)
        if summary_error:
            errors.append(summary_error)
        summary = self.normalize_scout_summary_result(summary_raw, source_note)

        photo_assets = [asset for asset in assets if first_non_empty(asset.get("asset_kind")) == "photo"]
        if not source_note and photo_assets:
            summary["manual_review"] = True
            summary["summary"] = first_non_empty(summary.get("summary"), default=f"{len(photo_assets)} scouting photo(s) uploaded without a spoken note.")
            summary["diagnosis"] = first_non_empty(summary.get("diagnosis"), default="Photo-only scouting report requires manual review.")

        has_issue = bool(summary["pest_issue"] or summary["disease_issue"] or summary["nutrient_issue"] or summary["manual_review"] or summary["severity"] != "none")
        next_status = "dylan_review" if has_issue else "ai_complete"
        payload = {
            "status": next_status,
            "transcript": transcript or None,
            "ai_summary": summary["summary"] or None,
            "summary_json": summary["raw"],
            "pest_issue": summary["pest_issue"],
            "disease_issue": summary["disease_issue"],
            "nutrient_issue": summary["nutrient_issue"],
            "manual_review": summary["manual_review"],
            "issue_type": summary["issue_type"] or None,
            "severity": summary["severity"],
            "diagnosis": summary["diagnosis"] or None,
            "recommended_treatment": summary["recommended_treatment"] or None,
            "follow_up_date": summary["follow_up_date"],
            "ai_completed_at": iso_now(),
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": "; ".join(errors) or None,
        }
        return payload, has_issue

    def resolve_push_function_url(self) -> str:
        explicit = first_non_empty(self.config.push_function_url)
        if explicit:
            return explicit
        base = first_non_empty(self.config.supabase_url).rstrip("/")
        return f"{base}/functions/v1/send-push-alert" if base else ""

    def send_pest_issue_push(self, report: Dict[str, Any], payload: Dict[str, Any]) -> None:
        push_url = self.resolve_push_function_url()
        if not push_url:
            return
        report_id = first_non_empty(report.get("unique_id"))
        body = {
            "eventType": "pest_issue",
            "reportId": report_id,
            "folderId": report_id,
            "targetUsers": self.config.pest_management_alert_usernames,
            "block": first_non_empty(report.get("block"), report.get("blockalpha")),
            "crop": first_non_empty(report.get("common_name"), report.get("genus"), report.get("itemcode"), default="Crop scout report"),
            "severity": first_non_empty(payload.get("severity"), default="review"),
            "issue": first_non_empty(payload.get("diagnosis"), payload.get("issue_type"), default="Pest Management review needed"),
            "itemsCount": 1,
        }
        request = urllib.request.Request(
            push_url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "apikey": self.config.supabase_service_role_key,
                "Authorization": f"Bearer {self.config.supabase_service_role_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                LOGGER.info("Pest issue push for %s returned HTTP %s.", report_id, response.status)
        except Exception as exc:
            LOGGER.warning("Could not send pest issue push for %s: %s", report_id, exc)

    def mark_scout_report_failed(self, report: Dict[str, Any], error: Exception) -> None:
        report_id = str(report.get("unique_id") or "").strip()
        if not report_id:
            return
        payload = {
            "status": "ai_failed",
            "manual_review": True,
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": str(error),
        }
        self.supabase.table(self.config.grower_scout_reports_table).update(payload).eq("unique_id", report_id).execute()
        self.emit_live_event(
            self.config.grower_scout_reports_table,
            report_id,
            "grower:ai_failed",
            {"status": "ai_failed", "error": str(error)},
        )

    def process_scout_report(self, report: Dict[str, Any]) -> bool:
        claimed = self.claim_scout_report(report)
        if not claimed:
            return False
        report_id = str(claimed.get("unique_id") or "").strip()
        LOGGER.info("Processing grower scout report %s", report_id)
        try:
            assets = self.fetch_scout_assets(report_id)
            with tempfile.TemporaryDirectory(prefix="gnc-scout-") as temp_dir:
                payload, has_issue = self.build_scout_report_result_payload(claimed, assets, pathlib.Path(temp_dir))
                self.supabase.table(self.config.grower_scout_reports_table).update(payload).eq("unique_id", report_id).execute()
                self.emit_live_event(
                    self.config.grower_scout_reports_table,
                    report_id,
                    "grower:ai_complete",
                    {"status": payload.get("status"), "severity": payload.get("severity"), "has_issue": has_issue},
                )
                flagged_issue = bool(payload.get("pest_issue") or payload.get("disease_issue") or payload.get("nutrient_issue"))
                if flagged_issue:
                    self.send_pest_issue_push(claimed, payload)
            LOGGER.info("Completed grower scout report %s", report_id)
            return True
        except Exception as exc:
            LOGGER.exception("Grower scout report %s failed", report_id)
            self.mark_scout_report_failed(claimed, exc)
            return False

    def emit_live_event(self, source_table: str, row_id: str, event_type: str, payload: Optional[Dict[str, Any]] = None) -> None:
        live_table = first_non_empty(self.config.app_live_events_table)
        safe_source_table = first_non_empty(source_table)
        safe_row_id = first_non_empty(row_id)
        safe_event_type = first_non_empty(event_type)
        if not live_table or not safe_source_table or not safe_event_type:
            return
        event_payload = {
            "event_key": f"{safe_source_table}:{safe_event_type}:{uuid.uuid4().hex}",
            "event_type": safe_event_type,
            "area": "grower" if safe_source_table in {self.config.grower_scout_reports_table, self.config.grower_scout_assets_table} else ("diagnostics" if safe_source_table in {self.config.job_table, self.config.training_assets_table} else "inventory"),
            "source_table": safe_source_table,
            "row_ids": [safe_row_id] if safe_row_id else [],
            "payload": {
                **(payload or {}),
                "method": "ML",
                "worker_id": self.worker_id,
            },
            "actor_username": "ml_worker",
            "actor_display": "ML Worker",
            "client_id": self.worker_id,
            "created_at": iso_now(),
        }
        try:
            self.supabase.table(live_table).insert(event_payload).execute()
        except Exception as exc:
            LOGGER.warning("Could not emit app live event for %s: %s", safe_row_id or safe_source_table, exc)

    def build_result_payload(self, job: Dict[str, Any], image_path: pathlib.Path) -> Dict[str, Any]:
        source_identity = self.get_source_identity_for_job(job)
        plant_prediction = self.models.plant.predict(image_path)
        diagnostics_prediction = self.models.diagnostics.predict(image_path) if self.models.diagnostics else Prediction(
            manual_review=False,
            reason="No diagnostics model is configured.",
        )
        reference_match = self.disease_reference_cache.match_job(job)
        reference_prediction = self.disease_reference_cache.prediction_from_match(reference_match)
        if reference_prediction and (diagnostics_prediction.manual_review or not diagnostics_prediction.diagnosis):
            diagnostics_prediction = reference_prediction

        matcher = self.inventory_cache.get_matcher()
        low_confidence = plant_prediction.confidence < self.config.confidence_threshold
        match_genus = first_non_empty(
            plant_prediction.genus if self.models.plant.available and not low_confidence else "",
            source_identity.get("genus"),
        )
        match_common_name = first_non_empty(
            plant_prediction.common_name if self.models.plant.available and not low_confidence else "",
            source_identity.get("common_name"),
        )
        matched_entry, match_score = matcher.match(match_genus, match_common_name)

        season = first_non_empty(job.get("season"), default="")
        app_grade = map_model_grade_to_app_grade(plant_prediction.grade, season)
        diagnostics_low_confidence = diagnostics_prediction.confidence < self.config.confidence_threshold
        diagnostic_issue_found = bool(reference_prediction) or (
            bool(self.models.diagnostics and self.models.diagnostics.available)
            and is_actionable_diagnostic_text(diagnostics_prediction.diagnosis)
            and not diagnostics_low_confidence
        )
        grading_result_ready = bool(
            self.models.plant.available
            and matched_entry
            and not low_confidence
            and normalize_grade(plant_prediction.grade)
        )
        should_request_approval = bool(diagnostic_issue_found or grading_result_ready)
        manual_review = bool(diagnostic_issue_found and diagnostics_prediction.manual_review)

        genus = first_non_empty(source_identity.get("genus"), plant_prediction.genus)
        common_name = first_non_empty(source_identity.get("common_name"), plant_prediction.common_name)
        if matched_entry:
            genus = genus or matched_entry.genus
            common_name = common_name or matched_entry.common_name

        reason_bits = [
            plant_prediction.reason,
            diagnostics_prediction.reason,
            "Low confidence" if low_confidence else "",
            "Low diagnostics confidence" if diagnostics_low_confidence and diagnostics_prediction.diagnosis else "",
            "No inventory match" if not matched_entry else "",
        ]
        reason = "; ".join(bit for bit in reason_bits if bit)
        diagnosis_default = "Manual review required" if diagnostic_issue_found else "No disease issue detected from available references."
        treatment_default = "Review image before logging quantities." if diagnostic_issue_found else "No treatment recommended."
        reference_payload: Dict[str, Any] = {}
        if reference_match:
            reference, reference_score = reference_match
            reference_payload = {
                "diagnostic_reference_asset_id": reference.unique_id or None,
                "diagnostic_reference_kind": reference.asset_kind or None,
                "diagnostic_reference_file_name": reference.file_name or None,
                "diagnostic_reference_public_url": reference.public_url or None,
                "diagnostic_reference_label": reference.label or None,
                "diagnostic_reference_score": round(float(reference_score or 0.0), 3),
                "diagnostic_reference_report_text": reference.report_text or None,
                "diagnostic_reference_report_rewrite": reference.report_rewrite or None,
            }

        return {
            "status": "pending_approval" if should_request_approval else "approved",
            "genus": source_identity.get("genus") or None,
            "common_name": source_identity.get("common_name") or None,
            "itemcode": source_identity.get("itemcode") or job.get("itemcode") or None,
            "contsize": source_identity.get("contsize") or job.get("contsize") or None,
            "locationcode": source_identity.get("locationcode") or job.get("locationcode") or None,
            "lotcode": source_identity.get("lotcode") or job.get("lotcode") or None,
            "ml_genus": genus or None,
            "ml_common_name": common_name or None,
            "ml_grade_raw": plant_prediction.grade or None,
            "ml_grade": app_grade,
            "ml_confidence": round(float(plant_prediction.confidence or 0.0), 4),
            "matched_inventory_key": matched_entry.key if matched_entry else None,
            "diagnosis": first_non_empty(diagnostics_prediction.diagnosis, plant_prediction.diagnosis, default=diagnosis_default),
            "recommended_treatment": first_non_empty(diagnostics_prediction.treatment, plant_prediction.treatment, default=treatment_default),
            "manual_review": manual_review,
            "ml_completed_at": iso_now(),
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": reason or None,
            **reference_payload,
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
        self.emit_live_event(
            self.config.job_table,
            job_id,
            "diagnostics:ml_failed",
            {"status": "ml_failed", "error": str(error)},
        )

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
                try:
                    self.supabase.table(self.config.job_table).update(payload).eq("unique_id", job_id).execute()
                except Exception as update_exc:
                    reference_keys = [key for key in payload if key.startswith("diagnostic_reference_")]
                    if reference_keys and "does not exist" in str(update_exc).lower():
                        LOGGER.warning("Diagnostic reference columns are missing; run diagnostic_reference_report_migration.sql. Saving ML result without reference fields for %s.", job_id)
                        fallback_payload = {key: value for key, value in payload.items() if key not in reference_keys}
                        self.supabase.table(self.config.job_table).update(fallback_payload).eq("unique_id", job_id).execute()
                        payload = fallback_payload
                    else:
                        raise
                self.emit_live_event(
                    self.config.job_table,
                    job_id,
                    "diagnostics:ml_complete",
                    {"status": payload.get("status"), "ml_grade": payload.get("ml_grade")},
                )
            LOGGER.info("Completed ML job %s", job_id)
            return True
        except Exception as exc:
            LOGGER.exception("ML job %s failed", job_id)
            self.mark_failed(claimed, exc)
            return False

    def build_training_asset_result_payload(self, asset: Dict[str, Any], asset_path: pathlib.Path) -> Dict[str, Any]:
        suffix = asset_path.suffix.lower()
        asset_kind = first_non_empty(asset.get("asset_kind"), default="other")
        if suffix not in IMAGE_EXTENSIONS or asset_kind == "lab_report":
            report_text = extract_lab_report_text(asset_path)
            report_rewrite = rewrite_lab_report_text(
                report_text,
                first_non_empty(asset.get("label"), default="Lab report indexed"),
                first_non_empty(asset.get("file_name"), asset.get("source_file_title"), asset_path.name),
            )
            return {
                "processed_status": "processed",
                "diagnosis": first_non_empty(asset.get("label"), default="Lab report indexed"),
                "recommended_treatment": "Stored as labeled reference material for supervised diagnostics review.",
                "report_text": report_text or None,
                "report_rewrite": report_rewrite or None,
                "confidence": None,
                "processed_at": iso_now(),
                "processing_started_at": None,
                "worker_id": self.worker_id,
                "last_error": None,
            }

        prediction = self.models.diagnostics.predict(asset_path) if self.models.diagnostics else Prediction(
            diagnosis="Manual review required",
            treatment="No diagnostics model is configured.",
            manual_review=True,
            reason="No diagnostics model is configured.",
        )
        reason = first_non_empty(prediction.reason)
        return {
            "processed_status": "processed",
            "diagnosis": first_non_empty(prediction.diagnosis, asset.get("label"), default="Manual review required"),
            "recommended_treatment": first_non_empty(prediction.treatment, default="Review image before using as training reference."),
            "confidence": round(float(prediction.confidence or 0.0), 4),
            "processed_at": iso_now(),
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": reason or None,
        }

    def mark_training_asset_failed(self, asset: Dict[str, Any], error: Exception) -> None:
        asset_id = str(asset.get("unique_id") or "").strip()
        if not asset_id or not self.config.training_assets_table:
            return
        payload = {
            "processed_status": "failed",
            "processing_started_at": None,
            "worker_id": self.worker_id,
            "last_error": str(error),
        }
        self.supabase.table(self.config.training_assets_table).update(payload).eq("unique_id", asset_id).execute()
        self.emit_live_event(
            self.config.training_assets_table,
            asset_id,
            "diagnostics:training_asset_failed",
            {"processed_status": "failed", "error": str(error)},
        )

    def process_training_asset(self, asset: Dict[str, Any]) -> bool:
        claimed = self.claim_training_asset(asset)
        if not claimed:
            return False
        asset_id = str(claimed.get("unique_id") or "").strip()
        LOGGER.info("Processing disease training asset %s", asset_id)
        try:
            with tempfile.TemporaryDirectory(prefix="gnc-ml-asset-") as temp_dir:
                asset_path = self.download_training_asset(claimed, pathlib.Path(temp_dir))
                payload = self.build_training_asset_result_payload(claimed, asset_path)
                try:
                    self.supabase.table(self.config.training_assets_table).update(payload).eq("unique_id", asset_id).execute()
                except Exception as update_exc:
                    optional_keys = {"report_text", "report_rewrite"}
                    if optional_keys.intersection(payload) and "does not exist" in str(update_exc).lower():
                        LOGGER.warning("Lab report text columns are missing; run diagnostic_reference_report_migration.sql. Saving training asset result without report text for %s.", asset_id)
                        fallback_payload = {key: value for key, value in payload.items() if key not in optional_keys}
                        self.supabase.table(self.config.training_assets_table).update(fallback_payload).eq("unique_id", asset_id).execute()
                        payload = fallback_payload
                    else:
                        raise
                self.emit_live_event(
                    self.config.training_assets_table,
                    asset_id,
                    "diagnostics:training_asset_processed",
                    {"processed_status": payload.get("processed_status"), "diagnosis": payload.get("diagnosis")},
                )
            LOGGER.info("Completed disease training asset %s", asset_id)
            return True
        except Exception as exc:
            LOGGER.exception("Disease training asset %s failed", asset_id)
            self.mark_training_asset_failed(claimed, exc)
            return False

    def run_once(self) -> int:
        self.recover_stale_jobs()
        self.recover_stale_training_assets()
        self.recover_stale_scout_reports()
        jobs = self.fetch_pending_jobs()
        processed = 0
        for job in jobs:
            if self.process_job(job):
                processed += 1
        for asset in self.fetch_pending_training_assets():
            if self.process_training_asset(asset):
                processed += 1
        for report in self.fetch_pending_scout_reports():
            if self.process_scout_report(report):
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
    run_once = str(os.environ.get("ML_RUN_ONCE") or "").strip().lower() in {"1", "true", "yes", "y"}
    if run_once:
        processed = worker.run_once()
        LOGGER.info("ML run-once processed %s job(s).", processed)
        return 0
    worker.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
