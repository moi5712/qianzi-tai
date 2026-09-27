# -*- coding: utf-8 -*-
"""頁面列表、檔名與縮圖。"""
from __future__ import annotations

from pathlib import Path

import workspace as ws
from io_util import safe_name

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def list_pages() -> list[str]:
    if ws.PAGES_DIR is None or not ws.PAGES_DIR.is_dir():
        return []
    files = [
        p.name
        for p in ws.PAGES_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    ]
    return sorted(files)


def pages_payload() -> dict:
    pages = []
    for name in list_pages():
        src = ws.PAGES_DIR / name
        stamp = 0
        size = 0
        if src.exists():
            stat = src.stat()
            stamp = int(stat.st_mtime)
            size = stat.st_size
        erase_name = Path(name).stem + ".png"
        erase_path = (ws.ERASE_DIR / erase_name) if ws.ERASE_DIR is not None else None
        erase = ""
        if erase_path is not None and erase_path.is_file():
            erase = "/api/erase/" + erase_name + "?v=" + str(int(erase_path.stat().st_mtime))
        pages.append(
            {
                "name": name,
                "url": "/media/" + name + "?v=" + str(stamp),
                "thumb": "/thumbs/" + Path(name).stem + ".jpg?v=" + str(stamp),
                "erase": erase,
                "size": size,
            }
        )
    return {"pages": pages, "folder": str(ws.PAGES_DIR) if ws.PAGES_DIR else ""}


def page_name_for_stem(stem: str) -> str:
    if not stem or ws.PAGES_DIR is None or not ws.PAGES_DIR.is_dir():
        return ""
    for ext in sorted(IMAGE_EXTS):
        name = f"{stem}{ext}"
        if (ws.PAGES_DIR / name).is_file():
            return name
    return ""


def unique_page_name(filename: str) -> str:
    name = safe_name(filename)
    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTS:
        raise ValueError("只接受 PNG、JPG、WEBP")
    stem = Path(name).stem.strip() or "page"
    dest = ws.PAGES_DIR / f"{stem}{suffix}"
    n = 2
    while dest.exists():
        dest = ws.PAGES_DIR / f"{stem}-{n}{suffix}"
        n += 1
    return dest.name


def build_thumb_for(name: str) -> None:
    try:
        from PIL import Image
    except ImportError:
        return
    if ws.PAGES_DIR is None or ws.THUMB_DIR is None:
        return
    src = ws.PAGES_DIR / name
    if not src.is_file():
        return
    dest = ws.THUMB_DIR / (Path(name).stem + ".jpg")
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return
    ws.THUMB_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((200, 320))
            tmp = dest.with_suffix(".tmp.jpg")
            im.save(tmp, "JPEG", quality=72)
            tmp.replace(dest)
    except OSError:
        if dest.with_suffix(".tmp.jpg").exists():
            dest.with_suffix(".tmp.jpg").unlink(missing_ok=True)
