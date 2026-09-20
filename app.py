# -*- coding: utf-8 -*-
"""本地漫畫嵌字台：瀏覽器介面 + 靜態檔 / 專案存檔。"""
from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from auto_letter import recognize_page, translate_items
from probe import test_connection, test_vision
from settings import load_settings, merge_request_settings, public_settings, save_settings

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
FONTS_DIR = DATA_DIR / "fonts"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
LEGACY_PAGES = ROOT.parent / "合併圖片"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
HOST = "127.0.0.1"
PORT = 8765
CACHE_NONE = "no-cache"
CACHE_DAY = "public, max-age=86400"
CACHE_HOUR = "public, max-age=3600"
CACHE_YEAR = "public, max-age=31536000, immutable"

PAGES_DIR = LEGACY_PAGES
ERASE_DIR = DATA_DIR / "erase"
EXPORT_DIR = LEGACY_PAGES / "匯出"
THUMB_DIR = DATA_DIR / "thumbs"
PROJECT_PATH = DATA_DIR / "project.json"

_ws_lock = threading.Lock()
_ws_current: dict = {}
_ws_recents: list[dict] = []


def legacy_workspace() -> dict:
    return {
        "id": "legacy",
        "name": "預設",
        "pagesDir": str(LEGACY_PAGES),
        "projectPath": str(DATA_DIR / "project.json"),
        "eraseDir": str(DATA_DIR / "erase"),
        "thumbDir": str(DATA_DIR / "thumbs"),
        "exportDir": str(LEGACY_PAGES / "匯出"),
        "legacy": True,
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
        "legacy": False,
    }


def _same_path(a: Path, b: Path) -> bool:
    try:
        return a.resolve() == b.resolve()
    except OSError:
        return False


def apply_workspace(item: dict) -> None:
    global PAGES_DIR, PROJECT_PATH, ERASE_DIR, THUMB_DIR, EXPORT_DIR
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
        "name": item.get("name") or "專案",
        "folder": item.get("pagesDir") or "",
        "exportFolder": item.get("exportDir") or "",
        "legacy": bool(item.get("legacy")),
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
    with _ws_lock:
        recents = [r for r in _ws_recents if r.get("id") != item.get("id")]
        recents.insert(0, item)
        _ws_recents = recents[:12]
        payload = {"currentId": item.get("id"), "recents": _ws_recents}
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
    if _same_path(folder, LEGACY_PAGES):
        return legacy_workspace()
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
    data = read_json(WORKSPACE_PATH, {})
    recents = data.get("recents") if isinstance(data.get("recents"), list) else []
    cleaned: list[dict] = []
    for raw in recents:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        if raw.get("legacy") or raw.get("id") == "legacy":
            cleaned.append(legacy_workspace())
            continue
        folder = Path(str(raw.get("pagesDir") or raw.get("id") or ""))
        if folder.is_dir():
            cleaned.append(standard_workspace(folder))
    current_id = str(data.get("currentId") or "legacy")
    item = next((r for r in cleaned if r.get("id") == current_id), None)
    if item is None:
        item = legacy_workspace()
    if not any(r.get("id") == item.get("id") for r in cleaned):
        cleaned.insert(0, item)
    _ws_recents = cleaned[:12]
    apply_workspace(item)
    persist_workspace(item)


def ensure_dirs() -> None:
    for d in (DATA_DIR, FONTS_DIR, STATIC_DIR, DATA_DIR / "erase", DATA_DIR / "thumbs"):
        d.mkdir(parents=True, exist_ok=True)


def list_pages() -> list[str]:
    if not PAGES_DIR.is_dir():
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
        pages.append(
            {
                "name": name,
                "url": "/media/" + name + "?v=" + str(stamp),
                "thumb": "/thumbs/" + Path(name).stem + ".jpg?v=" + str(stamp),
                "size": size,
            }
        )
    return {"pages": pages, "folder": str(PAGES_DIR)}


def page_name_for_stem(stem: str) -> str:
    if not stem or not PAGES_DIR.is_dir():
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


def build_thumb_for(name: str) -> None:
    try:
        from PIL import Image
    except ImportError:
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
            self._send_file(PAGES_DIR / safe_name(path[len("/media/") :]), cache=CACHE_DAY)
            return
        if path.startswith("/thumbs/"):
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
        if path == "/api/project":
            project = read_json(PROJECT_PATH, {})
            fonts = [p.name for p in FONTS_DIR.iterdir() if p.is_file()]
            project["importedFonts"] = fonts
            body = json.dumps(project, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return
        if path == "/api/settings":
            settings = public_settings(load_settings(DATA_DIR))
            self._json(200, {"ok": True, "settings": settings})
            return
        if path.startswith("/api/erase/"):
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
            PROJECT_PATH.write_bytes(body)
            self._send(200, b'{"ok":true}', "application/json; charset=utf-8")
            return
        if path.startswith("/api/erase/"):
            name = Path(safe_name(path[len("/api/erase/") :])).stem + ".png"
            (ERASE_DIR / name).write_bytes(body)
            self._send(200, b'{"ok":true}', "application/json; charset=utf-8")
            return
        if path.startswith("/api/export/"):
            name = Path(safe_name(path[len("/api/export/") :])).stem + ".png"
            (EXPORT_DIR / name).write_bytes(body)
            self._send(200, json.dumps({"ok": True, "path": str(EXPORT_DIR / name)}, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
            return
        if path == "/api/fonts":
            filename = safe_name(self.headers.get("X-Filename") or "font.ttf")
            dest = FONTS_DIR / filename
            dest.write_bytes(body)
            payload = json.dumps({"ok": True, "name": filename, "url": "/fonts/" + filename}, ensure_ascii=False).encode("utf-8")
            self._send(200, payload, "application/json; charset=utf-8")
            return
        if path == "/api/pages":
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
            result = test_vision(settings)
            self._json(200, {
                "ok": bool(result.get("ok")),
                "code": result.get("code") or ("vision_ok" if result.get("ok") else "unknown"),
            })
            return
        if path == "/api/auto/recognize":
            data = self._parse_json(body)
            if data is None:
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
        if path.startswith("/api/pages/"):
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
    if not PAGES_DIR.is_dir():
        print("找不到圖片資料夾：", PAGES_DIR)
    build_thumbs()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print("嵌字台已啟動：", url)
    print("專案：", _ws_current.get("name") or PAGES_DIR.name)
    print("圖片資料夾：", PAGES_DIR)
    print("匯出資料夾：", EXPORT_DIR)
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
