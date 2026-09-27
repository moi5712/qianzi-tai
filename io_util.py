# -*- coding: utf-8 -*-
"""檔案與 JSON 小工具：安全檔名、讀寫、原子寫入。"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import unquote


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


def write_json_atomic(path: Path, payload, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=indent)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
