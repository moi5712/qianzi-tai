// --- 樣式 ---
import { $, $$, project, ui, bag, STYLE_FIELDS, STYLE_PRESET_KEY, APPLY_PROPS_KEY, defaultStyle, uid, clamp, fontFacesByFamily, loadedFamilies } from "./store.js";
import { t, toastT } from "./copy.js";
import { pushHistory } from "./history.js";
import { markDirty } from "./api.js";
import { selectedText, selectedTexts, syncTextEl, refreshTextPaint, renderTexts, textInnerStyle, commitInlineText, restoreEditSelection } from "./text.js";
import { growBoxForText, measureTextMetrics, normalizeSizeMode, applySizeMode } from "./boxgeom.js";
import { RUN_KEYS, applyRunStyle, activeCharSel, stripRunKey, applyTextStroke } from "./glyphs.js";
import { ensureFontLoaded } from "./pages.js";
import { fillRange, colorWithAlpha } from "./color.js";
import { listInsertAt, markListInsert, moveArrayItem } from "./dialogue.js";
function unifyAlignH(t) {
  if (t?.alignH === "left" || t?.alignH === "center" || t?.alignH === "right") return t.alignH;
  return { top: "left", middle: "center", bottom: "right" }[t?.alignV] || "center";
}

function alignVFromH(h) {
  return { left: "top", center: "middle", right: "bottom" }[h] || "middle";
}

function syncSeg(seg) {
  const sel = $("#" + seg.dataset.for);
  if (!sel) return;
  $$("button[data-value]", seg).forEach((btn) => {
    const on = btn.dataset.value === sel.value;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (seg.dataset.dirFor) {
    const dir = $("#" + seg.dataset.dirFor);
    seg.classList.toggle("is-vertical", (dir?.value || "vertical") === "vertical");
  }
}

function syncAllSegs() {
  $$(".seg[data-for]").forEach(syncSeg);
}

function bindSegControls() {
  $$(".seg[data-for]").forEach((seg) => {
    if (seg.dataset.bound === "1") return;
    seg.dataset.bound = "1";
    const sel = $("#" + seg.dataset.for);
    if (!sel) return;
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn || btn.disabled || !seg.contains(btn)) return;
      e.preventDefault();
      if (sel.value === btn.dataset.value) return;
      sel.value = btn.dataset.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    sel.addEventListener("input", syncAllSegs);
    sel.addEventListener("change", syncAllSegs);
  });
  syncAllSegs();
}

function readStyleFromMap(which) {
  const out = defaultStyle();
  for (const field of STYLE_FIELDS) {
    const el = ui[field[which]];
    if (!el) continue;
    if (field.type === "mode") out.vertical = el.value === "vertical";
    else if (field.type === "num") {
      const n = Number(el.value);
      out[field.key] = Number.isFinite(n) ? n : field.fallback;
    }
    else out[field.key] = el.value;
  }
  out.alignH = unifyAlignH(out);
  out.alignV = alignVFromH(out.alignH);
  out.opacity = parseOpacity(out.opacity, 100);
  return out;
}

function writeStyleToMap(which, t) {
  for (const field of STYLE_FIELDS) {
    const el = ui[field[which]];
    if (!el) continue;
    if (field.type === "mode") el.value = t.vertical ? "vertical" : "horizontal";
    else if (field.key === "alignH") el.value = unifyAlignH(t);
    else if (field.key === "rotation") el.value = String(Math.round((t.rotation || 0) * 10) / 10);
    else if (field.key === "w" || field.key === "h") el.value = String(Math.round(t[field.key]));
    else if (field.type === "num") {
      const n = Number(t[field.key]);
      el.value = String(Number.isFinite(n) ? n : field.fallback);
    }
    else el.value = t[field.key];
    if (field.key === "opacity") syncOpacityRange(el);
  }
  syncAllSegs();
}

function readStyleFromForm() {
  return readStyleFromMap("form");
}

function syncSelectValue(sel, size) {
  if (!sel || sel.tagName !== "SELECT") return;
  const value = String(size);
  sel.value = [...sel.options].some((opt) => opt.value === value) ? value : "";
}

function ensureFontSizeOption(size) {
  const pick = ui.fontSize?.closest(".size-combo")?.querySelector("select");
  syncSelectValue(pick, size);
}

function ensureSpFontSizeOption(size) {
  const pick = ui.spFontSize?.closest(".size-combo")?.querySelector("select");
  syncSelectValue(pick, size);
}

function writeStyleToForm(t) {
  ensureFontLoaded(t.font, t.fontWeight);
  ensureFontSizeOption(t.fontSize);
  writeStyleToMap("form", t);
  if (ui.sizeMode) ui.sizeMode.value = normalizeSizeMode(t);
  syncAllSegs();
}

const BOX_ONLY_KEYS = ["lineHeight", "letterSpacing"];

function fieldKeyFromEl(el) {
  if (!el) return null;
  if (el.id === "fill-opacity-range" || el.id === "fill-opacity") return "opacity";
  if (el.dataset?.target) {
    const input = $("#" + el.dataset.target);
    if (input) el = input;
  }
  for (const field of STYLE_FIELDS) {
    const input = ui[field.form];
    if (!input) continue;
    if (input === el) return field.key;
    const wrap = input.closest(".num-field, .size-combo, .box-fit-row, .opacity-combo, label");
    if (wrap && wrap.contains(el)) return field.key;
  }
  if (el.closest?.(".opacity-combo") && ui.fillOpacity && el.closest(".opacity-combo").contains(ui.fillOpacity)) {
    return "opacity";
  }
  return null;
}

function beginStyleEdit() {
  if (bag.styleEditing) return;
  pushHistory({ paint: false, projectData: true });
  bag.styleEditing = true;
}

function applyFormToSelected(e) {
  if (bag.restoring) return;
  if (ui.fontSize === document.activeElement && !validFontSize(ui.fontSize.value)) return;
  if (ui.fillOpacity === document.activeElement && !validOpacity(ui.fillOpacity.value)) return;
  if (ui.stylePreset) ui.stylePreset.value = "";
  const s = readStyleFromForm();
  const targets = selectedTexts();
  for (const t of targets) commitInlineText(t);
  if (!targets.length) {
    Object.assign(project.defaultStyle, s);
    return;
  }
  const changed = fieldKeyFromEl(e?.target);
  if (changed && BOX_ONLY_KEYS.includes(changed)) {
    beginStyleEdit();
    for (const t of targets) t[changed] = s[changed];
    project.defaultStyle[changed] = s[changed];
    markDirty();
    paintSelectedTexts(targets);
    return;
  }
  const runKey = !changed || RUN_KEYS.includes(changed);
  const runTargets = [];
  if (runKey) {
    for (const t of targets) {
      const sel = activeCharSel(t.id);
      const textLen = String(t.text || "").length;
      if (sel && (sel.start > 0 || sel.end < textLen)) runTargets.push({ t, sel });
    }
  }
  if (runTargets.length) {
    beginStyleEdit();
    const patch = changed ? { [changed]: s[changed] } : Object.fromEntries(RUN_KEYS.map((k) => [k, s[k]]));
    for (const { t, sel } of runTargets) applyRunStyle(t, sel.start, sel.end, patch);
    markDirty();
    paintSelectedTexts(runTargets.map((x) => x.t));
    return;
  }
  beginStyleEdit();
  Object.assign(project.defaultStyle, s);
  for (const t of targets) {
    Object.assign(t, s);
    if (changed === "w" || changed === "h") t.sizeMode = "fixed";
    if (changed && RUN_KEYS.includes(changed)) stripRunKey(t, changed);
    else if (!changed) for (const k of RUN_KEYS) stripRunKey(t, k);
  }
  markDirty();
  paintSelectedTexts(targets);
}

function paintSelectedTexts(targets) {
  const list = targets || selectedTexts();
  const editingId = bag.inlineEdit?.id;
  const paint = () => {
    for (const item of list) {
      growBoxForText(item);
      refreshTextPaint(item);
    }
    if (editingId) restoreEditSelection(editingId);
    const prim = selectedText();
    if (prim) {
      if (ui.boxW) ui.boxW.value = String(Math.round(prim.w));
      if (ui.boxH) ui.boxH.value = String(Math.round(prim.h));
      if (ui.sizeMode) ui.sizeMode.value = normalizeSizeMode(prim);
    }
  };
  if (bag.formSyncRaf) cancelAnimationFrame(bag.formSyncRaf);
  const token = ++bag.formSyncSeq;
  bag.formSyncRaf = requestAnimationFrame(() => {
    bag.formSyncRaf = 0;
    paint();
    Promise.all(list.flatMap((item) => {
      const jobs = [ensureFontLoaded(item.font, item.fontWeight)];
      for (const run of item.runs || []) {
        jobs.push(ensureFontLoaded(run.font || item.font, run.fontWeight ?? item.fontWeight));
      }
      return jobs;
    })).then(() => {
      if (token === bag.formSyncSeq) paint();
    });
  });
}

function estimateBox(text, style) {
  const lines = (text || "　").split("\n");
  const fs = style.fontSize;
  if (style.vertical) {
    const cols = Math.max(1, lines.length);
    const longest = Math.max(...lines.map((l) => [...l].length), 4);
    return {
      w: Math.ceil(fs * 1.55 * cols + 10),
      h: Math.ceil(fs * style.lineHeight * longest + 14),
    };
  }
  const longest = Math.max(...lines.map((l) => [...l].length), 4);
  return {
    w: Math.ceil(fs * 0.95 * longest + 18),
    h: Math.ceil(fs * style.lineHeight * lines.length + 16),
  };
}

function measureTextBox(t) {
  const m = measureTextMetrics(t, t.vertical ? { h: t.h } : { w: t.w });
  return {
    w: t.vertical ? m.needW : m.unwrapW,
    h: t.vertical ? m.unwrapH : m.needH,
  };
}

function fitSelectedBoxes({ width = true, height = true } = {}) {
  const targets = selectedTexts();
  if (!targets.length) {
    toastT("selectFirst");
    return;
  }
  pushHistory({ paint: false, projectData: true });
  for (const t of targets) {
    commitInlineText(t);
    if (width && height) t.sizeMode = t.vertical ? "auto-width" : "auto-height";
    else if (width) t.sizeMode = "auto-width";
    else if (height) t.sizeMode = "auto-height";
    const box = measureTextBox(t);
    if (width) t.w = box.w;
    if (height) t.h = box.h;
    applySizeMode(t);
    syncTextEl(t, { layoutOnly: bag.inlineEdit?.id === t.id });
  }
  const prim = selectedText();
  if (prim) writeStyleToForm(prim);
  markDirty();
}

function applySizeModeToSelected(mode) {
  const targets = selectedTexts();
  if (!targets.length) return;
  beginStyleEdit();
  for (const t of targets) {
    commitInlineText(t);
    t.sizeMode = mode;
    if (mode !== "fixed") applySizeMode(t);
    syncTextEl(t, { layoutOnly: bag.inlineEdit?.id === t.id });
  }
  const prim = selectedText();
  if (prim) {
    if (ui.boxW) ui.boxW.value = String(Math.round(prim.w));
    if (ui.boxH) ui.boxH.value = String(Math.round(prim.h));
  }
  markDirty();
}

function rememberApplyProps() {
  const props = $$(".apply-box [data-prop]").map((el) => [el.dataset.prop, el.checked]);
  try {
    localStorage.setItem(APPLY_PROPS_KEY, JSON.stringify(Object.fromEntries(props)));
  } catch {
    /* ignore */
  }
}

function restoreApplyProps() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPLY_PROPS_KEY) || "");
    if (!saved || typeof saved !== "object") return;
    $$(".apply-box [data-prop]").forEach((el) => {
      if (Object.prototype.hasOwnProperty.call(saved, el.dataset.prop)) {
        el.checked = !!saved[el.dataset.prop];
      }
    });
  } catch {
    /* ignore */
  }
}

function defaultPresetProps() {
  return {
    font: true,
    fontSize: true,
    fontWeight: true,
    vertical: true,
    alignH: true,
    color: true,
    stroke: true,
    lineHeight: false,
    letterSpacing: false,
    rotation: false,
    box: false,
  };
}

function defaultPresets() {
  const base = defaultStyle();
  return [
    normalizePreset({
      id: "preset-dialogue",
      name: t("style.presetSpeech"),
      style: { ...base },
      props: defaultPresetProps(),
    }),
    normalizePreset({
      id: "preset-narration",
      name: t("style.presetNarration"),
      style: { ...base, fontSize: 28, fontWeight: 500, strokeWidth: 0 },
      props: defaultPresetProps(),
    }),
    normalizePreset({
      id: "preset-sfx",
      name: t("style.presetSfx"),
      style: { ...base, fontSize: 56, fontWeight: 900, strokeWidth: 4 },
      props: defaultPresetProps(),
    }),
  ];
}

function normalizePreset(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id: String(p.id || uid("sp")),
    name: String(p.name || t("style.unnamed")).slice(0, 40),
    style: { ...defaultStyle(), ...(p.style || {}) },
    props: { ...defaultPresetProps(), ...(p.props || {}) },
    isDefault: !!p.isDefault,
  };
}

function defaultStylePreset() {
  return bag.stylePresets.find((p) => p.isDefault) || null;
}

function styleForNewText() {
  const next = { ...project.defaultStyle, ...readStyleFromForm() };
  const preset = defaultStylePreset();
  if (preset) applyPresetToStyle(next, preset);
  return next;
}

function setPresetAsDefault(on) {
  for (const x of bag.stylePresets) x.isDefault = false;
  const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
  if (p) p.isDefault = !!on;
  if (ui.spIsDefault) ui.spIsDefault.checked = !!(p && p.isDefault);
  saveStylePresets();
  renderStylePresetList();
}

function loadStylePresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(STYLE_PRESET_KEY) || "null");
    if (Array.isArray(raw)) {
      bag.stylePresets = raw.map(normalizePreset).filter(Boolean);
      let seen = false;
      for (const p of bag.stylePresets) {
        if (!p.isDefault) continue;
        if (seen) p.isDefault = false;
        seen = true;
      }
      return;
    }
  } catch {
    /* ignore */
  }
  bag.stylePresets = defaultPresets();
  saveStylePresets();
}

function saveStylePresets() {
  try {
    localStorage.setItem(STYLE_PRESET_KEY, JSON.stringify(bag.stylePresets));
  } catch {
    /* ignore */
  }
}

function bindSelectWheel(sel, opts = {}) {
  if (!sel) return;
  const host = opts.host || sel;
  host.addEventListener("wheel", (e) => {
    if (e.target.closest("button")) return;
    const options = [...sel.options].filter((opt) => !opt.disabled && (!opts.skipEmpty || opt.value));
    if (options.length < 2) return;
    const dy = e.deltaY || e.deltaX;
    if (!dy) return;
    e.preventDefault();
    const dir = dy > 0 ? 1 : -1;
    let i = options.indexOf(sel.options[sel.selectedIndex]);
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = options[(i + dir + options.length) % options.length];
    if (!next || next.value === sel.value) return;
    sel.value = next.value;
    bag.styleInputVia = "wheel";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    bag.styleInputVia = "";
  }, { passive: false });
}

function stepStyledNumber(input, dir) {
  if (!input) return;
  if (input === ui.fontSize || input === ui.spFontSize) {
    const next = clamp(parseFontSize(input.value) + dir, 8, 240);
    input.value = String(next);
    const pick = input.closest(".size-combo")?.querySelector("select");
    if (pick) syncSelectValue(pick, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (input === ui.fillOpacity || input === ui.spFillOpacity) {
    input.value = String(clamp(parseOpacity(input.value) + dir, 0, 100));
    syncOpacityRange(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  stepNumberInput(input, dir);
}

function bindNumberWheel(input) {
  if (!input) return;
  const host = input.closest(".num-field, .size-combo, .opacity-combo") || input;
  if (host.dataset.wheelBound === "1") return;
  host.dataset.wheelBound = "1";
  host.addEventListener("wheel", (e) => {
    if (e.target.closest("button")) return;
    const dy = e.deltaY || e.deltaX;
    if (!dy) return;
    e.preventDefault();
    bag.styleInputVia = "wheel";
    stepStyledNumber(input, dy > 0 ? -1 : 1);
    bag.styleInputVia = "";
  }, { passive: false });
}

function fillStylePresetSelect() {
  const sel = ui.stylePreset;
  if (!sel) return;
  const keep = sel.value;
  sel.replaceChildren();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = t("style.choose");
  sel.appendChild(blank);
  for (const p of bag.stylePresets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = bag.stylePresets.some((p) => p.id === keep) ? keep : "";
}

function applyStyleProps(target, style, props) {
  const p = { ...defaultPresetProps(), ...props };
  if (p.font) target.font = style.font;
  if (p.fontSize) target.fontSize = style.fontSize;
  if (p.fontWeight) target.fontWeight = style.fontWeight;
  if (p.vertical) target.vertical = style.vertical;
  if (p.alignH) {
    target.alignH = unifyAlignH(style);
    target.alignV = alignVFromH(target.alignH);
  }
  if (p.color) {
    target.color = style.color;
    target.opacity = parseOpacity(style.opacity, 100);
  }
  if (p.stroke) {
    target.strokeColor = style.strokeColor;
    target.strokeWidth = style.strokeWidth;
  }
  if (p.lineHeight) target.lineHeight = style.lineHeight;
  if (p.letterSpacing) target.letterSpacing = style.letterSpacing;
  if (p.rotation) target.rotation = style.rotation;
  if (p.box) {
    target.w = style.w;
    target.h = style.h;
  }
}

function checkedApplyProps() {
  const flags = {};
  for (const key of Object.keys(defaultPresetProps())) flags[key] = false;
  $$(".apply-box [data-prop]:checked").forEach((el) => {
    flags[el.dataset.prop] = true;
  });
  return flags;
}

function applyPresetToStyle(target, preset) {
  applyStyleProps(target, { ...defaultStyle(), ...preset.style }, preset.props);
}

function applyStylePreset(id) {
  const preset = bag.stylePresets.find((p) => p.id === id);
  if (!preset) return;
  bag.restoring = true;
  const next = { ...project.defaultStyle };
  applyPresetToStyle(next, preset);
  writeStyleToForm(next);
  Object.assign(project.defaultStyle, next);
  bag.restoring = false;
  const targets = selectedTexts();
  if (targets.length) {
    pushHistory({ paint: false, projectData: true });
    for (const t of targets) {
      applyPresetToStyle(t, preset);
      syncTextEl(t);
    }
    markDirty();
  }
  toastT("presetApplied", { name: preset.name });
}

function renderStylePresetList() {
  const list = ui.stylePresetList;
  if (!list) return;
  list.replaceChildren();
  if (!bag.stylePresets.length) {
    const empty = document.createElement("div");
    empty.className = "style-preset-empty";
    empty.textContent = t("style.empty");
    list.appendChild(empty);
    return;
  }
  for (const p of bag.stylePresets) {
    const row = document.createElement("div");
    row.dataset.id = p.id;
    row.className = "style-preset-item" + (p.id === bag.editingPresetId ? " selected" : "");
    const name = document.createElement("input");
    name.type = "text";
    name.className = "style-preset-name";
    name.maxLength = 40;
    name.spellcheck = false;
    name.readOnly = true;
    name.value = p.name;
    name.addEventListener("click", (e) => {
      e.stopPropagation();
      if (p.id !== bag.editingPresetId) openStyleEditor(p.id);
    });
    name.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (p.id !== bag.editingPresetId) openStyleEditor(p.id);
      name.readOnly = false;
      name.focus();
      name.select();
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
      if (e.key === "Escape") {
        name.value = p.name;
        name.blur();
      }
    });
    name.addEventListener("input", () => {
      if (name.readOnly) return;
      p.name = name.value.trim() || t("style.unnamed");
      saveStylePresets();
      fillStylePresetSelect();
    });
    name.addEventListener("blur", () => {
      name.readOnly = true;
      if (!name.value.trim()) name.value = p.name;
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "style-item-del";
    del.setAttribute("aria-label", t("style.deleteAria"));
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      bag.editingPresetId = p.id;
      deleteStylePreset();
    });
    if (p.isDefault) {
      const mark = document.createElement("span");
      mark.className = "style-preset-default";
      mark.textContent = t("style.defaultMark");
      row.append(name, mark, del);
    } else {
      row.append(name, del);
    }
    row.draggable = true;
    name.draggable = false;
    name.addEventListener("pointerdown", () => {
      row.draggable = name.readOnly;
    });
    name.addEventListener("pointerup", () => {
      row.draggable = true;
    });
    row.addEventListener("dragstart", (e) => {
      if (!name.readOnly) {
        e.preventDefault();
        return;
      }
      bag.styleDrag = { id: p.id, moved: false };
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearStyleDropMarks();
      row.draggable = true;
      setTimeout(() => {
        bag.styleDrag = { id: null, moved: false };
      }, 0);
    });
    row.addEventListener("click", () => {
      if (bag.styleDrag.moved) return;
      if (p.id !== bag.editingPresetId) openStyleEditor(p.id);
    });
    list.appendChild(row);
  }
  bindStylePresetSort();
}

function clearStyleDropMarks() {
  $$(".style-preset-item.drop-before, .style-preset-item.drop-after, .style-preset-item.dragging").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "dragging");
  });
}

function moveStylePreset(fromId, insertAt) {
  const from = bag.stylePresets.findIndex((p) => p.id === fromId);
  if (!moveArrayItem(bag.stylePresets, from, insertAt)) return;
  saveStylePresets();
  fillStylePresetSelect();
  renderStylePresetList();
}

function bindStylePresetSort() {
  const list = ui.stylePresetList;
  if (!list || list.dataset.sortBound) return;
  list.dataset.sortBound = "1";
  list.addEventListener("dragover", (e) => {
    if (!bag.styleDrag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    bag.styleDrag.moved = true;
    const items = $$(".style-preset-item", list);
    markListInsert(items, listInsertAt(items, e.clientY));
  });
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") || bag.styleDrag.id;
    const items = $$(".style-preset-item", list);
    const at = listInsertAt(items, e.clientY);
    clearStyleDropMarks();
    if (fromId) moveStylePreset(fromId, at);
  });
}

function syncStyleFontSelect() {
  const sel = ui.spFont;
  if (!sel || !ui.fontFamily) return;
  const keep = sel.value;
  sel.replaceChildren();
  for (const node of ui.fontFamily.childNodes) sel.appendChild(node.cloneNode(true));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function readStyleFromEditor() {
  return readStyleFromMap("editor");
}

function writeStyleToEditor(t) {
  if (!ui.spFont) return;
  bag.styleEditorBusy = true;
  syncStyleFontSelect();
  ensureSpFontSizeOption(t.fontSize);
  writeStyleToMap("editor", t);
  bag.styleEditorBusy = false;
}

function stylePreviewText() {
  return t("preview.sample");
}

function paintStylePreview() {
  const inner = ui.stylePreviewInner;
  const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
  if (!inner || !p) return;
  const s = p.style;
  if (s.font && fontFacesByFamily.has(s.font) && !loadedFamilies.has(s.font)) {
    ensureFontLoaded(s.font, s.fontWeight).then(() => paintStylePreview());
  }
  inner.textContent = stylePreviewText();
  inner.style.fontFamily = `"${s.font}"`;
  inner.style.fontSize = Math.min(s.fontSize || 32, 52) + "px";
  inner.style.fontWeight = s.fontWeight;
  inner.style.color = colorWithAlpha(s.color, s.opacity);
  applyTextStroke(inner, s.strokeWidth, s.strokeColor);
  inner.style.lineHeight = String(s.lineHeight);
  inner.style.letterSpacing = s.letterSpacing + "px";
  inner.style.writingMode = s.vertical ? "vertical-rl" : "horizontal-tb";
  inner.style.textOrientation = "mixed";
  inner.style.textAlign = textInnerStyle(s).textAlign;
  inner.style.transform = `rotate(${s.rotation || 0}deg)`;
}

function applyCurrentFormToPreset() {
  const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
  if (!p) return;
  p.style = { ...defaultStyle(), ...p.style, ...readStyleFromForm() };
  writeStyleToEditor(p.style);
  saveStylePresets();
  paintStylePreview();
  toastT("presetFromCurrent");
}

function fillStyleEditor() {
  const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
  if (!ui.styleEditor) return;
  ui.styleEditor.hidden = !p;
  if (!p) return;
  if (ui.spIsDefault) ui.spIsDefault.checked = !!p.isDefault;
  $$("#style-editor [data-prop]").forEach((el) => {
    el.checked = !!p.props[el.dataset.prop];
  });
  writeStyleToEditor(p.style);
  paintStylePreview();
  syncStyleEditorLocks();
}

function syncStyleEditorLocks() {
  $$(".style-edit-form > .style-field").forEach((field) => {
    const box = field.querySelector("[data-prop]");
    const lockProp = field.dataset.lock;
    const lockBox = lockProp
      ? document.querySelector(`.style-edit-form [data-prop="${lockProp}"]`)
      : box;
    if (!lockBox) return;
    const on = lockBox.checked;
    field.classList.toggle("locked", !on);
    $$("input, select, button", field).forEach((el) => {
      if (el === box || el === lockBox) return;
      el.disabled = !on;
    });
  });
}

function commitStyleEditor({ list = false } = {}) {
  if (bag.styleEditorBusy) return;
  if (ui.spFontSize === document.activeElement && !validFontSize(ui.spFontSize.value)) return;
  if (ui.spFillOpacity === document.activeElement && !validOpacity(ui.spFillOpacity.value)) return;
  const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
  if (!p) return;
  p.style = readStyleFromEditor();
  saveStylePresets();
  paintStylePreview();
  if (list) renderStylePresetList();
}

function openStyleEditor(id) {
  bag.editingPresetId = id;
  fillStyleEditor();
  $$(".style-preset-item", ui.stylePresetList).forEach((row) => {
    row.classList.toggle("selected", row.dataset.id === id);
  });
}

function openStyleModal() {
  if (!ui.styleModal) return;
  if (!bag.editingPresetId || !bag.stylePresets.some((p) => p.id === bag.editingPresetId)) {
    bag.editingPresetId = bag.stylePresets[0]?.id || "";
  }
  ui.styleModal.hidden = false;
  fillStyleEditor();
  renderStylePresetList();
}

function addStylePreset() {
  const p = normalizePreset({
    id: uid("sp"),
    name: t("style.newName", { n: bag.stylePresets.length + 1 }),
    style: readStyleFromForm(),
    props: defaultPresetProps(),
  });
  bag.stylePresets.push(p);
  bag.editingPresetId = p.id;
  saveStylePresets();
  fillStylePresetSelect();
  fillStyleEditor();
  renderStylePresetList();
  const name = ui.stylePresetList?.querySelector(".style-preset-item.selected .style-preset-name");
  if (name) {
    name.readOnly = false;
    name.focus();
    name.select();
  }
}

function deleteStylePreset() {
  if (!bag.editingPresetId) return;
  bag.stylePresets = bag.stylePresets.filter((p) => p.id !== bag.editingPresetId);
  bag.editingPresetId = bag.stylePresets[0]?.id || "";
  saveStylePresets();
  fillStylePresetSelect();
  fillStyleEditor();
  renderStylePresetList();
}

function applyStyleToTexts(texts, { allPages = false } = {}) {
  pushHistory({ paint: false, projectData: true, allPages });
  const s = readStyleFromForm();
  const props = checkedApplyProps();
  for (const t of texts) applyStyleProps(t, s, props);
  Object.assign(project.defaultStyle, s);
  renderTexts();
  markDirty();
}

function stepNumberInput(input, dir) {
  const raw = Number(input.step);
  const step = Number.isFinite(raw) && raw > 0 ? raw : 1;
  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  const decimals = Math.max(0, (String(step).split(".")[1] || "").length);
  const current = Number(input.value);
  let next = (Number.isFinite(current) ? current : 0) + dir * step;
  next = Math.round(next / step) * step;
  next = clamp(next, min, max);
  input.value = decimals ? String(Number(next.toFixed(decimals))) : String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function validFontSize(value) {
  const n = Number(String(value).trim());
  return Number.isFinite(n) && n >= 8 && n <= 240;
}

function parseFontSize(value, fallback = 32) {
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), 8, 240);
}

function validOpacity(value) {
  const s = String(value).trim();
  if (s === "") return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function parseOpacity(value, fallback = 100) {
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), 0, 100);
}

function syncOpacityRange(input) {
  const range = input?.closest(".opacity-combo")?.querySelector("input[type='range']");
  if (!range) return;
  range.value = String(parseOpacity(input.value, Number(range.value) || 100));
  fillRange(range);
}

function bindOpacityCombo(input, onCommit) {
  if (!input) return;
  const range = input.closest(".opacity-combo")?.querySelector("input[type='range']");
  const commit = () => {
    input.value = String(parseOpacity(input.value, 100));
    syncOpacityRange(input);
    onCommit?.();
  };
  input.addEventListener("focus", () => {
    bag.styleEditing = false;
  });
  input.addEventListener("change", commit);
  input.addEventListener("blur", () => {
    const next = String(parseOpacity(input.value, 100));
    if (input.value !== next) input.value = next;
    syncOpacityRange(input);
    onCommit?.();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });
  range?.addEventListener("pointerdown", () => {
    bag.styleEditing = false;
  });
  range?.addEventListener("input", () => {
    input.value = range.value;
    fillRange(range);
    onCommit?.();
  });
  syncOpacityRange(input);
}

function bindFontSizeInput(input) {
  if (!input) return;
  const pick = input.closest(".size-combo")?.querySelector("select");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    const next = String(parseFontSize(input.value));
    if (input.value !== next) {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (pick) syncSelectValue(pick, next);
  });
  pick?.addEventListener("change", () => {
    input.value = pick.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function decorateNumberInputs() {
  $$(".grid-form input[type='number']").forEach((input) => {
    if (input.closest(".num-field")) return;
    const wrap = document.createElement("span");
    wrap.className = "num-field";
    input.after(wrap);
    wrap.append(input);
    const spin = document.createElement("span");
    spin.className = "num-spin";
    spin.innerHTML = '<button type="button" tabindex="-1" data-dir="1"></button><button type="button" tabindex="-1" data-dir="-1"></button>';
    wrap.append(spin);
    spin.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.preventDefault();
      stepNumberInput(input, Number(btn.dataset.dir));
    });
  });
  bindFontSizeInput(ui.fontSize);
  bindFontSizeInput(ui.spFontSize);
  bindSegControls();
  bindOpacityCombo(ui.fillOpacity, () => applyFormToSelected({ target: ui.fillOpacity }));
  bindOpacityCombo(ui.spFillOpacity, () => commitStyleEditor());
  $$(".grid-form input[type='number']").forEach(bindNumberWheel);
  bindNumberWheel(ui.fontSize);
  bindNumberWheel(ui.fillOpacity);
}

export {
  writeStyleToForm,
  applyFormToSelected,
  estimateBox,
  fitSelectedBoxes,
  rememberApplyProps,
  restoreApplyProps,
  styleForNewText,
  setPresetAsDefault,
  loadStylePresets,
  saveStylePresets,
  fillStylePresetSelect,
  applyStylePreset,
  syncStyleFontSelect,
  applyCurrentFormToPreset,
  syncStyleEditorLocks,
  commitStyleEditor,
  openStyleModal,
  addStylePreset,
  deleteStylePreset,
  applyStyleToTexts,
  decorateNumberInputs,
  bindSelectWheel,
  applySizeModeToSelected,
};
