# -*- coding: utf-8 -*-
"""自動識別對白、斷句、翻譯：走使用者設定的 OpenAI 相容 API。"""
from __future__ import annotations

import base64
import io
import json
import re
import ssl
import urllib.error
import urllib.request
from pathlib import Path

# --- 共用：解析模型回覆 ---

def extract_json(text: str):
    raw = (text or "").strip()
    if not raw:
        raise ValueError("模型沒有回傳內容")
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    obj_start, obj_end = raw.find("{"), raw.rfind("}")
    arr_start, arr_end = raw.find("["), raw.rfind("]")
    blob = ""
    if obj_start >= 0 and obj_end > obj_start and (arr_start < 0 or obj_start <= arr_start):
        blob = raw[obj_start : obj_end + 1]
    elif arr_start >= 0 and arr_end > arr_start:
        blob = raw[arr_start : arr_end + 1]
    else:
        raise ValueError("模型回傳不是 JSON")
    try:
        return json.loads(blob)
    except json.JSONDecodeError as err:
        raise ValueError("模型回傳 JSON 無法解析") from err


def collect_list(data):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("bubbles", "items", "dialogues", "dialogue", "texts", "lines", "results", "data"):
        if isinstance(data.get(key), list):
            return data[key]
    return []


def item_src(item: dict) -> str:
    for key in ("src", "original", "jp", "ocr"):
        val = str(item.get(key) or "").strip()
        if val:
            return val
    return ""


# --- 共用：呼叫模型 ---

def chat_url(api_base: str) -> str:
    base = (api_base or "").strip().rstrip("/")
    if not base:
        raise ValueError("請先填 API 位址")
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def _parts_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            if not isinstance(part, dict):
                continue
            kind = str(part.get("type") or "")
            if kind in {"reasoning", "thinking"}:
                continue
            if kind in {"text", "output_text"} or "text" in part:
                parts.append(str(part.get("text") or ""))
        return "".join(parts)
    return str(content)


def _choice_text(data: dict) -> tuple[str, str]:
    try:
        choice = data["choices"][0]
        msg = choice.get("message") or {}
    except (KeyError, IndexError, TypeError):
        return "", ""
    finish = str(choice.get("finish_reason") or "")
    text = _parts_text(msg.get("content")).strip()
    return text, finish


def _payload_attempts(settings: dict) -> list[dict]:
    base = str(settings.get("apiBase") or "").lower()
    model = str(settings.get("model") or "").lower()
    deepseek = "deepseek" in base or "deepseek" in model
    if deepseek:
        return [
            {"max_tokens": 8192, "thinking": {"type": "disabled"}},
            {"max_tokens": 16384, "thinking": {"type": "disabled"}},
            {"max_tokens": 16384},
        ]
    return [
        {"max_tokens": 8192},
        {"max_tokens": 16384},
        {},
    ]


def chat_complete(settings: dict, messages: list, timeout: int = 180) -> str:
    key = str(settings.get("apiKey") or "").strip()
    model = str(settings.get("model") or "").strip()
    if not key:
        raise ValueError("請先填 API Key")
    if not model:
        raise ValueError("請先填模型名稱")
    ctx = ssl.create_default_context()
    last_error = None
    empty_finish = ""
    for extra in _payload_attempts(settings):
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            **extra,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            chat_url(str(settings.get("apiBase") or "")),
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:800]
            last_error = ValueError(f"API HTTP {err.code}：{detail or err.reason}")
            if extra and err.code in {400, 422}:
                continue
            raise last_error from err
        except urllib.error.URLError as err:
            raise ValueError("連不到 API：" + str(err.reason)) from err
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as err:
            last_error = ValueError("API 回傳不是 JSON")
            continue
        if isinstance(data, dict) and data.get("error"):
            err = data["error"]
            msg = err.get("message") if isinstance(err, dict) else str(err)
            last_error = ValueError("API 錯誤：" + str(msg))
            continue
        content, finish = _choice_text(data if isinstance(data, dict) else {})
        if content:
            return content
        empty_finish = finish or "empty"
        if finish == "length" and extra:
            last_error = None
            continue
        break
    if last_error:
        raise last_error
    why = empty_finish or "empty"
    raise ValueError(
        f"模型沒有回傳內容（finish_reason={why}）。"
    )


# --- 共用：整理圖像、座標與文字 ---

def encode_page_image(path: Path, max_long_side: int = 1792) -> tuple[str, int, int]:
    try:
        from PIL import Image
    except ImportError as err:
        raise ValueError("需要 Pillow 才能壓縮頁面圖。請先執行：pip install Pillow") from err
    with Image.open(path) as im:
        rgb = im.convert("RGB")
        width, height = rgb.size
        limit = max(640, min(int(max_long_side or 1792), 4096))
        longest = max(width, height)
        if longest > limit:
            scale = limit / longest
            rgb = rgb.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        rgb.save(buf, format="JPEG", quality=82, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii"), width, height


def clamp(n: float, a: float, b: float) -> float:
    return max(a, min(b, n))


def to_box(item: dict, img_w: int, img_h: int) -> dict:
    x = float(item.get("x") or 0)
    y = float(item.get("y") or 0)
    w = float(item.get("w") or 0)
    h = float(item.get("h") or 0)
    if max(abs(x), abs(y), abs(w), abs(h)) <= 1.5:
        x *= img_w
        y *= img_h
        w *= img_w
        h *= img_h
    x = clamp(x, 0, img_w)
    y = clamp(y, 0, img_h)
    w = clamp(w, 8, img_w - x)
    h = clamp(h, 8, img_h - y)
    return {
        "x": round(x, 2),
        "y": round(y, 2),
        "w": round(w, 2),
        "h": round(h, 2),
        "vertical": item_vertical(item, w, h),
    }


def item_vertical(item: dict, w: float, h: float) -> bool:
    raw = item.get("vertical")
    if isinstance(raw, bool):
        return raw
    if raw in (0, 1):
        return bool(raw)
    if isinstance(raw, str):
        s = raw.strip().lower()
        if s == "true":
            return True
        if s == "false":
            return False
    return h >= w


def strip_zh_stops(text: str) -> str:
    return (text or "").replace("。", "").replace("，", "")


def normalize_break(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in str(text or "").replace("\r", "").split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


# --- 實際辨識：處理漫畫頁，產出氣泡 ---

def recognize_page(page_path: Path, settings: dict, include_sfx: bool | None = None) -> dict:
    # 入口：本地 OCR 或視覺 API
    if include_sfx is None:
        use_sfx = bool(settings.get("includeSfx", DEFAULT_SETTINGS["includeSfx"]))
    else:
        use_sfx = bool(include_sfx)
    engine = str(settings.get("ocrEngine") or "local").strip().lower()
    if engine != "api":
        from local_ocr import recognize_local
        return recognize_local(page_path, include_sfx=use_sfx)
    return recognize_page_api(page_path, settings, include_sfx=use_sfx)


def recognize_page_api(page_path: Path, settings: dict, include_sfx: bool | None = None) -> dict:
    # 視覺 API：送本頁圖像，解析對白 JSON
    if not page_path.is_file():
        raise ValueError("找不到頁面圖：" + page_path.name)
    max_side = int(settings.get("maxLongSide") or 1792)
    b64, img_w, img_h = encode_page_image(page_path, max_side)
    if include_sfx is None:
        use_sfx = bool(settings.get("includeSfx", DEFAULT_SETTINGS["includeSfx"]))
    else:
        use_sfx = bool(include_sfx)
    extra = "" if use_sfx else "\n本次不要輸出 sfx，只輸出 speech / thought / narration。"
    prompt = str(settings.get("ocrPrompt") or copy_prompts()[0]).strip() + extra
    prompt += "\nvertical 只能是 true 或 false：true 直排，false 橫排。"
    prompt += f"\n本頁檔名：{page_path.name}，像素 {img_w}×{img_h}。"
    content = chat_complete(
        settings,
        [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "請仔細看附上的漫畫圖，把全部對白氣泡檢測出來，只輸出 JSON。"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64," + b64},
                    },
                ],
            },
        ],
        timeout=180,
    )
    data = extract_json(content)
    bubbles = collect_list(data)
    out = []
    for i, item in enumerate(bubbles, start=1):
        if not isinstance(item, dict):
            continue
        src = item_src(item)
        if not src:
            continue
        kind = str(item.get("kind") or "speech").strip().lower()
        if kind not in {"speech", "thought", "narration", "sfx"}:
            kind = "speech"
        if kind == "sfx" and not use_sfx:
            continue
        box = to_box(item, img_w, img_h)
        order = item.get("order")
        try:
            order = int(order)
        except (TypeError, ValueError):
            order = i
        out.append(
            {
                "order": order,
                "src": src,
                "kind": kind,
                **box,
            }
        )
    out.sort(key=lambda b: (b["order"], b["y"], -b["x"]))
    for i, item in enumerate(out, start=1):
        item["order"] = i
    warning = ""
    raw_preview = ""
    if not out:
        warning = "模型未輸出任何對白。請至「API 設定」選擇支援圖像辨識的模型（如 gpt-4o、gemini、claude，或 OpenRouter 提供的模型）。若使用純文字模型，通常會得到 0 則結果。"
   
        raw_preview = (content or "").strip()[:400]
    return {
        "pageName": page_path.name,
        "width": img_w,
        "height": img_h,
        "bubbles": out,
        "warning": warning,
        "rawPreview": raw_preview,
    }


def _row_text(row: dict) -> str:
    for key in ("text", "translation", "translated"):
        val = str(row.get(key) or "").strip()
        if val:
            return val
    return ""


def _row_id(row: dict, index: int) -> str:
    for key in ("id", "key"):
        val = str(row.get(key) or "").strip()
        if val:
            return val
    order = row.get("order")
    page = str(row.get("pageName") or row.get("page") or "").strip()
    if isinstance(order, str) and "#" in order:
        return order.strip()
    if page and order is not None and str(order) != "":
        return f"{page}#{order}"
    if order is not None and str(order) != "":
        return f"#{order}"
    return f"idx:{index}"


# --- 實際翻譯：把識別結果譯成嵌字文案 ---

def _pair_list(rows, limit: int = 0) -> list[dict]:
    out = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        src = str(row.get("src") or "").strip()
        text = str(row.get("text") or "").strip()
        if not src or not text:
            continue
        out.append({"src": src, "text": text})
    if limit and len(out) > limit:
        return out[-limit:]
    return out


def translate_items(
    items: list,
    settings: dict,
    do_break: bool = True,
    strict_punct: bool = True,
    glossary=None,
    memory=None,
) -> list:
    valid = []
    for item in items:
        if not isinstance(item, dict):
            continue
        src = str(item.get("src") or "").strip()
        if not src:
            continue
        try:
            order = int(item.get("order") or 0)
        except (TypeError, ValueError):
            order = 0
        page = str(item.get("pageName") or "")
        valid.append(
            {
                "id": f"{page}#{order}",
                "order": order,
                "src": src,
                "pageName": page,
                "kind": str(item.get("kind") or "speech"),
            }
        )
    if not valid:
        return []
    prompt = str(settings.get("translatePrompt") or copy_prompts()[1]).strip()
    if not do_break:
        prompt += "\n不要斷行，每則對白保持單行。"
    if strict_punct:
        prompt += "\n若原文沒有句號或逗號，則禁止自行添加標點。"
    prompt += (
        "\ntext 必須輸出繁體中文，禁止輸出原文。"
        "\nid 必須與輸入完全相同。"
        '\n輸出格式：{"items":[{"id":"<id>","text":"<zh-Hant>"}]}'
        "\n若有用語表，專有名詞、稱呼、口癖必須依表翻譯，不得另譯。"
        "\n若有近期譯文，譯名與口吻請保持一致，但不得覆寫用語表。"
    )
    glossary_rows = _pair_list(glossary)
    memory_rows = _pair_list(memory, 40)
    user_parts = ["翻譯以下對白。每行格式是 id<TAB>日文原文。只輸出 JSON。"]
    if glossary_rows:
        user_parts.append("用語表：")
        user_parts.extend(f"- {row['src']} → {row['text']}" for row in glossary_rows)
    if memory_rows:
        user_parts.append("近期已確認譯文：")
        user_parts.extend(f"- {row['src']} → {row['text']}" for row in memory_rows)
    user_parts.append("\n".join(f"{item['id']}\t{item['src']}" for item in valid))
    content = chat_complete(
        settings,
        [
            {"role": "system", "content": prompt},
            {"role": "user", "content": "\n".join(user_parts)},
        ],
        timeout=180,
    )
    data = extract_json(content)
    rows = []
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = collect_list(data)
        if not rows:
            rows = [{"id": key, "text": val} for key, val in data.items() if isinstance(val, str)]
    mapped = {}
    sequential = []
    for i, row in enumerate(rows):
        if isinstance(row, str):
            sequential.append(row)
            continue
        if not isinstance(row, dict):
            continue
        text = _row_text(row)
        sequential.append(text)
        mapped[_row_id(row, i)] = text
        order = row.get("order")
        try:
            mapped[f"#{int(order)}"] = text
        except (TypeError, ValueError):
            pass
    out = []
    for i, item in enumerate(valid):
        text = mapped.get(item["id"]) or mapped.get(f"#{item['order']}") or ""
        if not text and i < len(sequential):
            text = sequential[i]
        text = normalize_break(text)
        if strict_punct:
            text = strip_zh_stops(text)
            text = normalize_break(text)
        if not do_break:
            text = re.sub(r"\s*\n\s*", "", text)
        if not text or text == item["src"]:
            # keep empty-looking fallback only if nothing usable
            if not text:
                text = item["src"]
        out.append({**item, "text": text})
    return out


