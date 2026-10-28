#!/usr/bin/env python3
"""Offline planner for the daily-tasks-planner skill.

Inputs are local snapshots produced by MCP reads. This script never calls
Notion or Google and never writes task pages.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


TZ = ZoneInfo("Europe/Berlin")
WORK_START = time(7, 30)
WORK_END = time(21, 30)
GRID_MINUTES = 15
BUFFER_MINUTES = 15
DURATION_DEFAULTS = {
    "Assignment": 120,
    "Assigment": 120,
    "Reading": 60,
    "Lecture": 60,
    "Slides": 30,
    "Admin": 30,
    "Chore": 45,
}


@dataclass
class Task:
    id: str
    name: str
    status: str
    type: str
    course: str
    due_start: datetime | None
    do_start: datetime | None
    do_end: datetime | None
    do_date_only: bool
    codex_logs: str
    url: str
    raw: dict[str, Any]


@dataclass
class Interval:
    start: datetime
    end: datetime
    source: str


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "failure": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(2)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        fail(f"cannot read valid JSON at {path}: {exc}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_snapshot_manifest(manifest_path: Path, snapshot_path: Path, key: str, fallback_key: str | None = None) -> None:
    manifest = load_json(manifest_path)
    entry = manifest.get(key) if isinstance(manifest, dict) else None
    if entry is None and fallback_key and isinstance(manifest, dict):
        entry = manifest.get(fallback_key)
    if not isinstance(entry, dict):
        fail(f"snapshot manifest missing {key}: {manifest_path}")
    if Path(str(entry.get("path", ""))) != snapshot_path:
        fail(f"snapshot manifest path mismatch for {key}")
    expected_hash = entry.get("sha256")
    if not isinstance(expected_hash, str) or expected_hash != sha256_file(snapshot_path):
        fail(f"snapshot manifest hash mismatch for {key}")
    if int(entry.get("row_count", 0)) <= 0:
        fail(f"snapshot manifest row_count invalid for {key}")


def page_id_from_url(url: str) -> str:
    if not url:
        return ""
    match = re.search(r"([0-9a-f]{32})(?:[?#/]|$)", url.replace("-", ""), re.I)
    if not match:
        return ""
    raw = match.group(1).lower()
    return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, dict):
        value = value.get("start") or value.get("date")
    if not isinstance(value, str):
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return datetime.fromisoformat(value).replace(tzinfo=TZ)
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ)


def is_date_only(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("start") or value.get("date")
    return isinstance(value, str) and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value))


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value == 1
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "__yes__"}
    return False


def first_str(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            for key in ("name", "plain_text", "content", "id"):
                if isinstance(value.get(key), str):
                    return value[key]
        if isinstance(value, list) and value:
            got = first_str(*value)
            if got:
                return got
    return ""


def plain_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("plain_text", "content"):
            got = value.get(key)
            if isinstance(got, str):
                return got
        text = value.get("text")
        if isinstance(text, dict):
            return plain_text(text)
        return first_str(value)
    if isinstance(value, list):
        return "".join(plain_text(item) for item in value)
    return ""


def prop(row: dict[str, Any], name: str) -> Any:
    if name in row:
        return row[name]
    props = row.get("properties")
    if isinstance(props, dict) and name in props:
        p = props[name]
        if isinstance(p, dict):
            ptype = p.get("type")
            if ptype and ptype in p:
                return p[ptype]
        return p
    return row.get(name)


def date_prop(row: dict[str, Any], name: str) -> tuple[datetime | None, datetime | None, bool]:
    flat_start = row.get(f"date:{name}:start")
    flat_end = row.get(f"date:{name}:end")
    if flat_start is not None or flat_end is not None:
        return parse_dt(flat_start), parse_dt(flat_end), not as_bool(row.get(f"date:{name}:is_datetime"))

    value = prop(row, name)
    if isinstance(value, dict):
        return parse_dt(value.get("start")), parse_dt(value.get("end")), is_date_only(value.get("start"))
    return parse_dt(value), None, is_date_only(value)


def normalize_sql_result(data: Any) -> list[dict[str, Any]]:
    """Accept common MCP SQL result envelopes and return row dictionaries."""
    if isinstance(data, list):
        if data and all(isinstance(item, dict) and "type" in item and "text" in item for item in data):
            rows: list[dict[str, Any]] = []
            for item in data:
                text = item.get("text", "")
                try:
                    parsed = json.loads(text)
                except Exception:
                    continue
                rows.extend(normalize_sql_result(parsed))
            return rows
        return [row for row in data if isinstance(row, dict)]

    if not isinstance(data, dict):
        return []

    for key in ("results", "rows", "data"):
        value = data.get(key)
        if isinstance(value, list):
            return normalize_sql_result(value)

    columns = data.get("columns")
    values = data.get("values")
    if isinstance(columns, list) and isinstance(values, list):
        return [dict(zip(columns, row)) for row in values if isinstance(row, list)]

    return []


def extract_tasks(data: Any) -> list[Task]:
    if isinstance(data, dict) and data.get("has_more"):
        fail("Notion snapshot is incomplete: has_more=true; paginate all pages before planning")
    rows = normalize_sql_result(data)
    if not rows and isinstance(data, dict):
        rows = data.get("results") if isinstance(data.get("results"), list) else []
    if not isinstance(rows, list):
        fail("Notion snapshot must be a list or object with results[]")
    tasks: list[Task] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        do_start, do_end, do_date_only = date_prop(row, "Do Date")
        due_start, _, _ = date_prop(row, "Due Date")
        url = str(row.get("url") or "")
        task_id = str(row.get("id") or row.get("page_id") or page_id_from_url(url))
        tasks.append(
            Task(
                id=task_id,
                name=first_str(prop(row, "Name"), row.get("name")),
                status=first_str(prop(row, "Status"), row.get("status")),
                type=first_str(prop(row, "Type"), row.get("type")),
                course=first_str(prop(row, "Course"), row.get("course")),
                due_start=due_start,
                do_start=do_start,
                do_end=do_end,
                do_date_only=do_date_only,
                codex_logs=plain_text(prop(row, "Codex Logs")),
                url=url,
                raw=row,
            )
        )
    if not tasks:
        fail("Notion snapshot did not contain any task rows")
    return tasks


def extract_busy(data: Any) -> list[Interval]:
    calendars = data.get("calendars") if isinstance(data, dict) else None
    if not isinstance(calendars, dict):
        fail("freebusy snapshot must include calendars{}")
    intervals: list[Interval] = []
    for cal_id, cal in calendars.items():
        if isinstance(cal, dict) and cal.get("errors"):
            fail(f"calendar {cal_id} returned freebusy errors")
        busy = cal.get("busy") if isinstance(cal, dict) else None
        if not isinstance(busy, list):
            continue
        for block in busy:
            start = parse_dt(block.get("start"))
            end = parse_dt(block.get("end"))
            if start and end and end > start:
                intervals.append(Interval(start, end, f"google:{cal_id}"))
    return merge(intervals)


def merge(intervals: list[Interval]) -> list[Interval]:
    ordered = sorted(intervals, key=lambda i: (i.start, i.end))
    out: list[Interval] = []
    for item in ordered:
        if not out or item.start >= out[-1].end:
            out.append(Interval(item.start, item.end, item.source))
        elif item.end > out[-1].end:
            out[-1].end = item.end
            out[-1].source += f",{item.source}"
    return out


def overlaps(start: datetime, end: datetime, intervals: list[Interval]) -> bool:
    return any(start < i.end and end > i.start for i in intervals)


def natural_key(text: str) -> list[Any]:
    return [int(x) if x.isdigit() else x.casefold() for x in re.split(r"(\d+)", text or "")]


def duration(task: Task) -> timedelta:
    if task.do_start and task.do_end and task.do_end > task.do_start:
        return task.do_end - task.do_start
    return timedelta(minutes=DURATION_DEFAULTS.get(task.type, 60))


def task_interval(task: Task) -> tuple[datetime, datetime] | None:
    if task.do_start and task.do_end and task.do_end > task.do_start and not task.do_date_only:
        return task.do_start, task.do_end
    return None


def interval_label(start: datetime | None, end: datetime | None) -> str:
    if not start:
        return "empty"
    if not end:
        return start.isoformat()
    return f"{start.isoformat()} - {end.isoformat()}"


def ceil_grid(dt: datetime) -> datetime:
    minute = dt.minute
    if dt.second or dt.microsecond:
        minute += 1
    minute = ((minute + GRID_MINUTES - 1) // GRID_MINUTES) * GRID_MINUTES
    base = dt.replace(second=0, microsecond=0)
    if minute >= 60:
        return base.replace(minute=0) + timedelta(hours=1)
    return base.replace(minute=minute)


def next_work_start(dt: datetime) -> datetime:
    local = dt.astimezone(TZ)
    start = datetime.combine(local.date(), WORK_START, TZ)
    end = datetime.combine(local.date(), WORK_END, TZ)
    if local < start:
        return start
    if local >= end:
        return datetime.combine(local.date() + timedelta(days=1), WORK_START, TZ)
    return ceil_grid(local)


def place_task(start_after: datetime, dur: timedelta, busy: list[Interval], horizon_end: datetime) -> tuple[datetime, datetime] | None:
    cursor = next_work_start(start_after)
    while cursor + dur <= horizon_end:
        day_end = datetime.combine(cursor.date(), WORK_END, TZ)
        end = cursor + dur
        blocked_end = end + timedelta(minutes=BUFFER_MINUTES)
        if end <= day_end and not overlaps(cursor, blocked_end, busy):
            return cursor, end
        cursor += timedelta(minutes=GRID_MINUTES)
        if cursor.time() >= WORK_END:
            cursor = next_work_start(cursor)
    return None


def place_task_allowing_overlap(start_after: datetime, dur: timedelta, horizon_end: datetime) -> tuple[datetime, datetime] | None:
    cursor = next_work_start(start_after)
    while cursor + dur <= horizon_end:
        day_end = datetime.combine(cursor.date(), WORK_END, TZ)
        end = cursor + dur
        if end <= day_end:
            return cursor, end
        cursor = next_work_start(datetime.combine(cursor.date() + timedelta(days=1), WORK_START, TZ))
    return None


def initial_move_reason(task: Task, now: datetime, seen_fixed: list[Interval]) -> str | None:
    interval = task_interval(task)
    if task.do_start is None:
        return "missing Do Date"
    if task.do_date_only:
        return "date-only Do Date"
    if interval is None:
        return "Do Date has no valid end"
    if task.do_start < now:
        return "past Do Date"
    if task.do_start.date() == now.date() and task.do_start < now:
        return "stale-today Do Date"
    if overlaps(interval[0], interval[1] + timedelta(minutes=BUFFER_MINUTES), seen_fixed):
        return "overlapping Do Date"
    return None


def course_order_key(task: Task) -> tuple[Any, ...]:
    return (task.course, task.due_start or datetime.max.replace(tzinfo=TZ), natural_key(task.name), task.type)


def mark_course_sequence_breaks(candidates: list[Task], movable_ids: set[str], reasons: dict[str, str]) -> None:
    last_fixed_start_by_course: dict[str, datetime] = {}
    for task in sorted(candidates, key=course_order_key):
        interval = task_interval(task)
        if not interval or task.id in movable_ids:
            continue
        last_start = last_fixed_start_by_course.get(task.course)
        if last_start and interval[0] < last_start:
            movable_ids.add(task.id)
            reasons[task.id] = "course-sequence-breaking Do Date"
            continue
        last_fixed_start_by_course[task.course] = interval[0]


def validate_plan(moves: list[dict[str, Any]], retained: list[Task], google_busy: list[Interval], now: datetime) -> list[str]:
    errors: list[str] = []
    intervals: list[Interval] = list(google_busy)
    for task in retained:
        interval = task_interval(task)
        if interval:
            intervals.append(Interval(interval[0], interval[1] + timedelta(minutes=BUFFER_MINUTES), f"retained:{task.id}"))
    placed: list[Interval] = []
    for move in moves:
        start = parse_dt(move["new_start"])
        end = parse_dt(move["new_end"])
        if not start or not end:
            errors.append(f"move {move.get('id')} has invalid timestamps")
            continue
        if start < now:
            errors.append(f"move {move.get('id')} starts before run time")
        if overlaps(start, end + timedelta(minutes=BUFFER_MINUTES), intervals + placed) and not move.get("forced_overlap"):
            errors.append(f"move {move.get('id')} overlaps a fixed or moved interval")
        placed.append(Interval(start, end + timedelta(minutes=BUFFER_MINUTES), f"move:{move.get('id')}"))
    return errors


def plan(tasks: list[Task], google_busy: list[Interval], now: datetime, horizon_days: int) -> dict[str, Any]:
    horizon_end = now + timedelta(days=horizon_days)
    candidates = [t for t in tasks if t.status in {"not started", "in progress"}]
    fixed: list[Interval] = list(google_busy)
    movable: list[Task] = []
    retained: list[Task] = []
    seen_fixed: list[Interval] = list(google_busy)
    reasons: dict[str, str] = {}
    movable_ids: set[str] = set()
    for task in candidates:
        interval = task_interval(task)
        reason = initial_move_reason(task, now, seen_fixed)
        if reason:
            movable_ids.add(task.id)
            reasons[task.id] = reason
        else:
            fixed.append(Interval(interval[0], interval[1] + timedelta(minutes=BUFFER_MINUTES), f"notion:{task.id}"))
            seen_fixed = merge(fixed)
    mark_course_sequence_breaks(candidates, movable_ids, reasons)
    fixed = list(google_busy)
    for task in candidates:
        if task.id in movable_ids:
            movable.append(task)
            continue
        interval = task_interval(task)
        if interval:
            retained.append(task)
            fixed.append(Interval(interval[0], interval[1] + timedelta(minutes=BUFFER_MINUTES), f"notion:{task.id}"))
    busy = merge(fixed)
    movable.sort(key=course_order_key)
    moves = []
    overlap_cursor = now
    for task in movable:
        placed = place_task(now, duration(task), busy, horizon_end)
        forced_overlap = False
        if not placed:
            if horizon_days < 28:
                return {"ok": False, "needs_horizon_extension": True, "failure": f"no slot for {task.id or task.name}", "horizon_days": horizon_days}
            placed = place_task_allowing_overlap(overlap_cursor, duration(task), horizon_end)
            if not placed:
                return {"ok": False, "needs_horizon_extension": False, "failure": f"no even overlapping work-window slot for {task.id or task.name}", "horizon_days": horizon_days}
            forced_overlap = True
        start, end = placed
        reason = reasons.get(task.id, "movable unfinished task")
        if forced_overlap:
            reason = f"{reason}; forced overlap because no non-overlapping slot fit within 28-day horizon"
            overlap_cursor = end + timedelta(minutes=BUFFER_MINUTES)
        log_line = f"{now.strftime('%Y-%m-%d %H:%M')}: moved Do Date from {interval_label(task.do_start, task.do_end)} -> {interval_label(start, end)} (reason: {reason})"
        new_logs = f"{task.codex_logs.rstrip()}\n{log_line}".strip()
        moves.append({
            "id": task.id,
            "url": task.url,
            "name": task.name,
            "old_start": task.do_start.isoformat() if task.do_start else "",
            "old_end": task.do_end.isoformat() if task.do_end else "",
            "new_start": start.isoformat(),
            "new_end": end.isoformat(),
            "reason": reason,
            "forced_overlap": forced_overlap,
            "codex_log_line": log_line,
            "properties": {
                "date:Do Date:start": start.isoformat(),
                "date:Do Date:end": end.isoformat(),
                "date:Do Date:is_datetime": 1,
                "Codex Logs": new_logs,
            },
        })
        busy = merge(busy + [Interval(start, end + timedelta(minutes=BUFFER_MINUTES), f"move:{task.id}")])
    validation_errors = validate_plan(moves, retained, google_busy, now)
    if validation_errors:
        return {"ok": False, "needs_horizon_extension": False, "failure": "; ".join(validation_errors), "horizon_days": horizon_days}
    return {
        "ok": True,
        "horizon_days": horizon_days,
        "moves": moves,
        "retained": [{"id": t.id, "url": t.url, "name": t.name} for t in retained],
        "fixed_interval_count": len(fixed),
        "candidate_count": len(candidates),
    }


def write_csv(path: Path, result: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "url", "name", "old_start", "old_end", "new_start", "new_end", "reason"])
        writer.writeheader()
        for row in result.get("moves", []):
            writer.writerow({key: row.get(key, "") for key in writer.fieldnames or []})


def write_payloads(path: Path, result: dict[str, Any]) -> None:
    payloads = []
    for move in result.get("moves", []):
        if not move.get("id"):
            fail(f"cannot build write payload for task without page id: {move.get('name')}")
        payloads.append({"page_id": move["id"], "properties": move["properties"]})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payloads, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--memory", required=True, type=Path)
    parser.add_argument("--notion", required=True, type=Path)
    parser.add_argument("--freebusy", required=True, type=Path)
    parser.add_argument("--out-csv", required=True, type=Path)
    parser.add_argument("--out-json", required=True, type=Path)
    parser.add_argument("--out-writes", type=Path)
    parser.add_argument("--notion-manifest", type=Path)
    parser.add_argument("--freebusy-manifest", type=Path)
    parser.add_argument("--now")
    args = parser.parse_args()

    memory = args.memory.read_text()
    for required in ("Europe/Berlin", "fail closed", "collection://", "freebusy.query", "Assigment"):
        if required not in memory:
            fail(f"memory missing required marker: {required}")

    now = parse_dt(args.now) if args.now else datetime.now(TZ)
    if now is None:
        fail("--now is not a valid datetime")
    if args.notion_manifest:
        validate_snapshot_manifest(args.notion_manifest, args.notion, "notion_tasks", fallback_key="notion")
    if args.freebusy_manifest:
        validate_snapshot_manifest(args.freebusy_manifest, args.freebusy, "google_freebusy")
    tasks = extract_tasks(load_json(args.notion))
    busy = extract_busy(load_json(args.freebusy))
    result = plan(tasks, busy, now, 7)
    while not result.get("ok") and result.get("needs_horizon_extension"):
        result = plan(tasks, busy, now, int(result["horizon_days"]) + 7)
    if not result.get("ok"):
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        args.out_json.write_text(json.dumps(result, indent=2, ensure_ascii=False))
        fail(str(result.get("failure", "planning validation failed")))
    write_csv(args.out_csv, result)
    if args.out_writes:
        write_payloads(args.out_writes, result)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps({"ok": True, "moves": len(result.get("moves", [])), "horizon_days": result["horizon_days"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
