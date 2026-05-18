#!/usr/bin/env python3
"""Sync Park Hill weather and refresh hold-stop learning features.

This script is designed for GitHub Actions. It uses the free Open-Meteo API,
stores hourly Park Hill, OK weather in Supabase, then refreshes GDD/chill-hour
rollups on hold events captured from v2_master_inventory.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List
from zoneinfo import ZoneInfo


OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DEFAULT_LATITUDE = 35.8615
DEFAULT_LONGITUDE = -94.9586
DEFAULT_TIMEZONE = "America/Chicago"
DEFAULT_STATION_KEY = "park_hill_ok"
HOURLY_FIELDS = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
]
DAILY_FIELDS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "wind_speed_10m_max",
    "wind_direction_10m_dominant",
]


def first_non_empty(*values: Any, default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def env_float(name: str, default: float) -> float:
    raw = first_non_empty(os.environ.get(name))
    if not raw:
        return default
    return float(raw)


def env_int(name: str, default: int) -> int:
    raw = first_non_empty(os.environ.get(name))
    if not raw:
        return default
    return int(raw)


def env_bool(name: str, default: bool = False) -> bool:
    raw = first_non_empty(os.environ.get(name))
    if not raw:
        return default
    return raw.lower() in {"1", "true", "yes", "y", "on"}


def json_request(url: str, method: str = "GET", payload: Any = None, headers: Dict[str, str] | None = None, timeout: int = 60) -> Any:
    data = None
    request_headers = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        detail = body[:2000] if body else exc.reason
        raise RuntimeError(f"HTTP {exc.code} {method} {url}: {detail}") from exc
    if not raw:
        return None
    return json.loads(raw)


def fetch_open_meteo_hourly(latitude: float, longitude: float, timezone_name: str, past_days: int) -> Dict[str, Any]:
    query = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "hourly": ",".join(HOURLY_FIELDS),
        "daily": ",".join(DAILY_FIELDS),
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": timezone_name,
        "past_days": str(max(1, min(92, past_days))),
        "forecast_days": "2",
    }
    url = OPEN_METEO_FORECAST_URL + "?" + urllib.parse.urlencode(query)
    try:
        return json_request(url, timeout=90)
    except urllib.error.HTTPError as exc:
        if past_days > 14:
            print(f"Open-Meteo rejected {past_days} past days; retrying with 14 days. HTTP {exc.code}", file=sys.stderr)
            return fetch_open_meteo_hourly(latitude, longitude, timezone_name, 14)
        raise


def fetch_open_meteo_archive_hourly(latitude: float, longitude: float, timezone_name: str, start_date: date, end_date: date) -> Dict[str, Any]:
    query = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "hourly": ",".join(HOURLY_FIELDS),
        "daily": ",".join(DAILY_FIELDS),
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": timezone_name,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }
    url = OPEN_METEO_ARCHIVE_URL + "?" + urllib.parse.urlencode(query)
    return json_request(url, timeout=120)


def iter_date_chunks(start_date: date, end_date: date, chunk_days: int) -> Iterable[tuple[date, date]]:
    safe_chunk_days = max(1, int(chunk_days or 1))
    current = start_date
    while current <= end_date:
        chunk_end = min(end_date, current + timedelta(days=safe_chunk_days - 1))
        yield current, chunk_end
        current = chunk_end + timedelta(days=1)


def subtract_years(value: date, years: int) -> date:
    safe_years = max(1, int(years or 1))
    try:
        return value.replace(year=value.year - safe_years)
    except ValueError:
        return value.replace(year=value.year - safe_years, month=2, day=28)


def parse_local_hour(value: str, timezone_name: str) -> datetime:
    local_zone = ZoneInfo(timezone_name)
    parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=local_zone)
    return parsed.astimezone(timezone.utc)


def hourly_rows_from_response(payload: Dict[str, Any], station_key: str, latitude: float, longitude: float, timezone_name: str) -> List[Dict[str, Any]]:
    hourly = payload.get("hourly") if isinstance(payload, dict) else {}
    times = list(hourly.get("time") or [])
    temperatures = list(hourly.get("temperature_2m") or [])
    humidity = list(hourly.get("relative_humidity_2m") or [])
    precipitation = list(hourly.get("precipitation") or [])
    wind_speed = list(hourly.get("wind_speed_10m") or [])
    wind_direction = list(hourly.get("wind_direction_10m") or [])
    rows: List[Dict[str, Any]] = []
    seen_observed_at: Dict[str, int] = {}

    for index, local_time in enumerate(times):
        temperature_f = temperatures[index] if index < len(temperatures) else None
        humidity_value = humidity[index] if index < len(humidity) else None
        precipitation_value = precipitation[index] if index < len(precipitation) else None
        wind_speed_value = wind_speed[index] if index < len(wind_speed) else None
        wind_direction_value = wind_direction[index] if index < len(wind_direction) else None
        observed_at = parse_local_hour(str(local_time), timezone_name)
        if temperature_f is None:
            gdd_base_50 = 0.0
            chill_hours = 0.0
        else:
            temp = float(temperature_f)
            gdd_base_50 = max(temp - 50.0, 0.0) / 24.0
            chill_hours = 1.0 if 32.0 <= temp <= 45.0 else 0.0

        row = {
            "unique_id": f"{station_key}:{observed_at.strftime('%Y%m%dT%H%M%SZ')}",
            "station_key": station_key,
            "latitude": latitude,
            "longitude": longitude,
            "timezone": timezone_name,
            "observed_at": observed_at.isoformat(),
            "local_time": str(local_time),
            "temperature_f": temperature_f,
            "relative_humidity": humidity_value,
            "precipitation_in": precipitation_value,
            "wind_speed_mph": wind_speed_value,
            "wind_direction_deg": wind_direction_value,
            "gdd_base_50": round(gdd_base_50, 5),
            "chill_hours": chill_hours,
            "source": "open-meteo",
            "raw": {
                "open_meteo_local_time": str(local_time),
                "temperature_unit": "fahrenheit",
                "gdd_base": 50,
                "chill_hour_rule": "32F_to_45F",
            },
        }

        duplicate_index = seen_observed_at.get(row["unique_id"])
        if duplicate_index is not None:
            # Open-Meteo can return a duplicate converted UTC hour around DST
            # transitions. Keep one row per Supabase unique timestamp so the
            # batch upsert never tries to update the same row twice.
            rows[duplicate_index] = row
        else:
            rows.append(row)
            seen_observed_at[row["unique_id"]] = len(rows) - 1
    return rows


def daily_gdd_base_50(high_f: Any, low_f: Any) -> float:
    if high_f is None or low_f is None:
        return 0.0
    return max(((float(high_f) + float(low_f)) / 2.0) - 50.0, 0.0)


def daily_rows_from_response(payload: Dict[str, Any], station_key: str, latitude: float, longitude: float, timezone_name: str) -> List[Dict[str, Any]]:
    daily = payload.get("daily") if isinstance(payload, dict) else {}
    dates = list(daily.get("time") or [])
    highs = list(daily.get("temperature_2m_max") or [])
    lows = list(daily.get("temperature_2m_min") or [])
    precipitation = list(daily.get("precipitation_sum") or [])
    wind_speed = list(daily.get("wind_speed_10m_max") or [])
    wind_direction = list(daily.get("wind_direction_10m_dominant") or [])
    rows: List[Dict[str, Any]] = []

    for index, local_date in enumerate(dates):
        high_f = highs[index] if index < len(highs) else None
        low_f = lows[index] if index < len(lows) else None
        precipitation_value = precipitation[index] if index < len(precipitation) else None
        wind_speed_value = wind_speed[index] if index < len(wind_speed) else None
        wind_direction_value = wind_direction[index] if index < len(wind_direction) else None
        rows.append(
            {
                "unique_id": f"{station_key}:{local_date}",
                "station_key": station_key,
                "latitude": latitude,
                "longitude": longitude,
                "timezone": timezone_name,
                "date": str(local_date),
                "temperature_high_f": high_f,
                "temperature_low_f": low_f,
                "daily_gdd_base_50": round(daily_gdd_base_50(high_f, low_f), 5),
                "precipitation_in": precipitation_value,
                "wind_speed_mph": wind_speed_value,
                "wind_direction_deg": wind_direction_value,
                "source": "open-meteo",
                "raw": {
                    "open_meteo_local_date": str(local_date),
                    "temperature_unit": "fahrenheit",
                    "gdd_formula": "max(((high_f + low_f) / 2) - 50, 0)",
                },
            }
        )
    return rows


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

    def upsert(self, table: str, rows: List[Dict[str, Any]], on_conflict: str = "unique_id", batch_size: int = 500) -> int:
        if not rows:
            return 0
        total = 0
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            query = urllib.parse.urlencode({"on_conflict": on_conflict})
            endpoint = f"{self.url}/rest/v1/{urllib.parse.quote(table, safe='')}?{query}"
            json_request(
                endpoint,
                method="POST",
                payload=batch,
                headers=self.headers("resolution=merge-duplicates,return=minimal"),
                timeout=90,
            )
            total += len(batch)
        return total

    def rpc(self, function_name: str, payload: Dict[str, Any] | None = None) -> Any:
        endpoint = f"{self.url}/rest/v1/rpc/{urllib.parse.quote(function_name, safe='')}"
        return json_request(
            endpoint,
            method="POST",
            payload=payload or {},
            headers=self.headers("return=representation"),
            timeout=120,
        )

    def count_weather_rows_since(self, table: str, station_key: str, observed_at_gte: str) -> int:
        query = urllib.parse.urlencode({
            "select": "unique_id",
            "station_key": f"eq.{station_key}",
            "observed_at": f"gte.{observed_at_gte}",
            "limit": "1",
        })
        endpoint = f"{self.url}/rest/v1/{urllib.parse.quote(table, safe='')}?{query}"
        headers = self.headers("count=exact")
        headers["Range"] = "0-0"
        request = urllib.request.Request(endpoint, headers=headers, method="GET")
        with urllib.request.urlopen(request, timeout=60) as response:
            content_range = response.headers.get("Content-Range", "")
            response.read()
        if "/" not in content_range:
            return 0
        total = content_range.rsplit("/", 1)[-1].strip()
        if not total or total == "*":
            return 0
        try:
            return int(total)
        except ValueError:
            return 0

    def count_daily_rows_since(self, table: str, station_key: str, date_gte: date) -> int:
        query = urllib.parse.urlencode({
            "select": "unique_id",
            "station_key": f"eq.{station_key}",
            "date": f"gte.{date_gte.isoformat()}",
            "limit": "1",
        })
        endpoint = f"{self.url}/rest/v1/{urllib.parse.quote(table, safe='')}?{query}"
        headers = self.headers("count=exact")
        headers["Range"] = "0-0"
        request = urllib.request.Request(endpoint, headers=headers, method="GET")
        with urllib.request.urlopen(request, timeout=60) as response:
            content_range = response.headers.get("Content-Range", "")
            response.read()
        if "/" not in content_range:
            return 0
        total = content_range.rsplit("/", 1)[-1].strip()
        if not total or total == "*":
            return 0
        try:
            return int(total)
        except ValueError:
            return 0


def run() -> int:
    supabase_url = first_non_empty(os.environ.get("SUPABASE_URL"))
    supabase_key = first_non_empty(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"), os.environ.get("SUPABASE_KEY"))
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    latitude = env_float("WEATHER_LATITUDE", DEFAULT_LATITUDE)
    longitude = env_float("WEATHER_LONGITUDE", DEFAULT_LONGITUDE)
    timezone_name = first_non_empty(os.environ.get("WEATHER_TIMEZONE"), default=DEFAULT_TIMEZONE)
    station_key = first_non_empty(os.environ.get("WEATHER_STATION_KEY"), default=DEFAULT_STATION_KEY)
    lookback_days = env_int("WEATHER_LOOKBACK_DAYS", 92)
    history_years = env_int("WEATHER_HISTORY_YEARS", 10)
    history_chunk_days = env_int("WEATHER_HISTORY_CHUNK_DAYS", 365)
    history_min_coverage = env_float("WEATHER_HISTORY_MIN_COVERAGE", 0.9)
    history_force = env_bool("WEATHER_HISTORY_FORCE", False)
    history_max_chunks = env_int("WEATHER_HISTORY_MAX_CHUNKS", 0)
    refresh_limit = env_int("HOLD_WEATHER_REFRESH_LIMIT", 2000)
    history_refresh_limit = env_int("HOLD_HISTORY_REFRESH_LIMIT", 100000)

    started = time.time()
    supabase = SupabaseRest(supabase_url, supabase_key)

    local_today = datetime.now(ZoneInfo(timezone_name)).date()
    history_start = subtract_years(local_today, history_years)
    history_end = local_today - timedelta(days=1)
    if history_years > 0 and history_start <= history_end:
        expected_history_hours = max(1, ((history_end - history_start).days + 1) * 24)
        expected_history_days = max(1, ((history_end - history_start).days + 1))
        observed_at_gte = datetime.combine(history_start, datetime.min.time(), ZoneInfo(timezone_name)).astimezone(timezone.utc).isoformat()
        existing_history_hours = supabase.count_weather_rows_since("v2_weather_hourly", station_key, observed_at_gte)
        existing_history_days = supabase.count_daily_rows_since("v2_weather_daily", station_key, history_start)
        hourly_coverage_ratio = existing_history_hours / expected_history_hours
        daily_coverage_ratio = existing_history_days / expected_history_days
        should_backfill_history = history_force or hourly_coverage_ratio < history_min_coverage or daily_coverage_ratio < history_min_coverage
        print(
            f"Weather history coverage since {history_start}: {existing_history_hours}/{expected_history_hours} "
            f"hours ({hourly_coverage_ratio:.1%}), {existing_history_days}/{expected_history_days} "
            f"days ({daily_coverage_ratio:.1%}). Backfill needed: {should_backfill_history}."
        )
        if should_backfill_history:
            history_upserted = 0
            chunk_count = 0
            for chunk_start, chunk_end in iter_date_chunks(history_start, history_end, history_chunk_days):
                chunk_count += 1
                if history_max_chunks and chunk_count > history_max_chunks:
                    print(f"Stopping historical backfill after {history_max_chunks} chunks by WEATHER_HISTORY_MAX_CHUNKS.")
                    break
                print(f"Fetching historical Open-Meteo archive {chunk_start} to {chunk_end}.")
                archive_payload = fetch_open_meteo_archive_hourly(latitude, longitude, timezone_name, chunk_start, chunk_end)
                archive_rows = hourly_rows_from_response(archive_payload, station_key, latitude, longitude, timezone_name)
                archive_daily_rows = daily_rows_from_response(archive_payload, station_key, latitude, longitude, timezone_name)
                history_upserted += supabase.upsert("v2_weather_hourly", archive_rows, on_conflict="unique_id")
                supabase.upsert("v2_weather_daily", archive_daily_rows, on_conflict="unique_id")
                print(f"Upserted {len(archive_rows)} archive rows for {chunk_start} to {chunk_end}.")
            print(f"Historical weather backfill upserted {history_upserted} rows.")

    print(f"Fetching Open-Meteo weather for {station_key} ({latitude}, {longitude}) with {lookback_days} day lookback.")
    weather_payload = fetch_open_meteo_hourly(latitude, longitude, timezone_name, lookback_days)
    rows = hourly_rows_from_response(weather_payload, station_key, latitude, longitude, timezone_name)
    daily_rows = daily_rows_from_response(weather_payload, station_key, latitude, longitude, timezone_name)
    if not rows:
        raise RuntimeError("Open-Meteo returned no hourly weather rows.")

    upserted = supabase.upsert("v2_weather_hourly", rows, on_conflict="unique_id")
    daily_upserted = supabase.upsert("v2_weather_daily", daily_rows, on_conflict="unique_id")
    print(f"Upserted {upserted} hourly weather rows.")
    print(f"Upserted {daily_upserted} daily weather rows.")

    try:
        history_refreshed = supabase.rpc(
            "v2_refresh_hold_learning_from_drive_around_rows",
            {"p_limit": history_refresh_limit},
        )
        print(f"Refreshed Drive Around hold learning from v2_drive_around_report_rows: {history_refreshed}")
    except RuntimeError as exc:
        message = str(exc)
        missing_rpc = "PGRST202" in message or "Could not find the function" in message or "does not exist" in message
        if not missing_rpc:
            raise
        print("Drive Around row-history hold learning RPC is not installed yet; skipping row-history refresh.")

    refreshed = supabase.rpc("v2_refresh_hold_learning_weather_features", {"p_limit": refresh_limit})
    print(f"Refreshed hold weather features: {refreshed}")
    profile_refreshed = supabase.rpc("v2_refresh_hold_learning_profiles", {})
    print(f"Refreshed hold learning profiles: {profile_refreshed}")
    print(f"Weather hold learning sync completed in {round(time.time() - started, 1)}s.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
