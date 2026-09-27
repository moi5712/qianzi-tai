# -*- coding: utf-8 -*-
"""專案工作區：路徑、最近開啟、開啟／新建資料夾。"""
from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

from font_store import FONTS_DIR
from io_util import read_json, write_json_atomic

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
DEFAULT_PROJECT_DIR = ROOT.parent / "合併圖片"

PAGES_DIR: Path | None = None
ERASE_DIR: Path | None = None
EXPORT_DIR: Path | None = None
THUMB_DIR: Path | None = None
PROJECT_PATH: Path | None = None

_ws_lock = threading.Lock()
_ws_current: dict = {}
_ws_recents: list[dict] = []


def empty_workspace() -> dict:
    return {
        "id": "",
        "name": "未開啟專案",
        "pagesDir": "",
        "projectPath": "",
        "eraseDir": "",
        "thumbDir": "",
        "exportDir": "",
    }


def standard_workspace(folder: Path) -> dict:
    folder = folder.resolve()
    lettering = folder / ".lettering"
    return {
        "id": str(folder),
        "name": folder.name or "專案",
        "pagesDir": str(folder),
        "projectPath": str(lettering / "project.json"),
        "eraseDir": str(lettering / "erase"),
        "thumbDir": str(lettering / "thumbs"),
        "exportDir": str(folder / "匯出"),
    }


def is_tool_folder(folder: Path) -> bool:
    try:
        folder.resolve().relative_to(ROOT)
    except (OSError, ValueError):
        return False
    return True


def default_project_dir() -> Path | None:
    folder = DEFAULT_PROJECT_DIR
    if folder.is_dir() and not is_tool_folder(folder):
        return folder
    return None


def project_file_has_content(path: Path) -> bool:
    data = read_json(path, {})
    if not isinstance(data, dict):
        return False
    pages = data.get("pages")
    if isinstance(pages, dict) and pages:
        return True
    dialogue = data.get("dialogue")
    return isinstance(dialogue, list) and bool(dialogue)


def _absorb_file(src: Path, dest: Path) -> None:
    import shutil

    if not src.is_file():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or (project_file_has_content(src) and not project_file_has_content(dest)):
        if dest.exists():
            dest.unlink()
        shutil.move(str(src), str(dest))
        return
    src.unlink(missing_ok=True)


def _absorb_dir(src: Path, dest: Path) -> None:
    import shutil

    if not src.is_dir():
        return
    dest.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dest / item.name
        if target.exists():
            if item.is_file():
                item.unlink()
            continue
        shutil.move(str(item), str(target))
    try:
        src.rmdir()
    except OSError:
        pass


def migrate_legacy_app_data() -> Path | None:
    """舊版把專案檔寫在工具 data/，改放到漫畫資料夾的 .lettering/。"""
    src_project = DATA_DIR / "project.json"
    src_erase = DATA_DIR / "erase"
    src_thumbs = DATA_DIR / "thumbs"
    has_legacy = (
        project_file_has_content(src_project)
        or (src_erase.is_dir() and any(src_erase.iterdir()))
        or (src_thumbs.is_dir() and any(src_thumbs.iterdir()))
    )
    folder = default_project_dir()
    if has_legacy:
        if folder is None:
            folder = DEFAULT_PROJECT_DIR
            folder.mkdir(parents=True, exist_ok=True)
        item = standard_workspace(folder)
        _absorb_file(src_project, Path(item["projectPath"]))
        _absorb_dir(src_erase, Path(item["eraseDir"]))
        _absorb_dir(src_thumbs, Path(item["thumbDir"]))
    else:
        if src_project.is_file() and not project_file_has_content(src_project):
            src_project.unlink(missing_ok=True)
        for leftover in (src_erase, src_thumbs):
            if leftover.is_dir() and not any(leftover.iterdir()):
                try:
                    leftover.rmdir()
                except OSError:
                    pass
    return folder


def apply_workspace(item: dict) -> None:
    global PAGES_DIR, PROJECT_PATH, ERASE_DIR, THUMB_DIR, EXPORT_DIR
    if not item.get("id") or not item.get("pagesDir"):
        with _ws_lock:
            PAGES_DIR = None
            PROJECT_PATH = None
            ERASE_DIR = None
            THUMB_DIR = None
            EXPORT_DIR = None
            _ws_current.clear()
            _ws_current.update(empty_workspace())
        return
    pages = Path(item["pagesDir"])
    project = Path(item["projectPath"])
    erase = Path(item["eraseDir"])
    thumbs = Path(item["thumbDir"])
    export = Path(item["exportDir"])
    for d in (erase, thumbs, export, project.parent):
        d.mkdir(parents=True, exist_ok=True)
    if not project.exists():
        project.write_text("{}", encoding="utf-8")
    with _ws_lock:
        PAGES_DIR = pages
        PROJECT_PATH = project
        ERASE_DIR = erase
        THUMB_DIR = thumbs
        EXPORT_DIR = export
        _ws_current.clear()
        _ws_current.update(item)


def public_workspace_item(item: dict) -> dict:
    return {
        "id": item.get("id") or "",
        "name": item.get("name") or "未開啟專案",
        "folder": item.get("pagesDir") or "",
        "exportFolder": item.get("exportDir") or "",
    }


def workspace_payload() -> dict:
    with _ws_lock:
        current = dict(_ws_current)
        recents = [dict(r) for r in _ws_recents]
    data = public_workspace_item(current)
    data["ok"] = True
    data["recents"] = [public_workspace_item(r) for r in recents]
    return data


def persist_workspace(item: dict) -> None:
    global _ws_recents
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _ws_lock:
        if item.get("id"):
            recents = [r for r in _ws_recents if r.get("id") != item.get("id")]
            recents.insert(0, item)
            _ws_recents = recents[:12]
        payload = {"currentId": item.get("id") or "", "recents": _ws_recents}
    write_json_atomic(WORKSPACE_PATH, payload)


def activate_workspace(item: dict) -> dict:
    apply_workspace(item)
    persist_workspace(item)
    return workspace_payload()


def prepare_standard_folder(folder: Path) -> dict:
    folder = folder.resolve()
    if not folder.is_dir():
        raise ValueError("請選擇資料夾")
    if is_tool_folder(folder):
        raise ValueError("這是嵌字工具程式目錄，請另選漫畫專案資料夾")
    item = standard_workspace(folder)
    lettering = Path(item["eraseDir"]).parent
    lettering.mkdir(parents=True, exist_ok=True)
    Path(item["eraseDir"]).mkdir(parents=True, exist_ok=True)
    Path(item["thumbDir"]).mkdir(parents=True, exist_ok=True)
    Path(item["exportDir"]).mkdir(parents=True, exist_ok=True)
    project = Path(item["projectPath"])
    if not project.exists():
        project.write_text("{}", encoding="utf-8")
    return item


def pick_directory(title: str) -> Path | None:
    code = (
        "import sys,tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root=tk.Tk();root.withdraw();root.attributes('-topmost',True)\n"
        "p=filedialog.askdirectory(title=sys.argv[1],mustexist=True)\n"
        "sys.stdout.buffer.write((p or '').encode('utf-8'))\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", code, title],
            capture_output=True,
            timeout=600,
            cwd=str(ROOT),
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        raise ValueError("無法開啟資料夾視窗：" + str(err)) from err
    path = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
    return Path(path) if path else None


def load_workspace() -> None:
    global _ws_recents
    fallback = migrate_legacy_app_data()
    data = read_json(WORKSPACE_PATH, {})
    recents = data.get("recents") if isinstance(data.get("recents"), list) else []
    cleaned: list[dict] = []
    seen: set[str] = set()
    for raw in recents:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        if raw.get("legacy") or raw.get("id") == "legacy":
            folder = fallback
        else:
            folder = Path(str(raw.get("pagesDir") or raw.get("id") or ""))
        if folder is None or not folder.is_dir() or is_tool_folder(folder):
            continue
        item = standard_workspace(folder)
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        cleaned.append(item)
    current_id = str(data.get("currentId") or "")
    if current_id in {"", "legacy"} and fallback is not None:
        current_id = str(fallback.resolve())
    item = next((r for r in cleaned if r.get("id") == current_id), None)
    if item is None and fallback is not None:
        item = standard_workspace(fallback)
    if item is None:
        item = empty_workspace()
    if item.get("id") and item["id"] not in seen:
        cleaned.insert(0, item)
    _ws_recents = cleaned[:12]
    apply_workspace(item)
    persist_workspace(item)


def ensure_dirs() -> None:
    for d in (DATA_DIR, FONTS_DIR, STATIC_DIR):
        d.mkdir(parents=True, exist_ok=True)
