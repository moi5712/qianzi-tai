import { fontFamilyCss } from "./store.js";
import { fillTextInner, applyTextStroke } from "./glyphs.js";

function rotateVec(x, y, deg) {
  const r = ((deg || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export const BOX_MIN = 24;
export const BOX_MAX = 4000;

let measurerHost = null;
let measurer = null;
let padCache = null;

function ensureMeasurer() {
  const host = document.getElementById("text-box-measurer");
  if (measurer && measurer.isConnected && host?.classList.contains("text-box")) {
    return measurer;
  }
  host?.remove();
  const next = document.createElement("div");
  next.id = "text-box-measurer";
  next.className = "text-box";
  next.setAttribute("aria-hidden", "true");
  next.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;transform:none;width:auto;height:auto;";
  next.innerHTML = '<div class="inner"></div>';
  document.body.appendChild(next);
  measurerHost = next;
  measurer = next.querySelector(".inner");
  padCache = null;
  return measurer;
}

function boxPad() {
  ensureMeasurer();
  if (padCache) return padCache;
  const hs = getComputedStyle(measurerHost);
  const is = getComputedStyle(measurer);
  padCache = {
    w: (parseFloat(hs.paddingLeft) || 0) + (parseFloat(hs.paddingRight) || 0)
      + (parseFloat(is.paddingLeft) || 0) + (parseFloat(is.paddingRight) || 0),
    h: (parseFloat(hs.paddingTop) || 0) + (parseFloat(hs.paddingBottom) || 0)
      + (parseFloat(is.paddingTop) || 0) + (parseFloat(is.paddingBottom) || 0),
  };
  return padCache;
}

function styleMeasurer(el, t) {
  el.style.fontFamily = fontFamilyCss(t.font);
  el.style.fontSize = (t.fontSize || 16) + "px";
  el.style.fontWeight = t.fontWeight || "400";
  el.style.lineHeight = String(t.lineHeight || 1);
  el.style.letterSpacing = (t.letterSpacing || 0) + "px";
  el.style.writingMode = t.vertical ? "vertical-rl" : "horizontal-tb";
  el.style.textOrientation = "mixed";
  el.style.whiteSpace = "pre-wrap";
  el.style.wordBreak = "break-word";
  applyTextStroke(el, t.strokeWidth, t.strokeColor);
}

export function normalizeSizeMode(t) {
  if (t?.sizeMode === "auto-width" || t?.sizeMode === "auto-height" || t?.sizeMode === "fixed") {
    return t.sizeMode;
  }
  return t?.vertical ? "auto-width" : "auto-height";
}

export function measureTextMetrics(t, wrap = {}) {
  const el = ensureMeasurer();
  const pad = boxPad();
  styleMeasurer(el, t);
  fillTextInner(el, t);

  const fontSize = t.fontSize || 16;
  const lineHeight = t.lineHeight || 1;

  if (t.vertical) {
    const singleCol = Math.ceil(fontSize * lineHeight);
    const minW = Math.max(singleCol + pad.w, 40);
    const minH = Math.max(Math.ceil(fontSize * 1.2) + pad.h, 40);

    el.style.height = "max-content";
    el.style.maxHeight = "none";
    el.style.width = "max-content";
    el.style.maxWidth = "none";
    const unwrapH = Math.max(Math.ceil(el.scrollHeight) + pad.h, minH);

    const effectiveH = wrap.h ?? t.h;
    const innerH = Math.max((effectiveH || unwrapH) - pad.h, 40);
    el.style.height = innerH + "px";
    el.style.maxHeight = innerH + "px";
    el.style.width = "max-content";
    el.style.maxWidth = "none";
    const needW = Math.max(Math.ceil(el.scrollWidth) + pad.w, minW);
    const needH = Math.max(Math.ceil(el.scrollHeight) + pad.h, minH);

    return { minW, minH, unwrapW: needW, unwrapH, needW, needH };
  }

  el.style.height = "auto";
  el.style.maxHeight = "none";
  el.style.width = "max-content";
  el.style.maxWidth = "none";
  const unwrapW = Math.ceil(el.scrollWidth) + pad.w;

  el.style.width = "min-content";
  const minW = Math.max(Math.ceil(el.scrollWidth) + pad.w, 50);

  const effectiveW = wrap.w ?? t.w;
  const innerW = Math.max((effectiveW || unwrapW) - pad.w, 20);
  el.style.width = innerW + "px";
  el.style.maxWidth = innerW + "px";
  const needH = Math.max(Math.ceil(el.scrollHeight) + pad.h, 30);

  return {
    minW,
    minH: needH,
    unwrapW,
    unwrapH: needH,
    needW: Math.max(Math.ceil(effectiveW || unwrapW), minW),
    needH,
  };
}

export function applySizeMode(t, metrics) {
  const m = metrics || measureTextMetrics(t, { w: t.w, h: t.h });
  const mode = normalizeSizeMode(t);
  let w = t.w;
  let h = t.h;
  if (t.vertical) {
    if (mode === "auto-height") h = Math.max(m.unwrapH, 60);
    else if (mode === "auto-width") w = Math.max(m.needW, 40);
  } else if (mode === "auto-width") {
    w = Math.max(m.unwrapW, 60);
    h = Math.max(m.needH, 32);
  } else if (mode === "auto-height") {
    h = Math.max(m.needH, 32);
  }
  w = Math.max(w, m.minW);
  h = Math.max(h, m.minH);
  t.w = Math.min(Math.max(Math.round(w), BOX_MIN), BOX_MAX);
  t.h = Math.min(Math.max(Math.round(h), BOX_MIN), BOX_MAX);
  t.minW = m.minW;
  t.minH = m.minH;
  return m;
}

export function growBoxForText(t, { hug = false } = {}) {
  const m = measureTextMetrics(t, { h: t.h, w: t.w });
  if (hug) return applySizeMode(t, m);
  t.w = Math.min(Math.max(Math.max(t.w, t.vertical ? m.needW : m.minW), BOX_MIN), BOX_MAX);
  t.h = Math.min(Math.max(Math.max(t.h, m.needH), BOX_MIN), BOX_MAX);
  t.minW = m.minW;
  t.minH = m.minH;
  return m;
}

export function snapshotResize(t, handle) {
  const m = measureTextMetrics(t, t.vertical ? { h: t.h } : { w: t.w });
  return {
    initial: { x: t.x, y: t.y, width: t.w, height: t.h, rotation: t.rotation || 0 },
    minW: Math.max(m.minW, 40),
    minH: Math.max(m.minH, 30),
    handle,
  };
}

function rotatePoint(p, origin, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

export function computeRotatedResize(initialBox, handle, mouse, minWidth, minHeight) {
  const rad = ((initialBox.rotation || 0) * Math.PI) / 180;
  const center = {
    x: initialBox.x + initialBox.width / 2,
    y: initialBox.y + initialBox.height / 2,
  };
  const hw = initialBox.width / 2;
  const hh = initialBox.height / 2;

  let anchorLocal;
  let isCorner = false;
  let affectsWidth = false;
  let affectsHeight = false;
  let widthDir = 1;
  let heightDir = 1;

  switch (handle) {
    case "se":
      anchorLocal = { x: -hw, y: -hh };
      affectsWidth = true;
      affectsHeight = true;
      isCorner = true;
      break;
    case "nw":
      anchorLocal = { x: hw, y: hh };
      affectsWidth = true;
      affectsHeight = true;
      widthDir = -1;
      heightDir = -1;
      isCorner = true;
      break;
    case "ne":
      anchorLocal = { x: -hw, y: hh };
      affectsWidth = true;
      affectsHeight = true;
      heightDir = -1;
      isCorner = true;
      break;
    case "sw":
      anchorLocal = { x: hw, y: -hh };
      affectsWidth = true;
      affectsHeight = true;
      widthDir = -1;
      isCorner = true;
      break;
    case "e":
      anchorLocal = { x: -hw, y: 0 };
      affectsWidth = true;
      break;
    case "w":
      anchorLocal = { x: hw, y: 0 };
      affectsWidth = true;
      widthDir = -1;
      break;
    case "s":
      anchorLocal = { x: 0, y: -hh };
      affectsHeight = true;
      break;
    case "n":
      anchorLocal = { x: 0, y: hh };
      affectsHeight = true;
      heightDir = -1;
      break;
    default:
      return { ...initialBox };
  }

  const anchorWorld = rotatePoint(
    { x: center.x + anchorLocal.x, y: center.y + anchorLocal.y },
    center,
    rad
  );
  const dx = mouse.x - anchorWorld.x;
  const dy = mouse.y - anchorWorld.y;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const localDx = dx * cos - dy * sin;
  const localDy = dx * sin + dy * cos;

  let newWidth = initialBox.width;
  let newHeight = initialBox.height;
  if (affectsWidth) newWidth = Math.max(localDx * widthDir, minWidth);
  if (affectsHeight) newHeight = Math.max(localDy * heightDir, minHeight);

  let fromAnchor;
  if (isCorner) fromAnchor = { x: (newWidth / 2) * widthDir, y: (newHeight / 2) * heightDir };
  else if (affectsWidth) fromAnchor = { x: (newWidth / 2) * widthDir, y: 0 };
  else fromAnchor = { x: 0, y: (newHeight / 2) * heightDir };

  const c2 = Math.cos(rad);
  const s2 = Math.sin(rad);
  const newCenterX = anchorWorld.x + fromAnchor.x * c2 - fromAnchor.y * s2;
  const newCenterY = anchorWorld.y + fromAnchor.x * s2 + fromAnchor.y * c2;

  return {
    x: Math.round(newCenterX - newWidth / 2),
    y: Math.round(newCenterY - newHeight / 2),
    width: Math.round(newWidth),
    height: Math.round(newHeight),
    rotation: initialBox.rotation,
  };
}

export function applyBoxResize(t, snap, mouse) {
  const resized = computeRotatedResize(snap.initial, snap.handle, mouse, snap.minW, snap.minH);
  t.x = resized.x;
  t.y = resized.y;
  t.w = resized.width;
  t.h = resized.height;
  t.sizeMode = "fixed";
  t.minW = snap.minW;
  t.minH = snap.minH;
  t.w = Math.min(Math.max(t.w, BOX_MIN), BOX_MAX);
  t.h = Math.min(Math.max(t.h, BOX_MIN), BOX_MAX);
  return resized.width <= snap.minW + 1 || resized.height <= snap.minH + 1;
}

export function localToWorld(t, lx, ly) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const r = rotateVec(lx - t.w / 2, ly - t.h / 2, t.rotation || 0);
  return { x: cx + r.x, y: cy + r.y };
}
