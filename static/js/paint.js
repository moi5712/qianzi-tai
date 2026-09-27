// --- 繪製 ---
import { state, ui, bag, clamp } from "./store.js";
import { toastT } from "./copy.js";
import { pushHistory } from "./history.js";
import { saveEraseSoon } from "./api.js";
import { hexToRgb } from "./color.js";
function stampBrush(ctx, x, y, radius, hard, rgb) {
  const inner = Math.max(0, radius * Math.min(hard, 0.999));
  const outer = Math.max(radius, inner + 0.01);
  const g = ctx.createRadialGradient(x, y, inner, x, y, outer);
  const { r, g: gc, b } = rgb;
  g.addColorStop(0, `rgba(${r},${gc},${b},1)`);
  g.addColorStop(1, `rgba(${r},${gc},${b},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, Math.PI * 2);
  ctx.fill();
}

function strokeSegment(x0, y0, x1, y1, erase) {
  const size = Number(ui.brushSize.value);
  const hard = Number(ui.brushHard.value) / 100;
  const ctx = ui.paintCtx;
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  if (hard >= 0.94) {
    ctx.strokeStyle = erase ? "#000" : ui.brushColor.value;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const rgb = erase ? { r: 0, g: 0, b: 0 } : hexToRgb(ui.brushColor.value);
  const radius = Math.max(0.5, size / 2);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(0.5, radius * 0.22);
  if (dist < 0.01) {
    stampBrush(ctx, x0, y0, radius, hard, rgb);
  } else {
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      stampBrush(ctx, x0 + dx * t, y0 + dy * t, radius, hard, rgb);
    }
  }
  ctx.restore();
}

function sampleColor(imgX, imgY) {
  if (!state.imgW || !state.imgH || !ui.paintCtx || !ui.baseCtx) return "";
  const x = clamp(Math.floor(imgX), 0, state.imgW - 1);
  const y = clamp(Math.floor(imgY), 0, state.imgH - 1);
  try {
    const p = ui.paintCtx.getImageData(x, y, 1, 1).data;
    const src = p[3] > 20 ? p : ui.baseCtx.getImageData(x, y, 1, 1).data;
    return "#" + [src[0], src[1], src[2]].map((n) => n.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function paintPickPreview(hex) {
  const el = ui.pickerCursor;
  const swatch = el?.querySelector(".pick-swatch");
  const label = el?.querySelector(".pick-hex");
  if (swatch) swatch.style.background = hex || "transparent";
  if (label) label.textContent = hex || "";
  if (el) el.classList.toggle("has-hex", !!hex);
  const toast = ui.toast;
  if (!toast) return;
  if (!hex) {
    if (toast.classList.contains("pick-live")) {
      toast.classList.remove("pick-live");
      toast.hidden = true;
      toast.textContent = "";
    }
    return;
  }
  clearTimeout(bag.toastTimer);
  toast.classList.add("pick-live");
  toast.hidden = false;
  toast.style.left = "";
  toast.style.top = "";
  let chip = toast.querySelector(".pick-swatch");
  if (!chip) {
    chip = document.createElement("i");
    chip.className = "pick-swatch";
    toast.replaceChildren(chip, document.createTextNode(""));
  }
  chip.style.background = hex;
  const text = chip.nextSibling;
  if (text) text.textContent = hex;
}

function previewPickAt(imgX, imgY) {
  const inside = imgX >= 0 && imgY >= 0 && imgX <= state.imgW && imgY <= state.imgH;
  const hex = inside ? sampleColor(imgX, imgY) : "";
  bag.pickHex = hex;
  paintPickPreview(hex);
  return hex;
}

function applyPickColor(imgX, imgY) {
  const hex = sampleColor(imgX, imgY) || bag.pickHex;
  bag.pickHex = "";
  if (!hex) {
    paintPickPreview("");
    toastT("pickedFail");
    return;
  }
  ui.brushColor.value = hex;
  ui.brushColor.dispatchEvent(new Event("input"));
  paintPickPreview("");
  toastT("picked", { hex });
}

function pickColor(imgX, imgY) {
  applyPickColor(imgX, imgY);
}

function updatePickerCursor(e) {
  const el = ui.pickerCursor;
  if (!el) return;
  let show = (state.tool === "picker" || bag.picking) && !ui.viewport.classList.contains("grabbing");
  if (show && e) {
    const r = ui.viewport.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside && !bag.picking) show = false;
    else {
      el.style.left = e.clientX - r.left + "px";
      el.style.top = e.clientY - r.top + "px";
    }
  }
  el.hidden = !show;
  ui.viewport.classList.toggle("picking", show);
  if (!show) paintPickPreview("");
}

function updateBrushCursor(e) {
  if (ui.brushCursor.hidden) return;
  const r = ui.viewport.getBoundingClientRect();
  const size = Number(ui.brushSize.value) * state.zoom;
  ui.brushCursor.style.width = size + "px";
  ui.brushCursor.style.height = size + "px";
  ui.brushCursor.style.left = e.clientX - r.left + "px";
  ui.brushCursor.style.top = e.clientY - r.top + "px";
}

function updateRectPreview(x0, y0, x1, y1) {
  const left = Math.min(x0, x1) * state.zoom + state.panX;
  const top = Math.min(y0, y1) * state.zoom + state.panY;
  ui.rectPreview.style.left = left + "px";
  ui.rectPreview.style.top = top + "px";
  ui.rectPreview.style.width = Math.abs(x1 - x0) * state.zoom + "px";
  ui.rectPreview.style.height = Math.abs(y1 - y0) * state.zoom + "px";
}

function hideRectPreview() {
  ui.rectPreview.hidden = true;
  ui.rectPreview.style.width = "0px";
  ui.rectPreview.style.height = "0px";
  ui.rectPreview.style.left = "-9999px";
  ui.rectPreview.style.top = "-9999px";
}

function sizeLassoPreview() {
  const c = ui.lassoPreview;
  if (!c || !state.imgW) return;
  if (c.width !== state.imgW) c.width = state.imgW;
  if (c.height !== state.imgH) c.height = state.imgH;
}

function updateLassoPreview(points) {
  const c = ui.lassoPreview;
  const ctx = ui.lassoCtx;
  if (!c || !ctx) return;
  sizeLassoPreview();
  ctx.clearRect(0, 0, c.width, c.height);
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, 1.5 / Math.max(state.zoom, 0.08));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function hideLassoPreview() {
  if (!ui.lassoPreview || !ui.lassoCtx) return;
  ui.lassoCtx.clearRect(0, 0, ui.lassoPreview.width, ui.lassoPreview.height);
  ui.lassoPreview.hidden = true;
}

function lassoArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(area / 2);
}

function fillLasso(points) {
  if (points.length < 3 || lassoArea(points) < 8) return;
  pushHistory({ paint: true, projectData: false });
  const ctx = ui.paintCtx;
  ctx.save();
  ctx.fillStyle = ui.brushColor.value;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  saveEraseSoon();
}

export {
  strokeSegment,
  sampleColor,
  previewPickAt,
  applyPickColor,
  pickColor,
  updatePickerCursor,
  updateBrushCursor,
  updateRectPreview,
  hideRectPreview,
  updateLassoPreview,
  hideLassoPreview,
  fillLasso,
};
