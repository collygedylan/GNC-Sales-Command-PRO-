#!/usr/bin/env python3
"""Sync machine-learning model assets from a Google Drive folder into /models."""

from __future__ import annotations

import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from typing import Any, Dict, Iterable, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload


DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
DEFAULT_EXTENSIONS = {".pt", ".pth", ".onnx", ".json", ".txt", ".yaml", ".yml"}
GITHUB_SOFT_LIMIT_BYTES = 95 * 1024 * 1024


def read_service_account_info(raw_value: str) -> Dict[str, Any]:
    value = str(raw_value or "").strip()
    if not value:
        raise RuntimeError("GDRIVE_SERVICE_ACCOUNT_JSON is required.")

    if not value.startswith("{"):
        candidate_path = pathlib.Path(value)
        if candidate_path.exists():
            return json.loads(candidate_path.read_text(encoding="utf-8"))

    return json.loads(value)


def build_drive_service() -> Any:
    service_account_json = os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON", "")
    service_account_info = read_service_account_info(service_account_json)
    credentials = service_account.Credentials.from_service_account_info(
        service_account_info,
        scopes=[DRIVE_SCOPE],
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def get_allowed_extensions() -> set[str]:
    raw = os.environ.get("GDRIVE_FILE_EXTENSIONS", "")
    if not raw.strip():
        return set(DEFAULT_EXTENSIONS)
    extensions = set()
    for part in raw.split(","):
        value = part.strip().lower()
        if not value:
            continue
        if not value.startswith("."):
            value = "." + value
        extensions.add(value)
    return extensions or set(DEFAULT_EXTENSIONS)


def sanitize_drive_name(name: str) -> str:
    safe = "".join(char if char.isalnum() or char in "._- " else "_" for char in str(name or "").strip())
    safe = "_".join(safe.split())
    if not safe or safe in {".", ".."}:
        raise RuntimeError(f"Unsafe Drive file name: {name!r}")
    return safe


def list_drive_files(service: Any, folder_id: str, allowed_extensions: set[str]) -> List[Dict[str, Any]]:
    files: List[Dict[str, Any]] = []
    page_token = None
    query = f"'{folder_id}' in parents and trashed = false"

    while True:
        response = (
            service.files()
            .list(
                q=query,
                spaces="drive",
                fields="nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime)",
                pageToken=page_token,
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
            )
            .execute()
        )
        for item in response.get("files", []):
            name = str(item.get("name") or "")
            if str(item.get("mimeType") or "") == "application/vnd.google-apps.folder":
                continue
            if pathlib.Path(name).suffix.lower() in allowed_extensions:
                files.append(item)
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    files.sort(key=lambda entry: str(entry.get("name") or "").lower())
    return files


def is_lfs_tracked(path: pathlib.Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "check-attr", "filter", "--", str(path)],
            check=False,
            text=True,
            capture_output=True,
        )
    except OSError:
        return False
    return "filter: lfs" in result.stdout.lower()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_drive_file(service: Any, file_id: str, target_path: pathlib.Path) -> None:
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(prefix=target_path.name + ".", suffix=".tmp", dir=str(target_path.parent), delete=False) as temp_handle:
        temp_path = pathlib.Path(temp_handle.name)
        downloader = MediaIoBaseDownload(temp_handle, request, chunksize=1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()

    temp_path.replace(target_path)


def write_manifest(output_dir: pathlib.Path, records: Iterable[Dict[str, Any]]) -> None:
    manifest_path = output_dir / "drive_sync_manifest.json"
    clean_records = []
    for record in records:
        clean_records.append(
            {
                "drive_id": record["drive_id"],
                "name": record["name"],
                "path": record["path"],
                "modified_time": record.get("modified_time", ""),
                "md5_checksum": record.get("md5_checksum", ""),
                "sha256": record.get("sha256", ""),
                "size": record.get("size", 0),
            }
        )
    manifest_path.write_text(json.dumps({"files": clean_records}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    folder_id = str(os.environ.get("GDRIVE_MODEL_FOLDER_ID") or "").strip()
    if not folder_id:
        raise RuntimeError("GDRIVE_MODEL_FOLDER_ID is required.")

    output_dir = pathlib.Path(os.environ.get("GDRIVE_OUTPUT_DIR", "models")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    service = build_drive_service()
    allowed_extensions = get_allowed_extensions()
    files = list_drive_files(service, folder_id, allowed_extensions)

    if not files:
        print("No matching model files found in the configured Google Drive folder.")
        write_manifest(output_dir, [])
        return 0

    synced_records: List[Dict[str, Any]] = []
    for item in files:
        name = sanitize_drive_name(str(item.get("name") or ""))
        target_path = output_dir / name
        size = int(item.get("size") or 0)

        if size > GITHUB_SOFT_LIMIT_BYTES and not is_lfs_tracked(target_path):
            raise RuntimeError(
                f"{name} is {size} bytes. Configure Git LFS for this file before syncing it into GitHub."
            )

        print(f"Downloading {name}...")
        download_drive_file(service, str(item["id"]), target_path)

        synced_records.append(
            {
                "drive_id": str(item.get("id") or ""),
                "name": name,
                "path": str(target_path.relative_to(pathlib.Path.cwd())) if target_path.is_relative_to(pathlib.Path.cwd()) else str(target_path),
                "modified_time": str(item.get("modifiedTime") or ""),
                "md5_checksum": str(item.get("md5Checksum") or ""),
                "sha256": sha256_file(target_path),
                "size": target_path.stat().st_size,
            }
        )

    write_manifest(output_dir, synced_records)
    print(f"Synced {len(synced_records)} model file(s) into {output_dir}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Drive sync failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
