# -*- coding: utf-8 -*-
"""內建／使用者字體目錄與公開清單。"""
from __future__ import annotations

from pathlib import Path

from io_util import read_json, safe_name, write_json_atomic

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
FONTS_DIR = DATA_DIR / "fonts"
FONTS_META_PATH = DATA_DIR / "fonts.json"
BUNDLED_FONTS_DIR = ROOT / "static" / "bundled-fonts"
BUILTIN_META_PATH = ROOT / "builtin_fonts.json"
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}

_builtin_fonts_cache: list[dict] | None = None
_font_catalog_cache: list[dict] | None = None


def public_font_item(item: dict) -> dict:
    file = str(item.get("file") or "")
    family = str(item.get("family") or Path(file).stem)
    label = str(item.get("label") or family).strip() or family
    builtin = bool(item.get("builtin"))
    weight = item.get("weight")
    try:
        weight = int(weight) if weight not in (None, "") else 400
    except (TypeError, ValueError):
        weight = 400
    root = BUNDLED_FONTS_DIR if builtin else FONTS_DIR
    path = root / file
    url = ("/static/bundled-fonts/" if builtin else "/fonts/") + file
    if path.is_file():
        url += f"?v={int(path.stat().st_mtime)}"
    return {
        "file": file,
        "family": family,
        "label": label,
        "weight": weight,
        "weightLabel": str(item.get("weightLabel") or ""),
        "builtin": builtin,
        "url": url,
    }


def catalog_record(item: dict) -> dict:
    file = str(item.get("file") or "")
    family = str(item.get("family") or Path(file).stem)
    label = str(item.get("label") or family).strip() or family
    return {"file": file, "family": family, "label": label}


def unique_font_name(filename: str) -> str:
    name = safe_name(filename)
    suffix = Path(name).suffix.lower()
    if suffix not in FONT_EXTS:
        raise ValueError("只接受 TTF、OTF、WOFF")
    stem = Path(name).stem.strip() or "font"
    dest = FONTS_DIR / f"{stem}{suffix}"
    n = 2
    while dest.exists():
        dest = FONTS_DIR / f"{stem}-{n}{suffix}"
        n += 1
    return dest.name


def load_builtin_fonts() -> list[dict]:
    global _builtin_fonts_cache
    if _builtin_fonts_cache is not None:
        return _builtin_fonts_cache
    data = read_json(BUILTIN_META_PATH, {})
    raw = data.get("fonts") if isinstance(data, dict) else []
    items: list[dict] = []
    if not isinstance(raw, list):
        _builtin_fonts_cache = items
        return items
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            file = safe_name(str(row.get("file") or ""))
        except ValueError:
            continue
        if not (BUNDLED_FONTS_DIR / file).is_file():
            continue
        item = dict(row)
        item["file"] = file
        item["builtin"] = True
        items.append(public_font_item(item))
    _builtin_fonts_cache = items
    return items


def builtin_font_files() -> set[str]:
    return {item["file"] for item in load_builtin_fonts()}


def save_font_catalog(items: list[dict]) -> None:
    write_json_atomic(FONTS_META_PATH, {"fonts": [catalog_record(item) for item in items]})


def invalidate_font_catalog() -> None:
    global _font_catalog_cache
    _font_catalog_cache = None


def load_font_catalog() -> list[dict]:
    global _font_catalog_cache
    if _font_catalog_cache is not None:
        return _font_catalog_cache
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    locked = builtin_font_files()
    data = read_json(FONTS_META_PATH, {})
    raw = data.get("fonts") if isinstance(data, dict) else []
    items: list[dict] = []
    seen: set[str] = set()
    if isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            try:
                file = safe_name(str(row.get("file") or ""))
            except ValueError:
                continue
            if file in seen or file in locked or not (FONTS_DIR / file).is_file():
                continue
            if Path(file).suffix.lower() not in FONT_EXTS:
                continue
            family = str(row.get("family") or Path(file).stem).strip() or Path(file).stem
            label = str(row.get("label") or family).strip() or family
            items.append({"file": file, "family": family, "label": label})
            seen.add(file)
    for path in sorted(FONTS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not path.is_file() or path.suffix.lower() not in FONT_EXTS or path.name in seen or path.name in locked:
            continue
        family = path.stem
        items.append({"file": path.name, "family": family, "label": family})
        seen.add(path.name)
    old_keys = []
    if isinstance(raw, list):
        old_keys = [
            (str(row.get("file") or ""), str(row.get("label") or ""), str(row.get("family") or ""))
            for row in raw
            if isinstance(row, dict)
        ]
    new_keys = [(item["file"], item.get("label") or "", item.get("family") or "") for item in items]
    if old_keys != new_keys:
        save_font_catalog(items)
    _font_catalog_cache = [public_font_item(item) for item in items]
    return _font_catalog_cache


def fonts_payload() -> dict:
    return {"ok": True, "fonts": load_builtin_fonts() + load_font_catalog()}
