# -*- coding: utf-8 -*-
"""本地漫畫嵌字台：HTTP 介面。"""
from __future__ import annotations

import json
import mimetypes
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import workspace as ws
from auto_letter import recognize_page, translate_items
from font_store import (
    FONT_EXTS,
    FONTS_DIR,
    builtin_font_files,
    fonts_payload,
    invalidate_font_catalog,
    load_font_catalog,
    public_font_item,
    save_font_catalog,
    unique_font_name,
)
from io_util import read_json, safe_name, safe_rel, write_bytes_atomic, write_json_atomic
from page_store import (
    IMAGE_EXTS,
    build_thumb_for,
    page_name_for_stem,
    pages_payload,
    unique_page_name,
)
from probe import test_connection, test_ocr
from settings import load_settings, merge_request_settings, public_settings, save_settings
from workspace import (
    ROOT,
    STATIC_DIR,
    activate_workspace,
    ensure_dirs,
    load_workspace,
    pick_directory,
    prepare_standard_folder,
    workspace_payload,
)

HOST = "127.0.0.1"
PORT = 8765
CACHE_NONE = "no-cache"
CACHE_DAY = "public, max-age=86400"
CACHE_HOUR = "public, max-age=3600"
CACHE_YEAR = "public, max-age=31536000, immutable"


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
        if ws.PAGES_DIR is None or ws.PROJECT_PATH is None or ws.ERASE_DIR is None or ws.THUMB_DIR is None or ws.EXPORT_DIR is None:
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
            if ws.PAGES_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            self._send_file(ws.PAGES_DIR / safe_name(path[len("/media/") :]), cache=CACHE_DAY)
            return
        if path.startswith("/thumbs/"):
            if ws.THUMB_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            name = safe_name(path[len("/thumbs/") :])
            thumb = ws.THUMB_DIR / name
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
            project = read_json(ws.PROJECT_PATH, {}) if ws.PROJECT_PATH is not None else {}
            self._json(200, project if isinstance(project, dict) else {})
            return
        if path == "/api/settings":
            settings = public_settings(load_settings(ws.DATA_DIR))
            self._json(200, {"ok": True, "settings": settings})
            return
        if path.startswith("/api/erase/"):
            if ws.ERASE_DIR is None:
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            name = safe_name(path[len("/api/erase/") :])
            self._send_file(ws.ERASE_DIR / name, "image/png")
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
            data = self._parse_json(body)
            if data is None:
                return
            write_json_atomic(ws.PROJECT_PATH, data)
            self._json(200, {"ok": True})
            return
        if path.startswith("/api/erase/"):
            if not self._need_project():
                return
            name = Path(safe_name(path[len("/api/erase/") :])).stem + ".png"
            write_bytes_atomic(ws.ERASE_DIR / name, body)
            self._json(200, {"ok": True})
            return
        if path.startswith("/api/export/"):
            if not self._need_project():
                return
            name = Path(safe_name(path[len("/api/export/") :])).stem + ".png"
            dest = ws.EXPORT_DIR / name
            write_bytes_atomic(dest, body)
            self._json(200, {"ok": True, "path": str(dest)})
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
            write_bytes_atomic(FONTS_DIR / filename, body)
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
            write_bytes_atomic(ws.PAGES_DIR / filename, body)
            build_thumb_for(filename)
            payload = pages_payload()
            payload.update({"ok": True, "name": filename})
            self._json(200, payload)
            return
        if path == "/api/settings":
            data = self._parse_json(body)
            if data is None:
                return
            settings = save_settings(ws.DATA_DIR, data.get("settings") if isinstance(data.get("settings"), dict) else data)
            self._json(200, {"ok": True, "settings": public_settings(settings)})
            return
        if path == "/api/auto/test":
            data = self._parse_json(body)
            if data is None:
                return
            settings = merge_request_settings(
                load_settings(ws.DATA_DIR),
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
                load_settings(ws.DATA_DIR),
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
            page_path = ws.PAGES_DIR / page_name
            settings = load_settings(ws.DATA_DIR)
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
            settings = load_settings(ws.DATA_DIR)
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
            target = ws.ERASE_DIR / name
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
            src = ws.PAGES_DIR / name
            if src.is_file():
                src.unlink()
            thumb = ws.THUMB_DIR / (Path(name).stem + ".jpg")
            if thumb.is_file():
                thumb.unlink()
            erase = ws.ERASE_DIR / (Path(name).stem + ".png")
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
    if ws.PAGES_DIR is None:
        print("尚未開啟專案。請在瀏覽器按「新建」或「開啟」。")
    elif not ws.PAGES_DIR.is_dir():
        print("找不到圖片資料夾：", ws.PAGES_DIR)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print("嵌字台已啟動：", url)
    print("專案：", ws._ws_current.get("name") or "未開啟專案")
    print("圖片資料夾：", ws.PAGES_DIR or "（無）")
    print("匯出資料夾：", ws.EXPORT_DIR or "（無）")
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
