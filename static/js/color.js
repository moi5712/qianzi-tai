// --- 色盤 ---
import { $, $$, bag, SWATCH_KEY, SWATCH_MAX, clamp } from "./store.js";
import { t, toastT, setStatusHint, toolHint } from "./copy.js";
import { syncStyleEditorLocks } from "./style.js";
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return { r: 26, g: 26, b: 26 };
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function normalizeSwatchList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((c) => normalizeHex(String(c || ""))).filter(Boolean))];
}

function swatchStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(SWATCH_KEY) || "{}");
    if (Array.isArray(raw)) {
      const migrated = { "fill-color": normalizeSwatchList(raw), "stroke-color": [] };
      localStorage.setItem(SWATCH_KEY, JSON.stringify(migrated));
      return migrated;
    }
    if (raw && typeof raw === "object") return raw;
  } catch {
    /* ignore */
  }
  return {};
}

function swatchStoreKey(id) {
  if (id === "sp-fill-color") return "fill-color";
  if (id === "sp-stroke-color") return "stroke-color";
  return id || "fill-color";
}

function loadSwatches(target = "fill-color") {
  return normalizeSwatchList(swatchStore()[swatchStoreKey(target)]);
}

function saveSwatches(target, list) {
  try {
    const all = swatchStore();
    all[swatchStoreKey(target)] = normalizeSwatchList(list);
    localStorage.setItem(SWATCH_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function setColorTarget(id) {
  if (!id || !$("#" + id)) return;
  bag.lastColorInputId = id;
}

function applyColorValue(id, hex) {
  const input = $("#" + id);
  if (!input) return;
  input.value = normalizeHex(hex);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderSwatches() {
  $$(".swatch-list").forEach((list) => {
    const target = list.closest(".color-picks")?.dataset.colorInput || "fill-color";
    list.innerHTML = "";
    for (const hex of loadSwatches(target)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip chip-swatch";
      btn.style.background = hex;
      btn.addEventListener("pointerenter", () => setStatusHint(t("hints.swatchRemove", { hex })));
      btn.addEventListener("pointerleave", () => setStatusHint(toolHint()));
      btn.addEventListener("click", () => applyColorValue(target, hex));
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        removeSwatch(hex, target);
      });
      list.appendChild(btn);
    }
  });
  syncStyleEditorLocks();
}

function addSwatch(hex, target = bag.lastColorInputId) {
  const key = target || "fill-color";
  const color = normalizeHex(hex);
  const list = loadSwatches(key);
  if (list.includes(color)) {
    toastT("swatchDup");
    return;
  }
  if (list.length >= SWATCH_MAX) {
    toastT("swatchFull", { n: SWATCH_MAX });
    return;
  }
  list.push(color);
  saveSwatches(key, list);
  renderSwatches();
  toastT("swatchAdd");
}

function removeSwatch(hex, target = bag.lastColorInputId) {
  const key = target || "fill-color";
  saveSwatches(key, loadSwatches(key).filter((c) => c !== normalizeHex(hex)));
  renderSwatches();
  toastT("swatchRemove");
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function bindColorPopover() {
  const pop = $("#color-popover");
  const sv = $("#color-sv");
  const hueEl = $("#color-hue");
  const hexEl = $("#color-hex");
  const preview = $("#color-preview");
  if (!pop || !sv || !hueEl || !hexEl || !preview) return;
  const ctx = sv.getContext("2d", { willReadFrequently: true });
  let target = null;
  let hsv = { h: 0, s: 0, v: 0.1 };
  let dragging = "";
  let fromPopover = false;

  const currentHex = () => {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  };

  const paintSv = () => {
    const w = sv.width;
    const h = sv.height;
    ctx.clearRect(0, 0, w, h);
    const hue = hsvToRgb(hsv.h, 1, 1);
    ctx.fillStyle = rgbToHex(hue.r, hue.g, hue.b);
    ctx.fillRect(0, 0, w, h);
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, "#fff");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, h);
    const black = ctx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "#000");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, h);
    const px = hsv.s * (w - 1);
    const py = (1 - hsv.v) * (h - 1);
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const syncUi = (push) => {
    const hex = currentHex();
    hexEl.value = hex;
    preview.style.background = hex;
    hueEl.value = String(Math.round(hsv.h));
    paintSv();
    if (push && target) {
      fromPopover = true;
      target.value = hex;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      fromPopover = false;
    }
  };

  const loadFrom = (input) => {
    const rgb = hexToRgb(input.value);
    hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    syncUi(false);
  };

  const place = () => {
    if (!target || pop.hidden) return;
    const r = target.getBoundingClientRect();
    const w = pop.offsetWidth || 212;
    const h = pop.offsetHeight || 200;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + w > innerWidth - 8) left = innerWidth - w - 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = top + "px";
  };

  const close = () => {
    pop.hidden = true;
    target = null;
    dragging = "";
  };

  const open = (input) => {
    target = input;
    setColorTarget(input.id);
    pop.hidden = false;
    loadFrom(input);
    place();
  };

  const pickSv = (e) => {
    const r = sv.getBoundingClientRect();
    hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
    hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    syncUi(true);
  };

  $$("input[type='color']").forEach((input) => {
    input.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (target === input && !pop.hidden) close();
      else open(input);
    });
    input.addEventListener("click", (e) => e.preventDefault());
    input.addEventListener("input", () => {
      if (!fromPopover && target === input && !pop.hidden) loadFrom(input);
    });
  });

  hueEl.addEventListener("input", () => {
    hsv.h = Number(hueEl.value) || 0;
    syncUi(true);
  });
  hexEl.addEventListener("change", () => {
    const rgb = hexToRgb(hexEl.value);
    hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    syncUi(true);
  });
  sv.addEventListener("pointerdown", (e) => {
    dragging = "sv";
    sv.setPointerCapture(e.pointerId);
    pickSv(e);
  });
  sv.addEventListener("pointermove", (e) => {
    if (dragging === "sv") pickSv(e);
  });
  sv.addEventListener("pointerup", () => {
    dragging = "";
  });
  document.addEventListener("pointerdown", (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || e.target === target) return;
    close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, true);
  const popAdd = $("#btn-pop-swatch");
  if (popAdd) {
    popAdd.addEventListener("pointerdown", (e) => e.stopPropagation());
    popAdd.addEventListener("click", () => addSwatch(currentHex(), target ? target.id : bag.lastColorInputId));
  }
}

function fillRange(el) {
  if (!el) return;
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const pct = ((Number(el.value) - min) / (max - min)) * 100;
  el.style.setProperty("--p", pct + "%");
}

export {
  hexToRgb,
  setColorTarget,
  renderSwatches,
  addSwatch,
  bindColorPopover,
  fillRange,
};
