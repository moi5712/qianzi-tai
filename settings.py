# -*- coding: utf-8 -*-
"""設定與文案：load/save settings.json，預設提示詞只讀 文案.json。"""
from __future__ import annotations

import json
from pathlib import Path

SETTINGS_NAME = "settings.json"
COPY_PATH = Path(__file__).resolve().parent / "文案.json"
_copy_cache: tuple[float, dict] | None = None


# --- 共用：設定與提示詞 ---

def _read_copy() -> dict:
    global _copy_cache
    try:
        mtime = COPY_PATH.stat().st_mtime
    except OSError:
        _copy_cache = None
        return {}
    if _copy_cache and _copy_cache[0] == mtime:
        return _copy_cache[1]
    try:
        data = json.loads(COPY_PATH.read_text(encoding="utf-8"))
        data = data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        data = {}
    _copy_cache = (mtime, data)
    return data


def copy_prompts() -> tuple[str, str]:
    # 預設與還原都只讀 文案.json 的 prompts
    prompts = (_read_copy().get("prompts") or {})
    return str(prompts.get("ocr") or "").strip(), str(prompts.get("translate") or "").strip()


DEFAULT_SETTINGS = {
    "apiBase": "https://api.openai.com/v1",
    "apiKey": "",
    "model": "gpt-4o",
    "ocrPrompt": "",
    "translatePrompt": "",
    "includeSfx": False,
    "doBreak": True,
    "placeOnCanvas": True,
    "maxLongSide": 1792,
    "ocrEngine": "local",
}


def settings_path(data_dir: Path) -> Path:
    return data_dir / SETTINGS_NAME


def load_settings(data_dir: Path) -> dict:
    path = settings_path(data_dir)
    data = dict(DEFAULT_SETTINGS)
    if path.is_file():
        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                data.update({k: saved[k] for k in saved if k in DEFAULT_SETTINGS})
        except (OSError, json.JSONDecodeError):
            pass
    for key, value in DEFAULT_SETTINGS.items():
        data.setdefault(key, value)
    ocr_default, translate_default = copy_prompts()
    if not str(data.get("ocrPrompt") or "").strip():
        data["ocrPrompt"] = ocr_default
    if not str(data.get("translatePrompt") or "").strip():
        data["translatePrompt"] = translate_default
    return data


def save_settings(data_dir: Path, incoming: dict) -> dict:
    data = load_settings(data_dir)
    if not isinstance(incoming, dict):
        incoming = {}
    for key in DEFAULT_SETTINGS:
        if key not in incoming:
            continue
        if key == "apiKey" and not str(incoming.get("apiKey") or "").strip():
            continue
        data[key] = incoming[key]
    data_dir.mkdir(parents=True, exist_ok=True)
    settings_path(data_dir).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def public_settings(data: dict) -> dict:
    out = dict(data)
    key = str(out.get("apiKey") or "")
    out["hasApiKey"] = bool(key.strip())
    out["apiKey"] = ""
    return out



def merge_request_settings(base: dict, incoming) -> dict:
    settings = dict(base)
    if not isinstance(incoming, dict):
        return settings
    for key, value in incoming.items():
        if key == "apiKey" and not str(value or "").strip():
            continue
        settings[key] = value
    return settings
