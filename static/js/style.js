// --- 樣式 ---
import { $$, project, ui, bag, STYLE_FIELDS, STYLE_PRESET_KEY, APPLY_PROPS_KEY, defaultStyle, uid, clamp, fontFileByFamily, loadedFamilies } from "./store.js";
import { t, toastT } from "./copy.js";
import { pushHistory } from "./history.js";
import { markDirty } from "./api.js";
import { selectedText, selectedTexts, syncTextEl, renderTexts, textInnerStyle } from "./text.js";
import { ensureFontLoaded } from "./pages.js";
import { makeMeasureBox } from "./export.js";
function readStyleFromMap(which) {
  const out = defaultStyle();
  for (const field of STYLE_FIELDS) {
    const el = ui[field[which]];
    if (!el) continue;
    if (field.type === "mode") out.vertical = el.value === "vertical";
    else if (field.type === "num") out[field.key] = Number(el.value) || field.fallback;
    else out[field.key] = el.value;
  }
  return out;
}

function writeStyleToMap(which, t) {
  for (const field of STYLE_FIELDS) {
    const el = ui[field[which]];
    if (!el) continue;
    if (field.type === "mode") el.value = t.vertical ? "vertical" : "horizontal";
    else if (field.key === "rotation") el.value = String(Math.round((t.rotation || 0) * 10) / 10);
    else if (field.key === "w" || field.key === "h") el.value = String(Math.round(t[field.key]));
    else if (field.type === "num") el.value = String(t[field.key]);
    else el.value = t[field.key];
  }
}

function readStyleFromForm() {
  return readStyleFromMap("form");
}

function ensureSelectOption(sel, size) {
  if (!sel || sel.tagName !== "SELECT") return;
  const value = String(size);
  if (![...sel.options].some((opt) => opt.value === value)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
  }
}

function ensureFontSizeOption(size) {
  const pick = ui.fontSize?.closest(".size-combo")?.querySelector("select");
  ensureSelectOption(pick, size);
  if (pick) pick.value = String(size);
}

function ensureSpFontSizeOption(size) {
  const pick = ui.spFontSize?.closest(".size-combo")?.querySelector("select");
  ensureSelectOption(pick, size);
  if (pick) pick.value = String(size);
}

function writeStyleToForm(t) {
  ensureFontLoaded(t.font);
  ensureFontSizeOption(t.fontSize);
  writeStyleToMap("form", t);
}

function applyFormToSelected() {
  if (bag.restoring) return;
  if (ui.fontSize === document.activeElement && !validFontSize(ui.fontSize.value)) return;
  if (ui.stylePreset) ui.stylePreset.value = "";
  const s = readStyleFromForm();
  Object.assign(project.defaultStyle, s);
  const targets = selectedTexts();
  if (!targets.length) return;
  if (!bag.styleEditing) {
    pushHistory({ paint: false, projectData: true });
    bag.styleEditing = true;
  }
  for (const t of targets) Object.assign(t, s);
  markDirty();
  if (bag.formSyncRaf) return;
  bag.formSyncRaf = requestAnimationFrame(() => {
    bag.formSyncRaf = 0;
    for (const item of selectedTexts()) syncTextEl(item);
    ensureFontLoaded(project.defaultStyle.font).then(() => {
      for (const item of selectedTexts()) syncTextEl(item);
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

function measureUsedInner(inner) {
  const range = document.createRange();
  range.selectNodeContents(inner);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const cs = getComputedStyle(inner);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  if (!rects.length) {
    return { w: padX, h: padY };
  }
  const w = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
  const h = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top));
  return { w: w + padX, h: h + padY };
}

function measureTextBox(t) {
  const el = makeMeasureBox(t);
  const inner = el.querySelector(".inner");
  el.style.position = "absolute";
  el.style.left = "-99999px";
  el.style.top = "0";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
  el.style.transform = "none";
  el.style.margin = "0";
  document.body.appendChild(el);
  const used = measureUsedInner(inner);
  el.remove();
  const stroke = t.strokeWidth > 0 ? t.strokeWidth * 2 : 0;
  return {
    w: clamp(Math.ceil(used.w + stroke), 20, 2000),
    h: clamp(Math.ceil(used.h + stroke), 20, 3000),
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
    const box = measureTextBox(t);
    if (width) t.w = box.w;
    if (height) t.h = box.h;
    syncTextEl(t);
  }
  const prim = selectedText();
  if (prim) writeStyleToForm(prim);
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
    alignV: true,
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
  if (p.alignH) target.alignH = style.alignH;
  if (p.alignV) target.alignV = style.alignV;
  if (p.color) target.color = style.color;
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
    name.value = p.name;
    name.addEventListener("click", (e) => e.stopPropagation());
    name.addEventListener("focus", () => {
      if (p.id !== bag.editingPresetId) openStyleEditor(p.id);
    });
    name.addEventListener("input", () => {
      p.name = name.value.trim() || t("style.unnamed");
      saveStylePresets();
      fillStylePresetSelect();
    });
    name.addEventListener("change", () => {
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
    row.addEventListener("click", () => {
      if (p.id !== bag.editingPresetId) openStyleEditor(p.id);
    });
    list.appendChild(row);
  }
}

function syncStyleFontSelect() {
  const sel = ui.spFont;
  if (!sel || !ui.fontFamily) return;
  const keep = sel.value;
  sel.replaceChildren();
  for (const opt of ui.fontFamily.options) sel.appendChild(opt.cloneNode(true));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function readStyleFromEditor() {
  return readStyleFromMap("editor");
}

function writeStyleToEditor(t) {
  if (!ui.spFont) return;
  bag.styleEditorBusy = true;
  syncStyleFontSelect();
  if (t.font && ![...ui.spFont.options].some((opt) => opt.value === t.font)) {
    const opt = document.createElement("option");
    opt.value = t.font;
    opt.textContent = t.font;
    ui.spFont.appendChild(opt);
  }
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
  if (s.font && fontFileByFamily.has(s.font) && !loadedFamilies.has(s.font)) {
    ensureFontLoaded(s.font).then(() => paintStylePreview());
  }
  inner.textContent = stylePreviewText();
  inner.style.fontFamily = `"${s.font}"`;
  inner.style.fontSize = Math.min(s.fontSize || 32, 52) + "px";
  inner.style.fontWeight = s.fontWeight;
  inner.style.color = s.color;
  inner.style.webkitTextStroke = s.strokeWidth > 0 ? `${s.strokeWidth}px ${s.strokeColor}` : "0";
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
    if (!box) return;
    const on = box.checked;
    field.classList.toggle("locked", !on);
    $$("input, select, button", field).forEach((el) => {
      if (el === box) return;
      el.disabled = !on;
    });
  });
}

function commitStyleEditor({ list = false } = {}) {
  if (bag.styleEditorBusy) return;
  if (ui.spFontSize === document.activeElement && !validFontSize(ui.spFontSize.value)) return;
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
  name?.focus();
  name?.select();
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
    if (pick) {
      ensureSelectOption(pick, next);
      pick.value = next;
    }
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
};
