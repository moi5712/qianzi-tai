// --- 直排併字、局部樣式 ---
import { bag, fontFamilyCss } from "./store.js";
import { colorWithAlpha } from "./color.js";

export const RUN_KEYS = ["font", "fontSize", "fontWeight", "color", "opacity", "strokeColor", "strokeWidth"];
const TCY_MAX = 2;
const SIDEWAYS_IN_VERTICAL = new Set([
  0x002d, 0x007e, 0x00ad, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
  0x2025, 0x2026, 0x2027, 0x22ee, 0x22ef, 0x2500, 0x2501, 0x2574, 0x2576,
  0x2578, 0x257a, 0x30a0, 0x30fc, 0x301c, 0x3030, 0xfe31, 0xfe32, 0xfe58,
  0xfe63, 0xff0d, 0xff5e, 0xff70,
]);
const UPRIGHT_PUNCT = new Set([
  0x21, 0x22, 0x27, 0x2c, 0x2e, 0x3a, 0x3b, 0x3f,
  0xff01, 0xff1f,
]);

function isUprightPunct(ch) {
  const cp = String(ch || "").codePointAt(0);
  return UPRIGHT_PUNCT.has(cp);
}

function isSidewaysInVertical(ch) {
  const cp = String(ch || "").codePointAt(0);
  if (!cp || isUprightPunct(ch)) return false;
  if (SIDEWAYS_IN_VERTICAL.has(cp)) return true;
  if (cp >= 0x21 && cp <= 0x2f) return true;
  if (cp >= 0x3a && cp <= 0x40) return true;
  if (cp >= 0x5b && cp <= 0x60) return true;
  if (cp >= 0x7b && cp <= 0x7e) return true;
  if (cp >= 0x41 && cp <= 0x5a) return true;
  if (cp >= 0x61 && cp <= 0x7a) return true;
  return false;
}

function isWestern(ch) {
  return isBangQ(ch) || isDigit(ch) || isLatin(ch);
}

function token(start, end, text, combine, vertical) {
  const tcy = !!vertical && (!!combine || (text.length === 1 && isWestern(text)));
  const one = !!vertical && !tcy && text.length === 1;
  const bang = isBangQ(text);
  return {
    start,
    end,
    text,
    combine: tcy,
    sideways: one && !bang && isSidewaysInVertical(text),
    upright: one && (bang || isUprightPunct(text)),
    bang,
  };
}

function isBangQ(ch) {
  return ch === "!" || ch === "?" || ch === "！" || ch === "？";
}

function isDigit(ch) {
  return (ch >= "0" && ch <= "9") || (ch >= "０" && ch <= "９");
}

function isLatin(ch) {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")
    || (ch >= "Ａ" && ch <= "Ｚ") || (ch >= "ａ" && ch <= "ｚ");
}

function toTcyText(s) {
  let out = "";
  for (const ch of String(s || "")) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xff01 && cp <= 0xff5e) out += String.fromCharCode(cp - 0xfee0);
    else out += ch;
  }
  return out;
}

function tokenizeText(text, vertical) {
  const tokens = [];
  const s = String(text || "");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n" || ch === "\r") {
      tokens.push(token(i, i + 1, "\n", false, vertical));
      i += 1;
      continue;
    }
    if (!vertical || !isWestern(ch)) {
      tokens.push(token(i, i + 1, ch, false, vertical));
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < s.length && j - i < TCY_MAX && isWestern(s[j])) j += 1;
    tokens.push(token(i, j, s.slice(i, j), true, vertical));
    i = j;
  }
  return tokens;
}

function sameStyle(a, b) {
  return RUN_KEYS.every((k) => a[k] === b[k]);
}

function charStyleAt(t, index) {
  const out = {};
  for (const k of RUN_KEYS) out[k] = t[k];
  for (const run of t.runs || []) {
    if (index >= run.start && index < run.end) {
      for (const k of RUN_KEYS) if (run[k] != null) out[k] = run[k];
      break;
    }
  }
  return out;
}

function clampRuns(t) {
  const n = String(t?.text || "").length;
  t.runs = (t.runs || [])
    .map((r) => ({
      ...r,
      start: Math.max(0, Math.min(r.start, n)),
      end: Math.max(0, Math.min(r.end, n)),
    }))
    .filter((r) => r.end > r.start);
  if (!t.runs.length) delete t.runs;
}

function stripRunKey(t, key) {
  if (!t?.runs?.length || !key) return;
  for (const run of t.runs) delete run[key];
  t.runs = t.runs.filter((run) => RUN_KEYS.some((k) => run[k] != null));
  if (!t.runs.length) delete t.runs;
}

function applyRunStyle(t, start, end, patch) {
  const n = String(t.text || "").length;
  start = Math.max(0, Math.min(start, n));
  end = Math.max(0, Math.min(end, n));
  if (end <= start) return;
  const chars = [];
  for (let i = 0; i < n; i += 1) {
    const o = {};
    for (const run of t.runs || []) {
      if (i >= run.start && i < run.end) {
        for (const k of RUN_KEYS) if (run[k] != null) o[k] = run[k];
      }
    }
    if (i >= start && i < end) {
      for (const k of RUN_KEYS) if (patch[k] != null) o[k] = patch[k];
    }
    for (const k of RUN_KEYS) if (o[k] === t[k]) delete o[k];
    chars.push(o);
  }
  const runs = [];
  for (let i = 0; i < n; i += 1) {
    const o = chars[i];
    if (!RUN_KEYS.some((k) => o[k] != null)) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === i && RUN_KEYS.every((k) => last[k] === o[k])) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, ...o });
  }
  t.runs = runs;
  if (!t.runs.length) delete t.runs;
}

function applyTextStroke(el, width, color) {
  if (!el) return;
  if (width > 0) {
    el.style.webkitTextStroke = `${width}px ${color}`;
    el.style.paintOrder = "stroke fill";
  } else {
    el.style.removeProperty("-webkit-text-stroke");
    el.style.removeProperty("paint-order");
  }
}

function applyInlineStyle(el, s) {
  el.style.fontFamily = fontFamilyCss(s.font);
  el.style.fontSize = s.fontSize + "px";
  el.style.fontWeight = s.fontWeight;
  el.style.color = colorWithAlpha(s.color, s.opacity);
  applyTextStroke(el, s.strokeWidth, s.strokeColor);
}

function splitTokenByStyle(t, tok) {
  const parts = [];
  for (let i = tok.start; i < tok.end; ) {
    const style = charStyleAt(t, i);
    let j = i + 1;
    while (j < tok.end && sameStyle(charStyleAt(t, j), style)) j += 1;
    parts.push({ start: i, end: j, text: t.text.slice(i, j), style });
    i = j;
  }
  return parts;
}

function styleNode(t, part, orient) {
  const differs = RUN_KEYS.some((k) => part.style[k] !== t[k]);
  if (!differs && !orient) return document.createTextNode(part.text);
  const el = document.createElement("span");
  el.className = [differs ? "r" : "", orient].filter(Boolean).join(" ");
  if (differs) applyInlineStyle(el, part.style);
  el.textContent = part.text;
  return el;
}

function fillTextInner(inner, t) {
  inner.replaceChildren();
  const tokens = tokenizeText(t.text, t.vertical);
  for (const tok of tokens) {
    if (tok.text === "\n") {
      inner.appendChild(document.createTextNode("\n"));
      continue;
    }
    const parts = splitTokenByStyle(t, tok);
    const orient = tok.combine ? "" : tok.upright ? "upright" : tok.sideways ? "sideways" : "";
    if (tok.combine) {
      const wrap = document.createElement("span");
      wrap.className = "tcy";
      const shown = toTcyText(tok.text);
      if (shown !== tok.text) wrap.dataset.raw = tok.text;
      for (const part of parts) {
        wrap.appendChild(styleNode(t, shown === tok.text ? part : { ...part, text: toTcyText(part.text) }, ""));
      }
      inner.appendChild(wrap);
    } else {
      for (const part of parts) inner.appendChild(styleNode(t, part, orient));
    }
  }
}

function textOffset(root, node, offset) {
  if (!root) return 0;
  if (node === root) {
    let n = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i += 1) {
      n += (root.childNodes[i].textContent || "").length;
    }
    return n;
  }
  let n = 0;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur = walk.nextNode();
  while (cur) {
    if (cur === node) return n + offset;
    n += cur.textContent.length;
    cur = walk.nextNode();
  }
  return n;
}

function posAt(root, target) {
  let n = 0;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur = walk.nextNode();
  let last = null;
  while (cur) {
    last = cur;
    const len = cur.textContent.length;
    if (target <= n + len) return { node: cur, offset: target - n };
    n += len;
    cur = walk.nextNode();
  }
  if (last) return { node: last, offset: last.textContent.length };
  return { node: root, offset: 0 };
}

function rangeForOffsets(root, start, end) {
  const a = posAt(root, start);
  const b = posAt(root, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function readInnerRange(inner, textId) {
  if (!inner || !textId) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const host = range.commonAncestorContainer;
  if (host !== inner && !inner.contains(host)) return null;
  const start = textOffset(inner, range.startContainer, range.startOffset);
  const end = textOffset(inner, range.endContainer, range.endOffset);
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  if (b <= a) return null;
  return { textId, start: a, end: b };
}

function captureCharSel(inner, textId) {
  const next = readInnerRange(inner, textId);
  bag.charSel = next;
  return next;
}

function restoreCharSel(inner, start, end) {
  if (!inner || end <= start) return;
  try {
    const range = rangeForOffsets(inner, start, end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* ignore */
  }
}

function readInnerText(root) {
  if (!root) return "";
  let s = "";
  const take = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      s += node.nodeValue || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList.contains("tcy") && node.dataset.raw) {
      s += node.dataset.raw;
      return;
    }
    for (const child of node.childNodes) take(child);
  };
  take(root);
  return s.replace(/\r/g, "");
}

function caretOffset(inner) {
  if (!inner) return 0;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return readInnerText(inner).length;
  const range = sel.getRangeAt(0);
  const host = range.commonAncestorContainer;
  if (host !== inner && !inner.contains(host)) return readInnerText(inner).length;
  return textOffset(inner, range.startContainer, range.startOffset);
}

function placeCaret(inner, offset) {
  if (!inner) return;
  try {
    const pos = posAt(inner, Math.max(0, offset));
    const range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* ignore */
  }
}

function caretOffsetFromPoint(inner, x, y) {
  if (!inner) return 0;
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || (node !== inner && !inner.contains(node))) return caretOffset(inner);
  return textOffset(inner, node, offset);
}

function clearNativeSel() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) sel.removeAllRanges();
}

function selLayerOf(box) {
  return box?.querySelector?.(":scope > .sel-layer") || null;
}

function ensureSelLayer(box) {
  let layer = selLayerOf(box);
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "sel-layer";
  layer.setAttribute("aria-hidden", "true");
  const inner = box.querySelector(":scope > .inner");
  if (inner?.nextSibling) box.insertBefore(layer, inner.nextSibling);
  else box.appendChild(layer);
  return layer;
}

function clientToLocalFn(el) {
  const probe = document.createElement("i");
  probe.className = "sel-probe";
  probe.setAttribute("aria-hidden", "true");
  el.appendChild(probe);
  probe.style.left = "0";
  probe.style.top = "0";
  const origin = probe.getBoundingClientRect();
  probe.style.left = "100px";
  const x = probe.getBoundingClientRect();
  probe.style.left = "0";
  probe.style.top = "100px";
  const y = probe.getBoundingClientRect();
  probe.remove();
  const xx = (x.left - origin.left) / 100;
  const xy = (x.top - origin.top) / 100;
  const yx = (y.left - origin.left) / 100;
  const yy = (y.top - origin.top) / 100;
  const det = xx * yy - xy * yx;
  if (!det || !Number.isFinite(det)) {
    return (cx, cy) => ({ x: cx - origin.left, y: cy - origin.top });
  }
  return (cx, cy) => {
    const vx = cx - origin.left;
    const vy = cy - origin.top;
    return {
      x: (vx * yy - vy * yx) / det,
      y: (vy * xx - vx * xy) / det,
    };
  };
}

function rangePaintRects(inner, range) {
  const seen = new Set();
  const out = [];
  const add = (r) => {
    if (!r || r.width < 0.25 || r.height < 0.25) return;
    const key = [r.left, r.top, r.width, r.height].map((n) => n.toFixed(2)).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const r of range.getClientRects()) add(r);
  inner.querySelectorAll(".bq").forEach((el) => {
    try {
      if (range.intersectsNode(el)) add(el.getBoundingClientRect());
    } catch {
      /* ignore */
    }
  });
  return out;
}

function highlightScope(from) {
  if (from instanceof Element) return from.closest(".text-box") || from;
  if (from && from.nodeType === 1) return from;
  return document.getElementById("texts");
}

function clearCharHighlight(from) {
  const scope = highlightScope(from);
  if (!scope) return;
  if (scope.classList?.contains("sel-layer")) {
    scope.replaceChildren();
    return;
  }
  scope.querySelectorAll(".sel-layer").forEach((layer) => layer.replaceChildren());
}

function paintCharHighlight(inner, start, end) {
  const box = inner?.closest?.(".text-box");
  clearCharHighlight(box || inner);
  if (!inner || !box || end <= start) return;
  try {
    const range = rangeForOffsets(inner, start, end);
    const layer = ensureSelLayer(box);
    layer.replaceChildren();
    const toLocal = clientToLocalFn(box);
    for (const r of rangePaintRects(inner, range)) {
      const a = toLocal(r.left, r.top);
      const b = toLocal(r.right, r.bottom);
      const el = document.createElement("i");
      el.className = "sel-rect";
      el.style.left = Math.min(a.x, b.x) + "px";
      el.style.top = Math.min(a.y, b.y) + "px";
      el.style.width = Math.abs(b.x - a.x) + "px";
      el.style.height = Math.abs(b.y - a.y) + "px";
      layer.appendChild(el);
    }
  } catch {
    /* ignore */
  }
}

function clearCharSel() {
  bag.charSel = null;
  clearCharHighlight();
  clearNativeSel();
}

function activeCharSel(textId) {
  if (bag.glyphPick) return null;
  const sel = bag.charSel;
  if (!sel || sel.end <= sel.start) return null;
  if (textId && sel.textId !== textId) return null;
  return sel;
}

export {
  tokenizeText,
  toTcyText,
  charStyleAt,
  clampRuns,
  stripRunKey,
  applyRunStyle,
  applyTextStroke,
  fillTextInner,
  readInnerText,
  rangeForOffsets,
  captureCharSel,
  restoreCharSel,
  caretOffset,
  placeCaret,
  caretOffsetFromPoint,
  clearCharSel,
  activeCharSel,
  clearNativeSel,
  readInnerRange,
  paintCharHighlight,
  clearCharHighlight,
};
