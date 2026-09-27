# -*- coding: utf-8 -*-
"""本地 OCR：RapidOCR 整頁找框；僅低信心／短字／大框才裁切重認。"""
from __future__ import annotations

import threading
from pathlib import Path

_ENGINE = None
_LOCK = threading.Lock()
_CROP_PAD = 0.10
_UPSCALE_MIN = 48
_LOW_CONF = 0.35
_SHORT_SRC = 2
_LARGE_AREA = 0.08


def get_engine():
    global _ENGINE
    with _LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
        except ImportError as err:
            raise ValueError("尚未安裝本地 OCR。請執行：pip install rapidocr onnxruntime") from err
        _ENGINE = RapidOCR(
            params={
                "Rec.lang_type": LangRec.JAPAN,
                "Rec.ocr_version": OCRVersion.PPOCRV4,
                "Rec.model_type": ModelType.MOBILE,
            }
        )
        return _ENGINE


def _xywh(box) -> tuple[float, float, float, float]:
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    x = min(xs)
    y = min(ys)
    return x, y, max(xs) - x, max(ys) - y


def _gap(a: dict, b: dict) -> tuple[float, float]:
    ax2 = a["x"] + a["w"]
    ay2 = a["y"] + a["h"]
    bx2 = b["x"] + b["w"]
    by2 = b["y"] + b["h"]
    h_gap = 0.0 if not (ax2 < b["x"] or bx2 < a["x"]) else min(abs(b["x"] - ax2), abs(a["x"] - bx2))
    v_gap = 0.0 if not (ay2 < b["y"] or by2 < a["y"]) else min(abs(b["y"] - ay2), abs(a["y"] - by2))
    return h_gap, v_gap


def _overlap(a1: float, a2: float, b1: float, b2: float) -> float:
    return max(0.0, min(a2, b2) - max(a1, b1))


def _same_bubble(a: dict, b: dict, img_w: int, img_h: int) -> bool:
    h_gap, v_gap = _gap(a, b)
    y_ov = _overlap(a["y"], a["y"] + a["h"], b["y"], b["y"] + b["h"])
    x_ov = _overlap(a["x"], a["x"] + a["w"], b["x"], b["x"] + b["w"])
    min_h = max(1.0, min(a["h"], b["h"]))
    min_w = max(1.0, min(a["w"], b["w"]))
    if y_ov >= min_h * 0.45 and h_gap <= img_w * 0.032:
        return True
    if x_ov >= min_w * 0.45 and v_gap <= img_h * 0.03:
        return True
    return False


def _cluster(items: list, img_w: int, img_h: int) -> list[list]:
    n = len(items)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            if _same_bubble(items[i], items[j], img_w, img_h):
                union(i, j)
    groups: dict[int, list] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(items[i])
    return list(groups.values())


def _join_src(group: list) -> tuple[str, float]:
    if not group:
        return "", 0.0
    vertical = sum(1 for it in group if it["h"] >= it["w"]) >= max(1, len(group) / 2)
    if vertical:
        ordered = sorted(group, key=lambda t: (-(t["x"] + t["w"] / 2), t["y"]))
    else:
        ordered = sorted(group, key=lambda t: (t["y"], t["x"]))
    src = "".join(it["src"] for it in ordered if it.get("src"))
    score = min(float(it.get("score") or 0) for it in group)
    return src, score


def _join_cluster(group: list) -> dict:
    vertical = sum(1 for it in group if it["h"] >= it["w"]) >= max(1, len(group) / 2)
    src, score = _join_src(group)
    x = min(it["x"] for it in group)
    y = min(it["y"] for it in group)
    r = max(it["x"] + it["w"] for it in group)
    b = max(it["y"] + it["h"] for it in group)
    return {
        "src": src,
        "x": round(x, 2),
        "y": round(y, 2),
        "w": round(r - x, 2),
        "h": round(b - y, 2),
        "kind": "speech",
        "vertical": vertical,
        "score": round(score, 4),
        "lowConf": score < _LOW_CONF,
    }


def _reading_key(item: dict, img_h: int) -> tuple:
    band = int(item["y"] / max(img_h * 0.16, 1))
    return (band, -(item["x"] + item["w"] / 2))


def _image_source(im):
    try:
        import numpy as np
        return np.array(im.convert("RGB"), copy=True)
    except ImportError:
        return im.convert("RGB")


def probe_sample(im) -> list[dict]:
    """公開探測：對單張圖跑一次辨識，確認引擎可用。"""
    return _run_ocr(get_engine(), _image_source(im))


def _run_ocr(engine, source) -> list[dict]:
    with _LOCK:
        result = engine(source)
    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    boxes = [] if boxes is None else list(boxes)
    txts = [] if txts is None else list(txts)
    scores = [] if scores is None else list(scores)
    items = []
    for box, txt, score in zip(boxes, txts, scores):
        x, y, w, h = _xywh(box)
        if w < 6 or h < 6:
            continue
        items.append(
            {
                "src": str(txt or "").strip(),
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "score": float(score or 0),
            }
        )
    return items


def _crop_pad(img_w: int, img_h: int, x: float, y: float, w: float, h: float) -> tuple[int, int, int, int]:
    px = max(2.0, w * _CROP_PAD)
    py = max(2.0, h * _CROP_PAD)
    x0 = max(0, int(x - px))
    y0 = max(0, int(y - py))
    x1 = min(img_w, int(x + w + px + 0.999))
    y1 = min(img_h, int(y + h + py + 0.999))
    return x0, y0, x1, y1


def _needs_crop_reread(item: dict, img_w: int, img_h: int) -> bool:
    src = str(item.get("src") or "").strip()
    score = float(item.get("score") or 0)
    area = float(item.get("w") or 0) * float(item.get("h") or 0)
    page_area = max(1, img_w * img_h)
    if score < _LOW_CONF:
        return True
    if len(src) < _SHORT_SRC:
        return True
    if area > page_area * _LARGE_AREA:
        return True
    return False


def _recognize_crop(engine, rgb, item: dict) -> tuple[str, float]:
    x0, y0, x1, y1 = _crop_pad(rgb.width, rgb.height, item["x"], item["y"], item["w"], item["h"])
    if x1 - x0 < 6 or y1 - y0 < 6:
        return "", 0.0
    crop = rgb.crop((x0, y0, x1, y1))
    if min(crop.size) < _UPSCALE_MIN:
        from PIL import Image
        crop = crop.resize((max(1, crop.width * 2), max(1, crop.height * 2)), Image.Resampling.LANCZOS)
    found = _run_ocr(engine, _image_source(crop))
    if not found:
        return "", 0.0
    return _join_src(found)


def recognize_local(page_path: Path, include_sfx: bool = False) -> dict:
    if not page_path.is_file():
        raise ValueError("找不到頁面圖：" + page_path.name)
    try:
        from PIL import Image
    except ImportError as err:
        raise ValueError("需要 Pillow 才能做本地 OCR") from err
    with Image.open(page_path) as im:
        img_w, img_h = im.size
        rgb = im.convert("RGB")
    engine = get_engine()
    detected = _run_ocr(engine, _image_source(rgb))
    lines = []
    for item in detected:
        src = str(item.get("src") or "").strip()
        score = float(item.get("score") or 0)
        if _needs_crop_reread(item, img_w, img_h):
            try:
                crop_src, crop_score = _recognize_crop(engine, rgb, item)
            except Exception:
                crop_src, crop_score = "", 0.0
            if crop_src:
                src = crop_src
                score = crop_score
        if not src:
            continue
        lines.append(
            {
                "src": src,
                "x": item["x"],
                "y": item["y"],
                "w": item["w"],
                "h": item["h"],
                "score": score,
            }
        )
    if not include_sfx:
        lines = [it for it in lines if it["h"] < img_h * 0.42 or it["w"] < img_w * 0.35]
    groups = _cluster(lines, img_w, img_h) if lines else []
    bubbles = [_join_cluster(g) for g in groups if str(g and g[0].get("src") or "")]
    bubbles.sort(key=lambda b: _reading_key(b, img_h))
    out = []
    for i, item in enumerate(bubbles, start=1):
        if not item["src"]:
            continue
        out.append({"order": i, **item})
    warning = ""
    if not out:
        warning = "沒有找到文字。手寫或特效字可能較難辨識，可嘗試支援 OCR 的模型。"
    return {
        "pageName": page_path.name,
        "width": img_w,
        "height": img_h,
        "bubbles": out,
        "warning": warning,
        "rawPreview": "",
    }
