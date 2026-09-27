# -*- coding: utf-8 -*-
"""測試：不處理漫畫頁，只驗證 API 能否連線／看圖。"""
from __future__ import annotations

import base64
import io
import re
import secrets
from pathlib import Path

from auto_letter import chat_complete

# --- 測試：不處理漫畫頁，只驗證 API 能否連線／看圖 ---

_PROBE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_HTTP_CODE_RE = re.compile(r"API HTTP (\d+)")


def _probe_token(n: int = 4) -> str:
    return "".join(secrets.choice(_PROBE_ALPHABET) for _ in range(n))


def _probe_compact(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def _probe_font(size: int):
    from PIL import ImageFont

    for path in (
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
        Path(r"C:\Windows\Fonts\tahoma.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ):
        try:
            if path.is_file():
                return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return ImageFont.load_default()


def _token_image(token: str) -> str:
    from PIL import Image, ImageDraw

    width, height = 360, 140
    im = Image.new("RGB", (width, height), (248, 248, 248))
    draw = ImageDraw.Draw(im)
    font = _probe_font(72)
    box = draw.textbbox((0, 0), token, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (width - tw) // 2 - box[0]
    y = (height - th) // 2 - box[1]
    draw.text((x, y), token, fill=(20, 20, 20), font=font)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=93)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def classify_probe_error(err: BaseException) -> str:
    text = str(err or "")
    low = f"{text} {getattr(err, 'reason', '')}".lower()
    if isinstance(err, TimeoutError) or "timed out" in low or "timeout" in low:
        return "timeout"
    if "請先填 API Key" in text:
        return "missing_key"
    if "請先填模型名稱" in text:
        return "missing_model"
    if "請先填 API 位址" in text:
        return "missing_base"
    if "需要 Pillow" in text:
        return "need_pillow"
    match = _HTTP_CODE_RE.search(text)
    if match:
        code = match.group(1)
        mapped = {
            "401": "http_401",
            "403": "http_403",
            "404": "http_404",
            "408": "timeout",
            "429": "http_429",
        }
        if code in mapped:
            return mapped[code]
        if code.startswith("5"):
            return "http_5xx"
        return "http_other"
    if "連不到" in text or "urlopen" in low or "errno" in low or "getaddrinfo" in low:
        return "unreachable"
    if "不是 JSON" in text:
        return "invalid_json"
    if "沒有回傳內容" in text:
        return "no_content"
    if "invalid_api_key" in low or "incorrect api key" in low or "unauthorized" in low:
        return "http_401"
    if "rate_limit" in low or "rate limit" in low or "insufficient_quota" in low:
        return "http_429"
    if "model" in low and ("not found" in low or "does not exist" in low or "invalid model" in low):
        return "http_404"
    return "unknown"


def test_connection(settings: dict) -> dict:
    # 連線測試：確認文字 API 有回應
    try:
        content = chat_complete(
            settings,
            [{"role": "user", "content": "Reply with exactly: READY"}],
            timeout=40,
        )
    except Exception as err:
        return {"ok": False, "code": classify_probe_error(err)}
    if (content or "").strip():
        return {"ok": True, "code": "connected"}
    return {"ok": False, "code": "no_content"}


def _jp_probe_font(size: int):
    from PIL import ImageFont

    for path in (
        Path(r"C:\Windows\Fonts\msgothic.ttc"),
        Path(r"C:\Windows\Fonts\YuGothM.ttc"),
        Path(r"C:\Windows\Fonts\meiryo.ttc"),
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\mingliu.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"),
    ):
        try:
            if path.is_file():
                return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return _probe_font(size)


def test_local_ocr() -> dict:
    try:
        from local_ocr import probe_sample
        from PIL import Image, ImageDraw
    except ImportError:
        return {"ok": False, "code": "need_local_ocr"}
    try:
        im = Image.new("RGB", (400, 160), (248, 248, 248))
        draw = ImageDraw.Draw(im)
        font = _jp_probe_font(72)
        draw.text((48, 36), "試験", fill=(20, 20, 20), font=font)
        probe_sample(im)
        return {"ok": True, "code": "local_ocr_ok"}
    except ValueError as err:
        if "尚未安裝" in str(err):
            return {"ok": False, "code": "need_local_ocr"}
        return {"ok": False, "code": classify_probe_error(err)}
    except Exception as err:
        return {"ok": False, "code": classify_probe_error(err)}


def test_ocr(settings: dict) -> dict:
    engine = str((settings or {}).get("ocrEngine") or "local").strip().lower()
    if engine != "api":
        return test_local_ocr()
    return test_vision(settings)


def test_vision(settings: dict) -> dict:
    # 視覺測試：讀圖上隨機碼，確認模型能看圖
    try:
        token = _probe_token(4)
        b64 = _token_image(token)
    except ImportError:
        return {"ok": False, "code": "need_pillow"}
    except Exception as err:
        return {"ok": False, "code": classify_probe_error(err)}
    try:
        content = chat_complete(
            settings,
            [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Read the 4 characters in the image. Reply with only those characters. If you cannot see an image, reply NOIMG.",
                        },
                        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}},
                    ],
                }
            ],
            timeout=60,
        )
    except Exception as err:
        return {"ok": False, "code": classify_probe_error(err)}
    reply = (content or "").strip()
    compact = _probe_compact(reply)
    if token and token in compact:
        return {"ok": True, "code": "vision_ok"}
    if compact == "NOIMG":
        return {"ok": False, "code": "no_vision"}
    if not reply:
        return {"ok": False, "code": "no_content"}
    return {"ok": False, "code": "vision_mismatch"}
