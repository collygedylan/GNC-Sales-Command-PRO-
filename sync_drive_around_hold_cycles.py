#!/usr/bin/env python3
"""Build hold-release learning cycles from processed Drive Around reports.

The processed Drive Around folder is treated as historical truth. Each report
file date is parsed from the file name, rows are grouped by item/location, and
the script learns how many base-50 growing degree days it took from the first
report where a row had holdstopcode H until the first later report where that
same row no longer had H.
"""

from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


DEFAULT_DRIVE_AROUND_REPORTS_FOLDER_ID = "1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA"
SUPPORTED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet"
GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder"
DATE_RE_LIST = [
    re.compile(r"(20\d{2})[-_. ]?([01]?\d)[-_. ]?([0-3]?\d)"),
    re.compile(r"([01]?\d)[-_. ]([0-3]?\d)[-_. ](20\d{2})"),
]


def first_non_empty(*values: Any, default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def env_int(name: str, default: int) -> int:
    raw = first_non_empty(os.environ.get(name))
    return int(raw) if raw else default


def parse_date_from_text(value: str) -> Optional[date]:
    text = str(value or "")
    for pattern in DATE_RE_LIST:
        match = pattern.search(text)
        if not match:
            continue
        groups = match.groups()
        try:
            if len(groups[0]) == 4:
                return date(int(groups[0]), int(groups[1]), int(groups[2]))
            return date(int(groups[2]), int(groups[0]), int(groups[1]))
        except ValueError:
            continue
    return None


def normalize_column(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def normalize_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text


def normalize_hold_code(value: Any) -> str:
    return normalize_value(value).upper()


def classify_hold_reason(reason: str) -> str:
    text = str(reason or "").lower()
    if re.search(r"(aphid|mite|scale|thrip|snail|caterpillar|insect|bug|pest|borer|beetle)", text):
        return "pest"
    if re.search(r"(fung|disease|leaf spot|phytophthora|rhizoctonia|botrytis|canker|mildew|rot|rust|anthracnose|blight|phomopsis|sclerotinia)", text):
        return "fungal_disease"
    if re.search(r"(leaf quality|leaf|foliar|chlorosis|yellow|necrosis|spotting|burn)", text):
        return "leaf_quality"
    if re.search(r"(shear|sheared|trim|cutback|cut back|prune|pruned)", text):
        return "sheared"
    if re.search(r"(freeze|frost|cold|heat|hail|weather|wind|drought|wet)", text):
        return "weather_stress"
    return "unknown" if not text.strip() else "other"


def stable_id(prefix: str, *parts: Any) -> str:
    digest = hashlib.sha256("|".join(str(part or "") for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest}"


def read_service_account_info(raw_value: str) -> Dict[str, Any]:
    value = str(raw_value or "").strip()
    if not value:
        raise RuntimeError("GDRIVE_SERVICE_ACCOUNT_JSON is required.")
    if value.startswith("{"):
        return json.loads(value)
    path = pathlib.Path(value)
    if not path.is_absolute():
        path = pathlib.Path.cwd() / path
    return json.loads(path.read_text(encoding="utf-8"))


def build_drive_service(service_account_json: str) -> Any:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    credentials = service_account.Credentials.from_service_account_info(
        read_service_account_info(service_account_json),
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def download_drive_file_bytes(service: Any, file_id: str, mime_type: str, file_name: str) -> Tuple[bytes, str]:
    from googleapiclient.http import MediaIoBaseDownload

    if mime_type == GOOGLE_SHEETS_MIME:
        request = service.files().export_media(
            fileId=file_id,
            mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        extension = ".xlsx"
    else:
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        extension = pathlib.Path(file_name).suffix.lower()

    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buffer.getvalue(), extension


def list_drive_files_recursive(service: Any, folder_id: str, max_files: int = 0) -> List[Dict[str, Any]]:
    queue = [folder_id]
    files: List[Dict[str, Any]] = []
    while queue:
        parent_id = queue.pop(0)
        page_token = None
        while True:
            response = (
                service.files()
                .list(
                    q=f"'{parent_id}' in parents and trashed = false",
                    spaces="drive",
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
                    includeItemsFromAllDrives=True,
                    supportsAllDrives=True,
                    pageToken=page_token,
                    pageSize=1000,
                )
                .execute()
            )
            for item in response.get("files", []):
                if item.get("mimeType") == GOOGLE_FOLDER_MIME:
                    queue.append(str(item.get("id")))
                    continue
                files.append(item)
                if max_files and len(files) >= max_files:
                    return files
            page_token = response.get("nextPageToken")
            if not page_token:
                break
    return files


class SupabaseRest:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.service_key = service_key

    def headers(self, prefer: str = "") -> Dict[str, str]:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def request_json(
        self,
        path: str,
        method: str = "GET",
        payload: Any = None,
        prefer: str = "",
        timeout: int = 90,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = self.headers(prefer)
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(f"{self.url}{path}", data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
        return json.loads(text) if text else None

    def upsert(self, table: str, rows: Sequence[Dict[str, Any]], on_conflict: str = "unique_id", batch_size: int = 500) -> int:
        total = 0
        for start in range(0, len(rows), batch_size):
            batch = list(rows[start : start + batch_size])
            if not batch:
                continue
            query = urllib.parse.urlencode({"on_conflict": on_conflict})
            self.request_json(
                f"/rest/v1/{urllib.parse.quote(table, safe='')}?{query}",
                method="POST",
                payload=batch,
                prefer="resolution=merge-duplicates,return=minimal",
                timeout=120,
            )
            total += len(batch)
        return total

    def select(self, table: str, query: str) -> List[Dict[str, Any]]:
        response = self.request_json(f"/rest/v1/{urllib.parse.quote(table, safe='')}?{query}", method="GET")
        return list(response or [])

    def select_all(self, table: str, query: str, page_size: int = 1000, max_rows: int = 20000) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        start = 0
        safe_page_size = max(1, min(int(page_size or 1000), 1000))
        safe_max_rows = max(safe_page_size, int(max_rows or 20000))
        while len(rows) < safe_max_rows:
            end = min(start + safe_page_size - 1, safe_max_rows - 1)
            batch = self.request_json(
                f"/rest/v1/{urllib.parse.quote(table, safe='')}?{query}",
                method="GET",
                extra_headers={"Range": f"{start}-{end}"},
            )
            batch_rows = list(batch or [])
            rows.extend(batch_rows)
            if len(batch_rows) < safe_page_size:
                break
            start += safe_page_size
        return rows

    def rpc(self, function_name: str, payload: Dict[str, Any] | None = None) -> Any:
        return self.request_json(
            f"/rest/v1/rpc/{urllib.parse.quote(function_name, safe='')}",
            method="POST",
            payload=payload or {},
            prefer="return=representation",
            timeout=120,
        )


COLUMN_ALIASES = {
    "itemcode": {"itemcode", "item", "itemnumber", "itemnum", "itemid"},
    "commonname": {"commonname", "common", "plantname", "description", "plant"},
    "genus": {"genus", "genusname"},
    "contsize": {"contsize", "container", "containersize", "size"},
    "locationcode": {"locationcode", "location", "loc", "loccode"},
    "lotcode": {"lotcode", "lot", "seasonlot", "lotseason"},
    "season": {"season"},
    "blockalpha": {"blockalpha", "block", "blockcode"},
    "salesyear": {"salesyear", "saleyear"},
    "holdstopcode": {"holdstopcode", "holdcode", "holdstop", "hold"},
    "holdstopreason": {"holdstopreason", "holdreason", "reason"},
    "holdstopbegindate": {"holdstopbegindate", "holdbegindate", "holdstartdate", "holdstart"},
}


def dataframe_from_file(file_bytes: bytes, extension: str) -> Any:
    import pandas as pd

    if extension == ".csv":
        return pd.read_csv(io.BytesIO(file_bytes))
    if extension in {".xlsx", ".xls"}:
        return pd.read_excel(io.BytesIO(file_bytes))
    raise RuntimeError(f"Unsupported Drive Around report extension: {extension}")


def extract_row_value(row: Dict[str, Any], column_lookup: Dict[str, str], target: str) -> str:
    aliases = COLUMN_ALIASES.get(target, {target})
    for alias in aliases:
        source_column = column_lookup.get(alias)
        if source_column is not None:
            value = normalize_value(row.get(source_column))
            if value:
                return value
    return ""


@dataclasses.dataclass
class ReportSnapshot:
    report_date: date
    file_id: str
    file_name: str
    item_key: str
    itemcode: str
    commonname: str
    genus: str
    contsize: str
    locationcode: str
    lotcode: str
    season: str
    blockalpha: str
    salesyear: str
    holdstopcode: str
    holdstopreason: str
    holdstopbegindate: str
    raw: Dict[str, Any]


def build_item_key(snapshot: Dict[str, str]) -> str:
    parts = [
        snapshot.get("itemcode"),
        snapshot.get("locationcode"),
        snapshot.get("lotcode"),
        snapshot.get("contsize"),
    ]
    if not any(parts):
        parts = [snapshot.get("commonname"), snapshot.get("locationcode"), snapshot.get("lotcode"), snapshot.get("contsize")]
    return "|".join(str(part or "").strip().lower() for part in parts)


def snapshots_from_file(service: Any, drive_file: Dict[str, Any]) -> Tuple[List[ReportSnapshot], Dict[str, Any]]:
    file_id = str(drive_file.get("id") or "")
    file_name = str(drive_file.get("name") or "")
    mime_type = str(drive_file.get("mimeType") or "")
    report_date = parse_date_from_text(file_name)
    if not report_date:
        modified = first_non_empty(drive_file.get("modifiedTime"))
        report_date = datetime.fromisoformat(modified.replace("Z", "+00:00")).date() if modified else date.today()

    extension = ".xlsx" if mime_type == GOOGLE_SHEETS_MIME else pathlib.Path(file_name).suffix.lower()
    if mime_type != GOOGLE_SHEETS_MIME and extension not in SUPPORTED_EXTENSIONS:
        return [], {
            "file_id": file_id,
            "file_name": file_name,
            "mime_type": mime_type,
            "report_date": report_date.isoformat(),
            "drive_modified_time": drive_file.get("modifiedTime"),
            "web_view_link": drive_file.get("webViewLink"),
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "row_count": 0,
            "hold_row_count": 0,
            "status": "skipped",
            "error_message": f"Unsupported file type: {extension or mime_type}",
            "raw": drive_file,
        }

    file_bytes, downloaded_extension = download_drive_file_bytes(service, file_id, mime_type, file_name)
    dataframe = dataframe_from_file(file_bytes, downloaded_extension or extension)
    column_lookup = {normalize_column(column): column for column in dataframe.columns}
    alias_lookup: Dict[str, str] = {}
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in column_lookup:
                alias_lookup[alias] = column_lookup[alias]
                alias_lookup[target] = column_lookup[alias]

    snapshots: List[ReportSnapshot] = []
    hold_count = 0
    for raw_row in dataframe.to_dict(orient="records"):
        extracted = {field: extract_row_value(raw_row, alias_lookup, field) for field in COLUMN_ALIASES}
        item_key = build_item_key(extracted)
        if not item_key.replace("|", "").strip():
            continue
        hold_code = normalize_hold_code(extracted.get("holdstopcode"))
        if hold_code == "H":
            hold_count += 1
        snapshots.append(
            ReportSnapshot(
                report_date=report_date,
                file_id=file_id,
                file_name=file_name,
                item_key=item_key,
                itemcode=extracted.get("itemcode", ""),
                commonname=extracted.get("commonname", ""),
                genus=extracted.get("genus", ""),
                contsize=extracted.get("contsize", ""),
                locationcode=extracted.get("locationcode", ""),
                lotcode=extracted.get("lotcode", ""),
                season=extracted.get("season", ""),
                blockalpha=extracted.get("blockalpha", ""),
                salesyear=extracted.get("salesyear", ""),
                holdstopcode=hold_code,
                holdstopreason=extracted.get("holdstopreason", ""),
                holdstopbegindate=extracted.get("holdstopbegindate", ""),
                raw={str(k): normalize_value(v) for k, v in raw_row.items()},
            )
        )

    manifest = {
        "file_id": file_id,
        "file_name": file_name,
        "mime_type": mime_type,
        "report_date": report_date.isoformat(),
        "drive_modified_time": drive_file.get("modifiedTime"),
        "web_view_link": drive_file.get("webViewLink"),
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "row_count": len(snapshots),
        "hold_row_count": hold_count,
        "status": "processed",
        "error_message": None,
        "raw": {
            "drive_file": drive_file,
            "columns": list(map(str, dataframe.columns)),
        },
    }
    return snapshots, manifest


def fetch_daily_gdd(client: SupabaseRest, start_date: date, end_date: date) -> Dict[str, float]:
    if start_date > end_date:
        return {}
    query = urllib.parse.urlencode(
        {
            "select": "date,daily_gdd_base_50",
            "station_key": "eq.park_hill_ok",
            "date": f"gte.{start_date.isoformat()}",
            "order": "date.asc",
            "limit": "20000",
        }
    )
    rows = client.select_all("v2_weather_daily", query, page_size=1000, max_rows=20000)
    result: Dict[str, float] = {}
    for row in rows:
        day = str(row.get("date") or "")
        if not day or day > end_date.isoformat():
            continue
        try:
            result[day] = float(row.get("daily_gdd_base_50") or 0)
        except (TypeError, ValueError):
            result[day] = 0.0
    return result


def sum_gdd(daily_gdd: Dict[str, float], start_date: date, end_date: date) -> float:
    total = 0.0
    current = start_date
    from datetime import timedelta

    while current <= end_date:
        total += float(daily_gdd.get(current.isoformat(), 0.0))
        current += timedelta(days=1)
    return round(total, 3)


def build_cycles(snapshots: Sequence[ReportSnapshot], daily_gdd: Dict[str, float]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[ReportSnapshot]] = {}
    for snapshot in snapshots:
        grouped.setdefault(snapshot.item_key, []).append(snapshot)

    cycles: List[Dict[str, Any]] = []
    for item_key, group in grouped.items():
        group.sort(key=lambda item: (item.report_date, item.file_name, item.file_id))
        active_start: Optional[ReportSnapshot] = None
        source_ids: List[str] = []
        source_names: List[str] = []

        for snapshot in group:
            is_hold = snapshot.holdstopcode == "H"
            if is_hold:
                if active_start is None:
                    active_start = snapshot
                    source_ids = []
                    source_names = []
                if snapshot.file_id not in source_ids:
                    source_ids.append(snapshot.file_id)
                    source_names.append(snapshot.file_name)
                continue

            if active_start is None:
                continue

            release_date = snapshot.report_date
            hold_days = max((release_date - active_start.report_date).days, 0)
            gdd_to_release = sum_gdd(daily_gdd, active_start.report_date, release_date)
            if snapshot.file_id not in source_ids:
                source_ids.append(snapshot.file_id)
                source_names.append(snapshot.file_name)
            reason = active_start.holdstopreason
            unique_id = stable_id("hold_cycle", item_key, active_start.report_date.isoformat(), reason)
            cycles.append(
                {
                    "unique_id": unique_id,
                    "item_key": item_key,
                    "itemcode": active_start.itemcode or snapshot.itemcode or None,
                    "commonname": active_start.commonname or snapshot.commonname or None,
                    "genus": active_start.genus or snapshot.genus or None,
                    "contsize": active_start.contsize or snapshot.contsize or None,
                    "locationcode": active_start.locationcode or snapshot.locationcode or None,
                    "lotcode": active_start.lotcode or snapshot.lotcode or None,
                    "season": active_start.season or snapshot.season or None,
                    "blockalpha": active_start.blockalpha or snapshot.blockalpha or None,
                    "salesyear": active_start.salesyear or snapshot.salesyear or None,
                    "holdstopreason": reason or None,
                    "hold_reason_category": classify_hold_reason(reason),
                    "hold_started_on": active_start.report_date.isoformat(),
                    "hold_released_on": release_date.isoformat(),
                    "hold_days": hold_days,
                    "gdd_base_50_to_release": gdd_to_release,
                    "start_file_id": active_start.file_id,
                    "start_file_name": active_start.file_name,
                    "release_file_id": snapshot.file_id,
                    "release_file_name": snapshot.file_name,
                    "source_file_ids": source_ids,
                    "source_file_names": source_names,
                    "snapshot": {
                        "start": dataclasses.asdict(active_start),
                        "release": dataclasses.asdict(snapshot),
                    },
                }
            )
            active_start = None
            source_ids = []
            source_names = []

    return cycles


def run() -> int:
    supabase_url = first_non_empty(os.environ.get("SUPABASE_URL"))
    supabase_key = first_non_empty(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"), os.environ.get("SUPABASE_KEY"))
    service_account_json = first_non_empty(os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON"), os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))
    folder_id = first_non_empty(os.environ.get("DRIVE_AROUND_REPORTS_FOLDER_ID"), default=DEFAULT_DRIVE_AROUND_REPORTS_FOLDER_ID)
    max_files = env_int("DRIVE_AROUND_MAX_FILES", 0)

    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    if not service_account_json:
        raise RuntimeError("GDRIVE_SERVICE_ACCOUNT_JSON is required.")

    started = time.time()
    client = SupabaseRest(supabase_url, supabase_key)
    service = build_drive_service(service_account_json)

    drive_files = list_drive_files_recursive(service, folder_id, max_files=max_files)
    print(f"Found {len(drive_files)} Drive Around report file(s).")
    all_snapshots: List[ReportSnapshot] = []
    manifests: List[Dict[str, Any]] = []

    for drive_file in drive_files:
        file_name = str(drive_file.get("name") or "")
        try:
            snapshots, manifest = snapshots_from_file(service, drive_file)
            all_snapshots.extend(snapshots)
            manifests.append(manifest)
            print(f"Processed {file_name}: {len(snapshots)} row(s).")
        except Exception as exc:
            manifests.append(
                {
                    "file_id": str(drive_file.get("id") or stable_id("drive_file", file_name)),
                    "file_name": file_name,
                    "mime_type": drive_file.get("mimeType"),
                    "report_date": (parse_date_from_text(file_name) or date.today()).isoformat(),
                    "drive_modified_time": drive_file.get("modifiedTime"),
                    "web_view_link": drive_file.get("webViewLink"),
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                    "row_count": 0,
                    "hold_row_count": 0,
                    "status": "failed",
                    "error_message": f"{type(exc).__name__}: {exc}",
                    "raw": drive_file,
                }
            )
            print(f"Failed {file_name}: {type(exc).__name__}: {exc}", file=sys.stderr)

    if manifests:
        client.upsert("v2_drive_around_report_files", manifests, on_conflict="file_id")

    if not all_snapshots:
        print("No Drive Around row snapshots were available for hold-cycle learning.")
        return 0

    start_date = min(snapshot.report_date for snapshot in all_snapshots)
    end_date = max(snapshot.report_date for snapshot in all_snapshots)
    daily_gdd = fetch_daily_gdd(client, start_date, end_date)
    cycles = build_cycles(all_snapshots, daily_gdd)
    if cycles:
        client.upsert("v2_hold_release_cycles", cycles, on_conflict="unique_id")
        try:
            refreshed = client.rpc("v2_refresh_hold_learning_profiles", {})
            print(f"Refreshed hold learning profiles: {refreshed}")
        except Exception as exc:
            print(f"Profile refresh skipped: {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"Upserted {len(cycles)} hold release cycle(s) from {len(all_snapshots)} row snapshot(s).")
    print(f"Drive Around hold-cycle learning completed in {round(time.time() - started, 1)}s.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
