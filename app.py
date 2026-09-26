# -*- coding: utf-8 -*-
"""本地漫畫嵌字台：瀏覽器介面 + 靜態檔 / 專案存檔。"""
from __future__ import annotations

import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from auto_letter import recognize_page, translate_items
from probe import test_connection, test_ocr
from settings import load_settings, merge_request_settings, public_settings, save_settings

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
FONTS_DIR = DATA_DIR / "fonts"
FONTS_META_PATH = DATA_DIR / "fonts.json"
BUNDLED_FONTS_DIR = STATIC_DIR / "bundled-fonts"
BUILTIN_META_PATH = ROOT / "builtin_fonts.json"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
DEFAULT_PROJECT_DIR = ROOT.parent / "合併圖片"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}
HOST = "127.0.0.1"
PORT = 8765
CACHE_NONE = "no-cache"
CACHE_DAY = "public, max-age=86400"
CACHE_HOUR = "public, max-age=3600"
CACHE_YEAR = "public, max-age=31536000, immutable"

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
    WORKSPACE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def activate_workspace(item: dict) -> dict:
    apply_workspace(item)
    persist_workspace(item)
    build_thumbs()
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


def list_pages() -> list[str]:
    if PAGES_DIR is None or not PAGES_DIR.is_dir():
        return []
    files = [
        p.name
        for p in PAGES_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    ]
    return sorted(files)


def pages_payload() -> dict:
    pages = []
    for name in list_pages():
        src = PAGES_DIR / name
        stamp = 0
        size = 0
        if src.exists():
            stat = src.stat()
            stamp = int(stat.st_mtime)
            size = stat.st_size
        erase_name = Path(name).stem + ".png"
        erase_path = (ERASE_DIR / erase_name) if ERASE_DIR is not None else None
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
    return {"pages": pages, "folder": str(PAGES_DIR) if PAGES_DIR else ""}


def page_name_for_stem(stem: str) -> str:
    if not stem or PAGES_DIR is None or not PAGES_DIR.is_dir():
        return ""
    for ext in sorted(IMAGE_EXTS):
        name = f"{stem}{ext}"
        if (PAGES_DIR / name).is_file():
            return name
    return ""


def unique_page_name(filename: str) -> str:
    name = safe_name(filename)
    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTS:
        raise ValueError("只接受 PNG、JPG、WEBP")
    stem = Path(name).stem.strip() or "page"
    dest = PAGES_DIR / f"{stem}{suffix}"
    n = 2
    while dest.exists():
        dest = PAGES_DIR / f"{stem}-{n}{suffix}"
        n += 1
    return dest.name


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


_builtin_fonts_cache: list[dict] | None = None
_font_catalog_cache: list[dict] | None = None


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
    payload = {"fonts": [public_font_item(item) for item in items]}
    FONTS_META_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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


def build_thumb_for(name: str) -> None:
    try:
        from PIL import Image
    except ImportError:
        return
    if PAGES_DIR is None or THUMB_DIR is None:
        return
    src = PAGES_DIR / name
    if not src.is_file():
        return
    dest = THUMB_DIR / (Path(name).stem + ".jpg")
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
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


def build_thumbs() -> None:
    for name in list_pages():
        build_thumb_for(name)


def safe_name(name: str) -> str:
    name = Path(unquote(name)).name
    if not name or name in {".", ".."}:
        raise ValueError("bad name")
    return name


def safe_rel(name: str) -> Path:
    rel = Path(unquote(name))
    if rel.is_absolute() or ".." in rel.parts or not rel.parts:
        raise ValueError("bad name")
    return rel


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


class Handler(BaseHTTPRequestHandler):
    server_version = "LetteringDesk/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: bytes, mime: str, extra: dict | None = None, cache: str = CACHE_NONE) -> None:
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, path: Path, mime: str | None = None, cache: str = CACHE_NONE) -> None:
        if not path.is_file():
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        data = path.read_bytes()
        if path.suffix.lower() == ".js":
            mime = mime or "text/javascript; charset=utf-8"
        mime = mime or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        extra = {}
        if path.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}:
            extra["Access-Control-Allow-Origin"] = "*"
        self._send(200, data, mime, extra, cache=cache)

    def _read_body(self, limit: int = 80_000_000) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            self._send(413, b"too large", "text/plain; charset=utf-8")
            return b""
        return self.rfile.read(n) if n else b""

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _parse_json(self, raw: bytes):
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "JSON 無法解析"})
            return None
        return data if isinstance(data, dict) else {}

    def _need_project(self) -> bool:
        if PAGES_DIR is None or PROJECT_PATH is None or ERASE_DIR is None or THUMB_DIR is None or EXPORT_DIR is None:
            self._json(400, {"ok": False, "error": "請先開啟或新建專案"})
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path in ("/", "/index.html"):
            self._send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path in ("/文案.json", "/copy.json"):
            self._send_file(ROOT / "文案.json", "application/json; charset=utf-8")
            return
        if path.startswith("/static/"):
            try:
                rel = safe_rel(path[len("/static/") :])
            except ValueError:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            cache = CACHE_NONE if rel.suffix.lower() in {".js", ".css", ".html"} else CACHE_HOUR
            self._send_file(STATIC_DIR / rel, cache=cache)
            return
        if path.startswith("/media/"):
            if PAGES_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            self._send_file(PAGES_DIR / safe_name(path[len("/media/") :]), cache=CACHE_DAY)
            return
        if path.startswith("/thumbs/"):
            if THUMB_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            name = safe_name(path[len("/thumbs/") :])
            thumb = THUMB_DIR / name
            if not thumb.exists():
                page = page_name_for_stem(Path(name).stem)
                if page:
                    build_thumb_for(page)
            self._send_file(thumb, "image/jpeg", cache=CACHE_DAY)
            return
        if path.startswith("/fonts/"):
            self._send_file(FONTS_DIR / safe_name(path[len("/fonts/") :]), cache=CACHE_YEAR)
            return
        if path == "/api/workspace":
            self._json(200, workspace_payload())
            return
        if path == "/api/pages":
            self._json(200, pages_payload())
            return
        if path == "/api/fonts":
            self._json(200, fonts_payload())
            return
        if path == "/api/project":
            project = read_json(PROJECT_PATH, {}) if PROJECT_PATH is not None else {}
            fonts = load_builtin_fonts() + load_font_catalog()
            project["fonts"] = fonts
            project["importedFonts"] = [item["file"] for item in fonts if not item.get("builtin")]
            body = json.dumps(project, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return
        if path == "/api/settings":
            settings = public_settings(load_settings(DATA_DIR))
            self._json(200, {"ok": True, "settings": settings})
            return
        if path.startswith("/api/erase/"):
            if ERASE_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            name = safe_name(path[len("/api/erase/") :])
            self._send_file(ERASE_DIR / name, "image/png")
            return
        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        body = self._read_body()
        if self.headers.get("Content-Length") and not body and int(self.headers.get("Content-Length") or 0) > 0:
            return

        if path in ("/api/workspace/open", "/api/workspace/new"):
            title = "選擇專案資料夾" if path.endswith("/open") else "選擇新專案資料夾"
            try:
                folder = pick_directory(title)
            except ValueError as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            if folder is None:
                self._json(200, {"ok": False, "cancelled": True})
                return
            try:
                item = prepare_standard_folder(folder)
            except ValueError as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            self._json(200, activate_workspace(item))
            return
        if path == "/api/project":
            if not self._need_project():
                return
            PROJECT_PATH.write_bytes(body)
            self._send(200, b'{"ok":true}', "application/json; charset=utf-8")
            return
        if path.startswith("/api/erase/"):
            if not self._need_project():
                return
            name = Path(safe_name(path[len("/api/erase/") :])).stem + ".png"
            (ERASE_DIR / name).write_bytes(body)
            self._send(200, b'{"ok":true}', "application/json; charset=utf-8")
            return
        if path.startswith("/api/export/"):
            if not self._need_project():
                return
            name = Path(safe_name(path[len("/api/export/") :])).stem + ".png"
            (EXPORT_DIR / name).write_bytes(body)
            self._send(200, json.dumps({"ok": True, "path": str(EXPORT_DIR / name)}, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
            return
        if path == "/api/fonts/label":
            data = self._parse_json(body)
            if data is None:
                return
            try:
                filename = safe_name(str(data.get("file") or ""))
            except ValueError:
                self._json(400, {"ok": False, "error": "檔名無效"})
                return
            label = str(data.get("label") or "").strip()
            if not label:
                self._json(400, {"ok": False, "error": "請輸入字體名稱"})
                return
            if filename in builtin_font_files():
                self._json(400, {"ok": False, "error": "內建字體不能改名"})
                return
            fonts = load_font_catalog()
            item = next((row for row in fonts if row["file"] == filename), None)
            if item is None:
                self._json(404, {"ok": False, "error": "找不到字體"})
                return
            item["label"] = label[:40]
            save_font_catalog(fonts)
            self._json(200, {"ok": True, "font": item, **fonts_payload()})
            return
        if path == "/api/fonts":
            if not body:
                self._json(400, {"ok": False, "error": "沒有檔案"})
                return
            try:
                filename = unique_font_name(self.headers.get("X-Filename") or "font.ttf")
            except ValueError as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            FONTS_DIR.mkdir(parents=True, exist_ok=True)
            (FONTS_DIR / filename).write_bytes(body)
            invalidate_font_catalog()
            catalog = load_font_catalog()
            item = next((row for row in catalog if row["file"] == filename), None)
            if item is None:
                item = public_font_item({"file": filename, "family": Path(filename).stem, "label": Path(filename).stem})
                catalog.append(item)
                save_font_catalog(catalog)
            payload = fonts_payload()
            payload.update({"ok": True, "name": filename, "font": item})
            self._json(200, payload)
            return
        if path == "/api/pages":
            if not self._need_project():
                return
            if not body:
                self._json(400, {"ok": False, "error": "沒有檔案"})
                return
            try:
                filename = unique_page_name(self.headers.get("X-Filename") or "page.png")
            except ValueError as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            PAGES_DIR.mkdir(parents=True, exist_ok=True)
            (PAGES_DIR / filename).write_bytes(body)
            build_thumb_for(filename)
            payload = pages_payload()
            payload.update({"ok": True, "name": filename})
            self._json(200, payload)
            return
        if path == "/api/settings":
            data = self._parse_json(body)
            if data is None:
                return
            settings = save_settings(DATA_DIR, data.get("settings") if isinstance(data.get("settings"), dict) else data)
            self._json(200, {"ok": True, "settings": public_settings(settings)})
            return
        if path == "/api/auto/test":
            data = self._parse_json(body)
            if data is None:
                return
            settings = merge_request_settings(
                load_settings(DATA_DIR),
                data.get("settings") if isinstance(data.get("settings"), dict) else data,
            )
            result = test_connection(settings)
            self._json(200, {"ok": bool(result.get("ok")), "code": result.get("code") or ("connected" if result.get("ok") else "unknown")})
            return
        if path == "/api/auto/test-vision":
            data = self._parse_json(body)
            if data is None:
                return
            settings = merge_request_settings(
                load_settings(DATA_DIR),
                data.get("settings") if isinstance(data.get("settings"), dict) else data,
            )
            result = test_ocr(settings)
            self._json(200, {
                "ok": bool(result.get("ok")),
                "code": result.get("code") or ("vision_ok" if result.get("ok") else "unknown"),
            })
            return
        if path == "/api/auto/recognize":
            data = self._parse_json(body)
            if data is None:
                return
            if not self._need_project():
                return
            try:
                page_name = safe_name(str(data.get("pageName") or ""))
            except ValueError:
                self._json(400, {"ok": False, "error": "請指定頁面"})
                return
            page_path = PAGES_DIR / page_name
            settings = load_settings(DATA_DIR)
            include_sfx = data.get("includeSfx")
            try:
                result = recognize_page(
                    page_path,
                    settings,
                    include_sfx=None if include_sfx is None else bool(include_sfx),
                )
            except Exception as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            self._json(200, {"ok": True, **result})
            return
        if path == "/api/auto/translate":
            data = self._parse_json(body)
            if data is None:
                return
            settings = load_settings(DATA_DIR)
            items = data.get("items") if isinstance(data.get("items"), list) else []
            try:
                translated = translate_items(
                    items,
                    settings,
                    do_break=bool(data.get("doBreak", settings.get("doBreak", True))),
                    strict_punct=True,
                    glossary=data.get("glossary") if isinstance(data.get("glossary"), list) else [],
                    memory=data.get("memory") if isinstance(data.get("memory"), list) else [],
                )
            except Exception as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            self._json(200, {"ok": True, "items": translated})
            return
        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/erase/"):
            if not self._need_project():
                return
            try:
                name = Path(safe_name(path[len("/api/erase/") :])).stem + ".png"
            except ValueError:
                self._json(400, {"ok": False, "error": "檔名無效"})
                return
            target = ERASE_DIR / name
            if target.exists():
                target.unlink()
            self._json(200, {"ok": True})
            return
        if path.startswith("/api/fonts/"):
            try:
                name = safe_name(path[len("/api/fonts/") :])
            except ValueError:
                self._json(400, {"ok": False, "error": "檔名無效"})
                return
            if Path(name).suffix.lower() not in FONT_EXTS:
                self._json(400, {"ok": False, "error": "不是字體檔"})
                return
            if name in builtin_font_files():
                self._json(400, {"ok": False, "error": "內建字體不能刪除"})
                return
            target = FONTS_DIR / name
            if target.is_file():
                target.unlink()
            invalidate_font_catalog()
            payload = fonts_payload()
            payload.update({"ok": True, "name": name})
            self._json(200, payload)
            return
        if path.startswith("/api/pages/"):
            if not self._need_project():
                return
            try:
                name = safe_name(path[len("/api/pages/") :])
            except ValueError:
                self._json(400, {"ok": False, "error": "檔名無效"})
                return
            if Path(name).suffix.lower() not in IMAGE_EXTS:
                self._json(400, {"ok": False, "error": "不是圖片"})
                return
            src = PAGES_DIR / name
            if src.is_file():
                src.unlink()
            thumb = THUMB_DIR / (Path(name).stem + ".jpg")
            if thumb.is_file():
                thumb.unlink()
            erase = ERASE_DIR / (Path(name).stem + ".png")
            if erase.is_file():
                erase.unlink()
            payload = pages_payload()
            payload.update({"ok": True, "name": name})
            self._json(200, payload)
            return
        self._send(404, b"not found", "text/plain; charset=utf-8")


def main() -> None:
    ensure_dirs()
    load_workspace()
    if PAGES_DIR is None:
        print("尚未開啟專案。請在瀏覽器按「新建」或「開啟」。")
    elif not PAGES_DIR.is_dir():
        print("找不到圖片資料夾：", PAGES_DIR)
    build_thumbs()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print("嵌字台已啟動：", url)
    print("專案：", _ws_current.get("name") or "未開啟專案")
    print("圖片資料夾：", PAGES_DIR or "（無）")
    print("匯出資料夾：", EXPORT_DIR or "（無）")
    print("關閉此視窗即可結束。")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已關閉")
        server.server_close()


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
