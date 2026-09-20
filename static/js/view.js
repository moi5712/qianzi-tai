// --- 檢視與工具 ---
import { $, $$, state, ui, bag, clamp } from "./store.js";
import { t, toolHint, setStatusHint, actionHint } from "./copy.js";
import { renderDialogue } from "./dialogue.js";
import { updatePickerCursor } from "./paint.js";
function rotateVec(x, y, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

function clientToImage(cx, cy) {
  const r = ui.viewport.getBoundingClientRect();
  return {
    x: (cx - r.left - state.panX) / state.zoom,
    y: (cy - r.top - state.panY) / state.zoom,
  };
}

function zoomAt(clientX, clientY, nextZoom) {
  const r = ui.viewport.getBoundingClientRect();
  const cx = clientX - r.left;
  const cy = clientY - r.top;
  const wx = (cx - state.panX) / state.zoom;
  const wy = (cy - state.panY) / state.zoom;
  state.zoom = clamp(nextZoom, 0.05, 8);
  state.panX = cx - wx * state.zoom;
  state.panY = cy - wy * state.zoom;
  applyView();
}

function updateStatusPage() {
  if (!ui.statusPage) return;
  if (!state.pageName || !state.pages.length) {
    ui.statusPage.textContent = t("status.noPages");
    return;
  }
  const idx = state.pages.findIndex((p) => p.name === state.pageName) + 1;
  const size = state.imgW && state.imgH ? `　${state.imgW}×${state.imgH}` : "";
  ui.statusPage.textContent = `${state.pageName}　${idx}/${state.pages.length}${size}`;
}

function setDialogueFilter(filter, { render = true } = {}) {
  state.dialogueFilter = filter || "all";
  $$(".filters button").forEach((x) => {
    const on = x.dataset.filter === state.dialogueFilter;
    x.classList.toggle("on", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (render) renderDialogue();
}

function applyView() {
  ui.world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  syncZoomSelect();
  if (ui.texts) ui.texts.style.setProperty("--handle-scale", String(1 / Math.max(state.zoom, 0.08)));
}

function syncZoomSelect() {
  const pct = Math.round(state.zoom * 100) + "%";
  if (ui.zoomFace) ui.zoomFace.textContent = pct;
  if (!ui.zoomLabel) return;
  const match = [...ui.zoomLabel.options].find((opt) => Math.abs(Number(opt.value) * 100 - Math.round(state.zoom * 100)) < 0.6);
  if (match) ui.zoomLabel.value = match.value;
}

function setZoomLevel(zoom) {
  const r = ui.viewport.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, Number(zoom) || 1);
}

function fitPage() {
  if (!state.imgW) return;
  const vw = ui.viewport.clientWidth - 48;
  const vh = ui.viewport.clientHeight - 48;
  state.zoom = clamp(Math.min(vw / state.imgW, vh / state.imgH), 0.05, 4);
  state.panX = (ui.viewport.clientWidth - state.imgW * state.zoom) / 2;
  state.panY = (ui.viewport.clientHeight - state.imgH * state.zoom) / 2;
  applyView();
}

function applyCompare() {
  const orig = state.showOriginal;
  const hidePaint = state.hidePaint;
  ui.paint.style.visibility = orig || hidePaint ? "hidden" : "visible";
  ui.texts.style.visibility = orig ? "hidden" : "visible";
  const origBtn = $("#btn-hide-text");
  if (origBtn) origBtn.classList.toggle("on", orig);
  const paintBtn = $("#btn-hide-paint");
  if (paintBtn) paintBtn.classList.toggle("on", hidePaint);
  if (bag.hoveredAction && actionHint(bag.hoveredAction)) setStatusHint(actionHint(bag.hoveredAction));
}

function clearToolHold() {
  clearTimeout(bag.toolHold.timer);
  bag.toolHold = { code: null, prev: null, long: false, timer: 0 };
}

function setTool(tool, { temp = false } = {}) {
  if (!temp) clearToolHold();
  if ((state.showOriginal || state.hidePaint) && ["brush", "eraser", "rect", "lasso"].includes(tool)) {
    state.showOriginal = false;
    state.hidePaint = false;
    applyCompare();
  }
  state.tool = tool;
  $$("#tools button").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
  const keep = ["selecting", "grabbing", "picking"].filter((c) => ui.viewport.classList.contains(c));
  ui.viewport.className = "tool-" + tool;
  ui.viewport.id = "viewport";
  for (const c of keep) ui.viewport.classList.add(c);
  setStatusHint(toolHint(tool));
  const textInteractive = tool === "select" || tool === "text";
  ui.texts.style.pointerEvents = textInteractive ? "auto" : "none";
  ui.brushCursor.hidden = !["brush", "eraser"].includes(tool);
  updatePickerCursor();
}

export {
  rotateVec,
  clientToImage,
  zoomAt,
  updateStatusPage,
  setDialogueFilter,
  applyView,
  setZoomLevel,
  fitPage,
  applyCompare,
  clearToolHold,
  setTool,
};
