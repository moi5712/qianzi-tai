// --- 文字框 ---
import { $$, state, project, ui, bag, uid, currentTexts, pageEntry, usedDialogueIds, selectedDialogueList, selectDialogues, clearDialogueSelection, fontFamilyCss } from "./store.js";
import { t, toastT } from "./copy.js";
import { pushHistory } from "./history.js";
import { markDirty } from "./api.js";
import { applyView, rotateVec, setDialogueFilter } from "./view.js";
import { writeStyleToForm, styleForNewText, estimateBox } from "./style.js";
import { placedPageOf, renderDialogue, syncDialogueFromText } from "./dialogue.js";
import { ensureFontsForTexts, loadPage } from "./pages.js";
import { colorWithAlpha } from "./color.js";
import { fillTextInner, clampRuns, restoreCharSel, caretOffsetFromPoint, placeCaret, caretOffset, readInnerText, clearCharSel, activeCharSel, paintCharHighlight, applyTextStroke } from "./glyphs.js";
import { applySizeMode, measureTextMetrics } from "./boxgeom.js";
function nextUnplacedInScope(scope) {
  const used = usedDialogueIds();
  return project.dialogue.find((d) => {
    if (used.has(d.id)) return false;
    return (d.pageName || "") === scope;
  }) || null;
}

function addTextBox(item, imgX, imgY, style, offset = 0) {
  const text = item ? item.text : "";
  const box = estimateBox(text || t("ui.measureSample"), style);
  const boxEl = {
    id: uid("t"),
    dialogueId: item ? item.id : null,
    text: text || "",
    x: imgX - box.w / 2 + offset,
    y: imgY - box.h / 2 + offset,
    ...style,
    w: box.w,
    h: box.h,
    sizeMode: style.vertical ? "auto-width" : "auto-height",
  };
  currentTexts().push(boxEl);
  if (item) {
    item.pageName = state.pageName;
    state.collapsedFolders.delete(state.pageName);
  }
  return boxEl;
}

function finishPlace(boxes, scope) {
  const last = boxes.at(-1);
  selectOnly(last ? last.id : null);
  if (ui.autoAdvance?.checked && scope !== undefined) {
    const next = nextUnplacedInScope(scope);
    if (next) selectDialogues([next.id]);
    else clearDialogueSelection();
  } else if (last?.dialogueId) {
    selectDialogues([last.dialogueId]);
  }
  renderTexts();
  renderDialogue();
  revealDialogueInList(state.selectedDialogueIds);
  if (last) writeStyleToForm(last);
  markDirty();
}

function placeTextAt(imgX, imgY) {
  const ids = selectedDialogueList();
  if (!ids.length) {
    clearDialogueSelection();
    selectOnly(null);
    refreshSelection();
    return;
  }
  const used = usedDialogueIds();
  const unplaced = ids
    .map((id) => project.dialogue.find((d) => d.id === id))
    .filter((d) => d && !used.has(d.id));
  if (!unplaced.length) {
    clearDialogueSelection();
    selectOnly(null);
    refreshSelection();
    return;
  }
  pushHistory({ paint: false, projectData: true });
  const scope = unplaced[0].pageName || "";
  const style = styleForNewText();
  const boxes = unplaced.map((item, i) => addTextBox(item, imgX, imgY, style, i * 16));
  finishPlace(boxes, ui.autoAdvance?.checked ? scope : undefined);
}

function createEmptyDialogueAt(imgX, imgY) {
  pushHistory({ paint: false, projectData: true });
  const item = { id: uid("d"), text: "", src: "", pageName: state.pageName || "" };
  project.dialogue.push(item);
  const box = addTextBox(item, imgX, imgY, styleForNewText());
  selectDialogues([item.id]);
  finishPlace([box]);
}

function localToWorld(t, lx, ly) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const r = rotateVec(lx - t.w / 2, ly - t.h / 2, t.rotation);
  return { x: cx + r.x, y: cy + r.y };
}

function pinOpposite(t, world, lx, ly) {
  const r = rotateVec(lx - t.w / 2, ly - t.h / 2, t.rotation);
  const cx = world.x - r.x;
  const cy = world.y - r.y;
  t.x = cx - t.w / 2;
  t.y = cy - t.h / 2;
}

function removeTextsByDialogue(id) {
  for (const page of Object.values(project.pages)) {
    page.texts = (page.texts || []).filter((t) => t.dialogueId !== id);
  }
  for (const tid of [...state.selectedTextIds]) {
    const still = Object.values(project.pages).some((page) =>
      (page.texts || []).some((t) => t.id === tid)
    );
    if (!still) state.selectedTextIds.delete(tid);
  }
  if (state.selectedTextId && !state.selectedTextIds.has(state.selectedTextId)) {
    state.selectedTextId = [...state.selectedTextIds].at(-1) || null;
  }
}

function placementCount(id) {
  let n = 0;
  for (const page of Object.values(project.pages)) {
    for (const t of page.texts || []) {
      if (t.dialogueId === id) n++;
    }
  }
  return n;
}

function takeSelectedBoxes() {
  const ids = [...state.selectedTextIds];
  if (!ids.length) return null;
  const drop = new Set(ids);
  const dialogueIds = new Set(
    currentTexts().filter((item) => drop.has(item.id) && item.dialogueId).map((item) => item.dialogueId)
  );
  pageEntry().texts = currentTexts().filter((item) => !drop.has(item.id));
  return dialogueIds;
}

function unplaceSelectedTexts() {
  if (!state.selectedTextIds.size) {
    toastT("selectFirst");
    return;
  }
  pushHistory({ paint: false, projectData: true });
  const dialogueIds = takeSelectedBoxes();
  if (!dialogueIds) return;
  selectOnly(null);
  renderTexts();
  renderDialogue();
  markDirty();
}

function deleteSelectedTexts() {
  if (!state.selectedTextIds.size) return;
  pushHistory({ paint: false, projectData: true });
  const dialogueIds = takeSelectedBoxes();
  if (!dialogueIds) return;
  for (const did of dialogueIds) {
    if (placementCount(did)) continue;
    project.dialogue = project.dialogue.filter((d) => d.id !== did);
    if (state.selectedDialogueIds.has(did)) state.selectedDialogueIds.delete(did);
    if (state.selectedDialogueId === did) {
      state.selectedDialogueId = [...state.selectedDialogueIds].at(-1) || project.dialogue[0]?.id || null;
      if (state.selectedDialogueId) state.selectedDialogueIds.add(state.selectedDialogueId);
    }
  }
  selectOnly(null);
  renderTexts();
  renderDialogue();
  markDirty();
}

function textInnerStyle(t) {
  const h = t.alignH || "center";
  if (t.vertical) {
    return {
      jc: "center",
      ai: { left: "flex-start", center: "center", right: "flex-end" }[h] || "center",
      textAlign: { left: "start", center: "center", right: "end" }[h] || "center",
    };
  }
  return {
    jc: { left: "flex-start", center: "center", right: "flex-end" }[h] || "center",
    ai: "center",
    textAlign: h,
  };
}

function handleCursor(handle, rotation) {
  const angles = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
  const total = ((angles[handle] || 0) + (rotation || 0)) % 180;
  const norm = total < 0 ? total + 180 : total;
  if (norm >= 22.5 && norm < 67.5) return "nesw-resize";
  if (norm >= 67.5 && norm < 112.5) return "ew-resize";
  if (norm >= 112.5 && norm < 157.5) return "nwse-resize";
  return "ns-resize";
}

function syncBoxChrome(el, t) {
  if (!el || !t) return;
  el.querySelectorAll(".handle[data-h]").forEach((h) => {
    h.style.cursor = handleCursor(h.dataset.h, t.rotation);
  });
  el.querySelector(".box-badge")?.remove();
}

function layoutTextEl(el, t) {
  const { jc, ai } = textInnerStyle(t);
  el.style.left = t.x + "px";
  el.style.top = t.y + "px";
  el.style.width = t.w + "px";
  el.style.height = t.h + "px";
  el.style.transform = `rotate(${t.rotation}deg)`;
  el.style.justifyContent = jc;
  el.style.alignItems = ai;
  syncBoxChrome(el, t);
}

function sizeInner(inner, t) {
  if (!inner) return;
  inner.style.boxSizing = "border-box";
  inner.style.overflow = "hidden";
  if (t.vertical) {
    inner.style.width = "max-content";
    inner.style.height = "100%";
    inner.style.minWidth = "max-content";
    inner.style.minHeight = "0";
    inner.style.maxWidth = "none";
    inner.style.maxHeight = "100%";
  } else {
    inner.style.width = "100%";
    inner.style.height = "max-content";
    inner.style.minWidth = "0";
    inner.style.minHeight = "0";
    inner.style.maxWidth = "100%";
    inner.style.maxHeight = "none";
  }
}

function syncBoxFields(t) {
  const w = String(Math.round(t.w));
  const h = String(Math.round(t.h));
  if (ui.boxW && ui.boxW.value !== w) ui.boxW.value = w;
  if (ui.boxH && ui.boxH.value !== h) ui.boxH.value = h;
}

function paintTextEl(el, t) {
  const { textAlign } = textInnerStyle(t);
  layoutTextEl(el, t);
  const inner = el.querySelector(".inner");
  inner.style.fontFamily = fontFamilyCss(t.font);
  inner.style.fontSize = t.fontSize + "px";
  inner.style.fontWeight = t.fontWeight;
  inner.style.color = colorWithAlpha(t.color, t.opacity);
  applyTextStroke(inner, t.strokeWidth, t.strokeColor);
  inner.style.lineHeight = String(t.lineHeight);
  inner.style.letterSpacing = t.letterSpacing + "px";
  inner.style.writingMode = t.vertical ? "vertical-rl" : "horizontal-tb";
  inner.style.textOrientation = "mixed";
  inner.style.textAlign = textAlign;
  inner.style.flex = "0 0 auto";
  sizeInner(inner, t);
  fillTextInner(inner, t);
}

function refreshTextPaint(t, { restyle = true } = {}) {
  const el = ui.texts?.querySelector(`[data-id="${t.id}"]`);
  if (!el) {
    renderTexts();
    return;
  }
  const editing = bag.inlineEdit?.id === t.id;
  const sel = activeCharSel(t.id);
  if (restyle) paintTextEl(el, t);
  else {
    layoutTextEl(el, t);
    sizeInner(el.querySelector(".inner"), t);
  }
  const inner = el.querySelector(".inner");
  if (!inner) return;
  if (editing) {
    inner.contentEditable = "true";
    if (sel) restoreCharSel(inner, sel.start, sel.end);
  }
  if (sel) paintCharHighlight(inner, sel.start, sel.end);
}

function commitInlineText(t) {
  if (!t || bag.inlineEdit?.id !== t.id) return t?.text || "";
  const inner = ui.texts?.querySelector(`[data-id="${t.id}"] .inner`);
  if (!inner) return t.text || "";
  const next = readInnerText(inner);
  t.text = next;
  clampRuns(t);
  return next;
}

function restoreEditSelection(id) {
  const inner = ui.texts?.querySelector(`[data-id="${id}"] .inner`);
  if (!inner) return;
  inner.focus({ preventScroll: true });
  const sel = bag.charSel && bag.charSel.textId === id ? bag.charSel : null;
  if (sel) {
    restoreCharSel(inner, sel.start, sel.end);
    paintCharHighlight(inner, sel.start, sel.end);
  } else if (bag.editCaret != null) {
    placeCaret(inner, bag.editCaret);
  }
}

function syncTextEl(t, { layoutOnly = false } = {}) {
  const el = ui.texts.querySelector(`[data-id="${t.id}"]`);
  if (!el) {
    if (!layoutOnly) renderTexts();
    return;
  }
  el.classList.toggle("selected", state.selectedTextIds.has(t.id));
  if (layoutOnly) {
    layoutTextEl(el, t);
    const inner = el.querySelector(".inner");
    if (inner) sizeInner(inner, t);
    return;
  }
  paintTextEl(el, t);
}

const BOX_CHROME = `<i class="move-halo" aria-hidden="true"></i><div class="inner"></div><div class="sel-layer" aria-hidden="true"></div>
    <i class="handle nw" data-h="nw"></i><i class="handle n" data-h="n"></i><i class="handle ne" data-h="ne"></i>
    <i class="handle e" data-h="e"></i><i class="handle se" data-h="se"></i><i class="handle s" data-h="s"></i>
    <i class="handle sw" data-h="sw"></i><i class="handle w" data-h="w"></i>
    <i class="rot" data-h="rot"></i>`;

function makeTextBoxEl(item) {
  const el = document.createElement("div");
  el.className = "text-box";
  el.dataset.id = item.id;
  el.innerHTML = BOX_CHROME;
  return el;
}

function ensureBoxChrome(el) {
  if (!el.querySelector(".move-halo")) {
    el.insertAdjacentHTML("afterbegin", `<i class="move-halo" aria-hidden="true"></i>`);
  }
  if (!el.querySelector(":scope > .sel-layer")) {
    const inner = el.querySelector(":scope > .inner");
    const layer = document.createElement("div");
    layer.className = "sel-layer";
    layer.setAttribute("aria-hidden", "true");
    if (inner?.nextSibling) el.insertBefore(layer, inner.nextSibling);
    else el.appendChild(layer);
  }
  el.querySelectorAll(".edge, .box-badge, .sel-frame").forEach((node) => node.remove());
}

function renderTexts() {
  const texts = currentTexts();
  const pageName = state.pageName;
  ui.texts.style.width = state.imgW + "px";
  ui.texts.style.height = state.imgH + "px";
  const have = new Map();
  for (const el of [...ui.texts.children]) {
    if (el.dataset.id) have.set(el.dataset.id, el);
  }
  const keep = new Set();
  for (const item of texts) {
    let el = have.get(item.id);
    if (!el) {
      el = makeTextBoxEl(item);
      ui.texts.appendChild(el);
    }
    ensureBoxChrome(el);
    el.classList.toggle("selected", state.selectedTextIds.has(item.id));
    if (!el.classList.contains("editing")) paintTextEl(el, item);
    keep.add(item.id);
  }
  for (const [id, el] of have) {
    if (!keep.has(id)) el.remove();
  }
  ensureFontsForTexts(texts).then(() => {
    if (state.pageName !== pageName) return;
    for (const item of texts) {
      const el = ui.texts.querySelector(`[data-id="${item.id}"]`);
      if (el && !el.classList.contains("editing")) paintTextEl(el, item);
    }
  });
}

function selectedText() {
  return currentTexts().find((t) => t.id === state.selectedTextId) || null;
}

function selectedTexts() {
  return currentTexts().filter((t) => state.selectedTextIds.has(t.id));
}

function selectOnly(id) {
  if (bag.inlineEdit && bag.inlineEdit.id !== id) endInlineEdit();
  if (!id || !state.selectedTextIds.has(id)) bag.editArmed = false;
  if (!id || bag.charSel?.textId !== id) clearCharSel();
  state.selectedTextId = id || null;
  state.selectedTextIds = new Set(id ? [id] : []);
}

function textBoxBounds(t) {
  const corners = [
    localToWorld(t, 0, 0),
    localToWorld(t, t.w, 0),
    localToWorld(t, t.w, t.h),
    localToWorld(t, 0, t.h),
  ];
  return {
    x: Math.min(...corners.map((c) => c.x)),
    y: Math.min(...corners.map((c) => c.y)),
    r: Math.max(...corners.map((c) => c.x)),
    b: Math.max(...corners.map((c) => c.y)),
  };
}

function selectByMarquee(x0, y0, x1, y1, additive) {
  const box = {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    r: Math.max(x0, x1),
    b: Math.max(y0, y1),
  };
  const hits = currentTexts().filter((t) => {
    const b = textBoxBounds(t);
    return box.x < b.r && box.r > b.x && box.y < b.b && box.b > b.y;
  });
  if (additive) {
    for (const t of hits) state.selectedTextIds.add(t.id);
    if (hits[0]) state.selectedTextId = hits[0].id;
  } else {
    state.selectedTextIds = new Set(hits.map((t) => t.id));
    state.selectedTextId = hits[0] ? hits[0].id : null;
  }
  refreshSelection();
  const prim = selectedText();
  if (prim) writeStyleToForm(prim);
}

function toggleSelect(id) {
  if (state.selectedTextIds.has(id)) {
    state.selectedTextIds.delete(id);
    state.selectedTextId = [...state.selectedTextIds].at(-1) || null;
  } else {
    state.selectedTextIds.add(id);
    state.selectedTextId = id;
  }
}

function scrollListToRow(row) {
  const list = ui.dialogueList;
  if (!list || !row) return;
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
  else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
}

function revealDialogueInList(ids) {
  const set = ids instanceof Set
    ? ids
    : new Set(Array.isArray(ids) ? ids : ids ? [ids] : [...state.selectedDialogueIds]);
  if (!set.size && state.selectedDialogueId) set.add(state.selectedDialogueId);
  let missing = [...set].some((id) => !ui.dialogueList.querySelector(`.line[data-id="${id}"]`));
  if (missing && state.dialogueFilter !== "all") {
    setDialogueFilter("all");
    missing = [...set].some((id) => !ui.dialogueList.querySelector(`.line[data-id="${id}"]`));
  }
  $$(".line", ui.dialogueList).forEach((el) => {
    el.classList.toggle("selected", set.has(el.dataset.id));
  });
  if (!set.size) return;
  const primary = state.selectedDialogueId && set.has(state.selectedDialogueId)
    ? state.selectedDialogueId
    : [...set][0];
  const row = ui.dialogueList.querySelector(`.line[data-id="${primary}"]`);
  if (!row) return;
  const folder = row.closest(".folder");
  if (folder?.classList.contains("collapsed")) {
    const key = folder.dataset.folder || "";
    state.collapsedFolders.delete(key);
    folder.classList.remove("collapsed");
  }
  scrollListToRow(row);
}

function syncLibraryFromTexts() {
  const ids = [...new Set(selectedTexts().map((item) => item.dialogueId).filter(Boolean))];
  if (ids.length) {
    selectDialogues(ids, selectedText()?.dialogueId || ids[0]);
  }
  revealDialogueInList(state.selectedDialogueIds);
}

function selectTextsByDialogue(id) {
  selectTextsByDialogueIds(id ? [id] : []);
}

function selectTextsByDialogueIds(ids) {
  const idSet = new Set(ids || []);
  const matches = currentTexts().filter((item) => item.dialogueId && idSet.has(item.dialogueId));
  if (!matches.length) {
    selectOnly(null);
    $$(".text-box", ui.texts).forEach((el) => el.classList.remove("selected"));
    return;
  }
  state.selectedTextIds = new Set(matches.map((item) => item.id));
  const prim = matches.find((item) => item.dialogueId === state.selectedDialogueId) || matches[0];
  state.selectedTextId = prim.id;
  $$(".text-box", ui.texts).forEach((el) => {
    el.classList.toggle("selected", state.selectedTextIds.has(el.dataset.id));
  });
  writeStyleToForm(prim);
}

function panToText(t) {
  if (!t || !ui.viewport) return;
  const r = ui.viewport.getBoundingClientRect();
  state.panX = r.width / 2 - (t.x + t.w / 2) * state.zoom;
  state.panY = r.height / 2 - (t.y + t.h / 2) * state.zoom;
  applyView();
}

async function focusDialoguePlacement(d, { pan, keepSelection = false } = {}) {
  const page = placedPageOf(d.id);
  if (!page) return false;
  const jumped = page !== state.pageName;
  const ids = keepSelection ? selectedDialogueList() : [d.id];
  if (jumped) await loadPage(page);
  if (!project.dialogue.some((x) => x.id === d.id)) return false;
  selectDialogues(ids, d.id);
  selectTextsByDialogueIds(ids);
  revealDialogueInList(ids);
  if (pan ?? jumped) panToText(selectedText());
  return true;
}

function refreshSelection() {
  if (bag.charSel && !state.selectedTextIds.has(bag.charSel.textId)) clearCharSel();
  $$(".text-box", ui.texts).forEach((el) => {
    el.classList.toggle("selected", state.selectedTextIds.has(el.dataset.id));
  });
  syncLibraryFromTexts();
}

function scrubEditDom() {
  $$(".text-box.editing", ui.texts).forEach((el) => el.classList.remove("editing"));
  $$(".inner[contenteditable], .inner[contenteditable='true']", ui.texts).forEach((el) => {
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
  });
}

function endInlineEdit() {
  const finish = bag.inlineEdit?.finish;
  const stray = ui.texts?.querySelector(".text-box.editing, .inner[contenteditable='true']");
  if (!finish && !stray) {
    bag.editArmed = false;
    return;
  }
  bag.inlineEdit = null;
  bag.editArmed = false;
  if (finish) finish();
  scrubEditDom();
}

function startInlineEdit(box, at) {
  const t = currentTexts().find((x) => x.id === box?.dataset.id);
  if (!t) return;
  if (bag.inlineEdit?.id === t.id) return;
  if (bag.inlineEdit) endInlineEdit();
  selectOnly(t.id);
  refreshSelection();
  writeStyleToForm(t);
  const inner = box.querySelector(".inner");
  if (!inner) return;
  box.classList.add("editing", "selected");
  sizeInner(inner, t);
  inner.contentEditable = "true";
  inner.spellcheck = false;
  inner.focus({ preventScroll: true });
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    placeCaret(inner, caretOffsetFromPoint(inner, at.x, at.y));
  }
  let done = false;
  const original = t.text;
  const ac = new AbortController();
  const { signal } = ac;
  const finish = () => {
    if (done) return;
    done = true;
    ac.abort();
    if (bag.inlineEdit?.id === t.id) bag.inlineEdit = null;
    bag.editArmed = false;
    inner.contentEditable = "false";
    inner.removeAttribute("contenteditable");
    box.classList.remove("editing");
    const next = readInnerText(inner);
    t.text = next;
    clampRuns(t);
    if (next !== original) {
      pushHistory({ paint: false, projectData: true });
      syncDialogueFromText(t);
      markDirty();
    }
    paintTextEl(box, t);
  };
  let composing = false;
  let rebuilding = false;
  const liveGrow = () => {
    if (rebuilding) return;
    const caret = caretOffset(inner);
    t.text = readInnerText(inner);
    clampRuns(t);
    rebuilding = true;
    fillTextInner(inner, t);
    placeCaret(inner, caret);
    rebuilding = false;
    applySizeMode(t, measureTextMetrics(t, { w: t.w, h: t.h }));
    layoutTextEl(box, t);
    sizeInner(inner, t);
    syncBoxFields(t);
    const sel = bag.charSel && bag.charSel.textId === t.id ? bag.charSel : null;
    if (sel) paintCharHighlight(inner, sel.start, sel.end);
  };
  inner.addEventListener("dragstart", (ev) => ev.preventDefault(), { signal });
  inner.addEventListener("drop", (ev) => ev.preventDefault(), { signal });
  inner.addEventListener("compositionstart", () => {
    composing = true;
  }, { signal });
  inner.addEventListener("compositionend", () => {
    composing = false;
    liveGrow();
  }, { signal });
  inner.addEventListener("input", () => {
    if (composing) return;
    liveGrow();
  }, { signal });
  inner.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      finish();
    }
  }, { signal });
  const onOutside = (ev) => {
    if (bag.drag) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (box.contains(target)) return;
    if (target.closest(".side, .topbar, .modal, .ctx-menu, #toast, header")) return;
    finish();
  };
  window.addEventListener("mousedown", onOutside, { signal });
  bag.inlineEdit = { id: t.id, finish };
  bag.editArmed = false;
}

function copySelectedTexts(fromCut = false) {
  const items = selectedTexts();
  if (!items.length) return false;
  bag.textClip = {
    items: items.map((t) => JSON.parse(JSON.stringify(t))),
    fromCut,
    pasteN: 0,
  };
  return true;
}

function cutSelectedTexts() {
  if (!copySelectedTexts(true)) return;
  pushHistory({ paint: false, projectData: true });
  const drop = new Set(bag.textClip.items.map((t) => t.id));
  pageEntry().texts = currentTexts().filter((t) => !drop.has(t.id));
  selectOnly(null);
  renderTexts();
  renderDialogue();
  markDirty();
}

function pasteTexts() {
  if (!bag.textClip.items.length || !state.pageName) return;
  pushHistory({ paint: false, projectData: true });
  const n = bag.textClip.pasteN++;
  const offset = (bag.textClip.fromCut ? n : n + 1) * 16;
  const ids = [];
  const cloneDialogue = !bag.textClip.fromCut;
  for (const src of bag.textClip.items) {
    const t = JSON.parse(JSON.stringify(src));
    t.id = uid("t");
    t.x += offset;
    t.y += offset;
    if (cloneDialogue && src.dialogueId) {
      const srcD = project.dialogue.find((d) => d.id === src.dialogueId);
      if (srcD) {
        const d = { ...JSON.parse(JSON.stringify(srcD)), id: uid("d"), pageName: state.pageName };
        project.dialogue.push(d);
        t.dialogueId = d.id;
      } else {
        t.dialogueId = null;
      }
    } else if (t.dialogueId) {
      const d = project.dialogue.find((x) => x.id === t.dialogueId);
      if (d) d.pageName = state.pageName;
    }
    currentTexts().push(t);
    ids.push(t.id);
  }
  state.selectedTextIds = new Set(ids);
  state.selectedTextId = ids.at(-1) || null;
  renderTexts();
  renderDialogue();
  const t = selectedText();
  if (t) writeStyleToForm(t);
  refreshSelection();
  markDirty();
}

export {
  placeTextAt,
  createEmptyDialogueAt,
  localToWorld,
  pinOpposite,
  removeTextsByDialogue,
  unplaceSelectedTexts,
  deleteSelectedTexts,
  textInnerStyle,
  paintTextEl,
  refreshTextPaint,
  syncTextEl,
  renderTexts,
  selectedText,
  selectedTexts,
  selectOnly,
  selectByMarquee,
  toggleSelect,
  revealDialogueInList,
  selectTextsByDialogue,
  selectTextsByDialogueIds,
  focusDialoguePlacement,
  refreshSelection,
  startInlineEdit,
  endInlineEdit,
  commitInlineText,
  restoreEditSelection,
  syncBoxChrome,
  copySelectedTexts,
  cutSelectedTexts,
  pasteTexts,
};
