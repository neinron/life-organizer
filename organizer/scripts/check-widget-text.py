#!/usr/bin/env python3
"""Check editorial display fields; never rewrite content, links, dates or IDs."""
import argparse
import json
import re
from pathlib import Path

LETTER = r"[^\W\d_]"
UNIT = r"(?:Minuten?|Stunden?|Tage?|Uhr|Min)\b"
DAY = r"(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)"
MONTH = r"(?:Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)"
PATTERNS = [
    re.compile(rf"{LETTER}\d{{1,2}}:\d{{2}}"),
    re.compile(rf"\d:\d{{2}}{LETTER}"),
    re.compile(rf"{LETTER}\d{{1,2}}[–-]\d{{1,2}}\b"),
    re.compile(rf"\d{UNIT}"),
    re.compile(rf"{LETTER}\d+(?:[-–]\d+)?(?:[-–])?{UNIT}"),
    re.compile(rf"{LETTER}\d{{1,2}}{MONTH}\b|\d{MONTH}\b"),
    re.compile(rf"{LETTER}{DAY}(?=\b|\d)"),
    re.compile(rf"(?<!\d)\.\d+(?:{UNIT})"),
    re.compile(r"[:;](?=\d{1,2}:\d{2})"),
    re.compile(rf"[;](?=\d+{UNIT})"),
]


def issues(board):
    """Return field locations with likely missing spaces, without changing text."""
    found = []
    for si, section in enumerate(board.get("sections", [])):
        fields = [(f"sections[{si}].title", section.get("title", ""))]
        for ii, item in enumerate(section.get("items", [])):
            fields.extend((f"sections[{si}].items[{ii}].{key}", item.get(key, ""))
                          for key in ("label", "text", "mobile_label", "mobile_text"))
        for path, value in fields:
            if isinstance(value, str) and any(pattern.search(value) for pattern in PATTERNS):
                found.append(path)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1] / "runtime/state/widget-board.json")
    args = parser.parse_args()
    found = issues(json.loads(args.board.read_text()))
    print(json.dumps({"ok": not found, "review_fields": found}, ensure_ascii=False))
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
