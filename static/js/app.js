// --- 啟動 ---
import { $, $$, state, project, ui, bag, pageHistory, defaultStyle, TOOL_KEYS, TOOL_HOLD_MS, recalledPage, clamp, currentTexts, selectDialogues, clearDialogueSelection, selectedDialogueList, usedDialogueIds } from "./store.js";
import { t, toast, toastT, confirmT, toolHint, setStatusHint, bindHint, loadCopy, probeToast } from "./copy.js";
import { apiGet, saveProject, saveEraseNow, saveEraseSoon, markDirty } from "./api.js";
import { pushHistory, undo, redo, captureState, commitHistory } from "./history.js";
import { setTool, applyView, applyCompare, fitPage, setZoomLevel, clientToImage, clearToolHold, zoomAt, setDialogueFilter, updateStatusPage } from "./view.js";
import { strokeSegment, updateBrushCursor, updatePickerCursor, updateRectPreview, hideRectPreview, updateLassoPreview, hideLassoPreview, fillLasso, pickColor } from "./paint.js";
import { applyFormToSelected, writeStyleToForm, loadStylePresets, fillStylePresetSelect, restoreApplyProps, rememberApplyProps, decorateNumberInputs, bindSelectWheel, fitSelectedBoxes, applyStyleToTexts, applyStylePreset, openStyleModal, addStylePreset, deleteStylePreset, setPresetAsDefault, applyCurrentFormToPreset, commitStyleEditor, syncStyleEditorLocks, saveStylePresets, applySizeModeToSelected } from "./style.js";
import { placeTextAt, createEmptyDialogueAt, startInlineEdit, endInlineEdit, selectOnly, selectedText, selectedTexts, toggleSelect, selectByMarquee, refreshSelection, syncTextEl, copySelectedTexts, cutSelectedTexts, pasteTexts, unplaceSelectedTexts, deleteSelectedTexts, restoreEditSelection } from "./text.js";
import { snapshotResize, applyBoxResize } from "./boxgeom.js";
import { renderDialogue, parseBulk, placedPageOf, dialogueFolderOf } from "./dialogue.js";
import { loadPage, renderThumbs, bindThumbsSort, refreshPages, deletePage, hidePageMenu, applyPageOrder, fillFontSelect } from "./pages.js";
import { bindFontLibrary, applyFontCatalog } from "./fonts.js";
import { bindColorPopover, fillRange, setColorTarget, addSwatch, renderSwatches } from "./color.js";
import { openAutoModal, closeAutoModal, openSettingsModal, runAutoPipeline, applyAutoResults, saveApiSettings, setPagePickSelection, selectedPagePicks, renderPagePicks, setSettingsBusy, postProbe, addGlossaryRow, onGlossaryTextInput, setSettingsTab } from "./auto.js";
import { exportPage } from "./export.js";
import { captureCharSel, charStyleAt, clearCharSel, clearNativeSel, readInnerRange, paintCharHighlight, clearCharHighlight, restoreCharSel, placeCaret, caretOffset } from "./glyphs.js";

function revertDrag(drag) {
  if (!drag) return;
  if (drag.type === "pan") {
    state.panX = drag.panX;
    state.panY = drag.panY;
    applyView();
    return;
  }
  if (drag.type === "move" && drag.group) {
    for (const item of drag.group) {
      item.t.x = item.x;
      item.t.y = item.y;
      syncTextEl(item.t);
    }
    return;
  }
  if (drag.type !== "resize" && drag.type !== "rot") return;
  const snap = drag.hist?.pages?.[state.pageName]?.texts?.find((x) => x.id === state.selectedTextId);
  const item = selectedText();
  if (!item || !snap) return;
  Object.assign(item, snap);
  syncTextEl(item);
  writeStyleToForm(item);
}

function finishPointer(e, cancelled) {
  if (cancelled || e?.button === 2) {
    bag.picking = false;
    updatePickerCursor(e);
  }
  if (!bag.drag) return;
  if (cancelled) {
    hideLassoPreview();
    hideRectPreview();
    ui.viewport.classList.remove("selecting", "grabbing");
    revertDrag(bag.drag);
    bag.drag = null;
    return;
  }
  if (bag.drag.type === "brush") {
    const p = clientToImage(e.clientX, e.clientY);
    strokeSegment(bag.drag.x, bag.drag.y, p.x, p.y, bag.drag.erase);
    saveEraseSoon();
  }
  if (bag.drag.type === "lasso") {
    hideLassoPreview();
    fillLasso(bag.drag.points);
  }
  if (bag.drag.type === "rect") {
    const p = clientToImage(e.clientX, e.clientY);
    const x = Math.min(bag.drag.x, p.x);
    const y = Math.min(bag.drag.y, p.y);
    const w = Math.abs(p.x - bag.drag.x);
    const h = Math.abs(p.y - bag.drag.y);
    hideRectPreview();
    if (w >= 1 && h >= 1) {
      pushHistory({ paint: true, projectData: false });
      ui.paintCtx.fillStyle = ui.brushColor.value;
      ui.paintCtx.fillRect(x, y, w, h);
      saveEraseSoon();
    }
  }
  if (bag.drag.type === "marquee") {
    const p = clientToImage(e.clientX, e.clientY);
    const w = Math.abs(p.x - bag.drag.x);
    const h = Math.abs(p.y - bag.drag.y);
    hideRectPreview();
    ui.viewport.classList.remove("selecting");
    if (w < 4 && h < 4) {
      if (!bag.drag.additive) {
        selectOnly(null);
        refreshSelection();
      }
    } else {
      selectByMarquee(bag.drag.x, bag.drag.y, p.x, p.y, bag.drag.additive);
    }
  }
  if (["move", "resize", "rot"].includes(bag.drag.type)) {
    const p = clientToImage(e.clientX, e.clientY);
    const moved = Math.hypot(p.x - bag.drag.mx, p.y - bag.drag.my) >= 3;
    if (bag.drag.type === "move" && bag.drag.collapseOnClick && !moved && bag.drag.collapseId) {
      selectOnly(bag.drag.collapseId);
      refreshSelection();
      const prim = selectedText();
      if (prim) writeStyleToForm(prim);
    } else {
      if (moved && bag.drag.hist) commitHistory(bag.drag.hist);
      const t = selectedText();
      if (t) writeStyleToForm(t);
      if (moved) markDirty();
    }
  }
  ui.viewport.classList.remove("grabbing");
  bag.drag = null;
}

function bindPointers() {
  ui.viewport.addEventListener("wheel", (e) => {
    if (e.target.closest("#view-float")) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, state.zoom * factor);
    updateBrushCursor(e);
    updatePickerCursor(e);
  }, { passive: false });

  ui.viewport.addEventListener("contextmenu", (e) => {
    if (e.target.closest("#view-float")) return;
    e.preventDefault();
  });

  ui.viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#view-float")) return;
    if (!e.target.closest(".text-box")) {
      endInlineEdit();
      bag.editArmed = false;
    }
    if (e.button === 2) {
      bag.picking = true;
      const p = clientToImage(e.clientX, e.clientY);
      updatePickerCursor(e);
      pickColor(p.x, p.y);
      return;
    }
    const onText = !!e.target.closest(".text-box");
    const pan = state.tool === "pan" || e.button === 1;
    if (onText && !pan) return;
    e.preventDefault();
    ui.viewport.setPointerCapture(e.pointerId);
    const p = clientToImage(e.clientX, e.clientY);
    const inside = p.x >= 0 && p.y >= 0 && p.x <= state.imgW && p.y <= state.imgH;
    if (pan && e.button !== 2) {
      bag.drag = { type: "pan", x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
      ui.viewport.classList.add("grabbing");
      return;
    }
    if (!inside && state.tool !== "pan" && state.tool !== "select") return;
    if (state.tool === "picker") {
      pickColor(p.x, p.y);
      return;
    }
    if (state.tool === "select") {
      bag.drag = { type: "marquee", x: p.x, y: p.y, additive: e.shiftKey };
      updateRectPreview(p.x, p.y, p.x, p.y);
      ui.rectPreview.hidden = false;
      ui.viewport.classList.add("selecting");
      return;
    }
    if (state.tool === "text") {
      if (e.shiftKey) return;
      if (e.detail > 1) {
        const ids = selectedDialogueList();
        const used = usedDialogueIds();
        if (!ids.some((id) => !used.has(id))) return;
      }
      placeTextAt(p.x, p.y);
      return;
    }
    if (state.tool === "brush" || state.tool === "eraser") {
      pushHistory({ paint: true, projectData: false });
      bag.drag = { type: "brush", x: p.x, y: p.y, erase: state.tool === "eraser" };
      strokeSegment(p.x, p.y, p.x, p.y, bag.drag.erase);
      saveEraseSoon();
      return;
    }
    if (state.tool === "rect") {
      bag.drag = { type: "rect", x: p.x, y: p.y };
      updateRectPreview(p.x, p.y, p.x, p.y);
      ui.rectPreview.hidden = false;
      return;
    }
    if (state.tool === "lasso") {
      bag.drag = { type: "lasso", points: [{ x: p.x, y: p.y }] };
      ui.lassoPreview.hidden = false;
      updateLassoPreview(bag.drag.points);
      return;
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (state.tool === "brush" || state.tool === "eraser") updateBrushCursor(e);
    if (state.tool === "picker" || bag.picking) updatePickerCursor(e);
    if (!bag.drag) return;
    if (bag.drag.type === "pan") {
      state.panX = bag.drag.panX + (e.clientX - bag.drag.x);
      state.panY = bag.drag.panY + (e.clientY - bag.drag.y);
      applyView();
      return;
    }
    const p = clientToImage(e.clientX, e.clientY);
    if (bag.drag.type === "brush") {
      const x = bag.drag.x + (p.x - bag.drag.x) * 0.55;
      const y = bag.drag.y + (p.y - bag.drag.y) * 0.55;
      if (Math.hypot(x - bag.drag.x, y - bag.drag.y) < 0.45) return;
      strokeSegment(bag.drag.x, bag.drag.y, x, y, bag.drag.erase);
      bag.drag.x = x;
      bag.drag.y = y;
      saveEraseSoon();
      return;
    }
    if (bag.drag.type === "rect" || bag.drag.type === "marquee") {
      updateRectPreview(bag.drag.x, bag.drag.y, p.x, p.y);
      return;
    }
    if (bag.drag.type === "lasso") {
      const last = bag.drag.points[bag.drag.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
        bag.drag.points.push({ x: p.x, y: p.y });
      } else {
        last.x = p.x;
        last.y = p.y;
      }
      updateLassoPreview(bag.drag.points);
      return;
    }
    if (bag.drag.type === "move") {
      const dx = p.x - bag.drag.mx;
      const dy = p.y - bag.drag.my;
      for (const item of bag.drag.group || []) {
        item.t.x = item.x + dx;
        item.t.y = item.y + dy;
        syncTextEl(item.t, { layoutOnly: true });
      }
      return;
    }
    if (bag.drag.type === "resize") {
      const t = selectedText();
      if (!t || !bag.drag.snap) return;
      applyBoxResize(t, bag.drag.snap, p);
      syncTextEl(t, { layoutOnly: true });
      if (ui.boxW) ui.boxW.value = String(Math.round(t.w));
      if (ui.boxH) ui.boxH.value = String(Math.round(t.h));
      if (ui.sizeMode && ui.sizeMode.value !== "fixed") {
        ui.sizeMode.value = "fixed";
        ui.sizeMode.dispatchEvent(new Event("input"));
      }
      return;
    }
    if (bag.drag.type === "rot") {
      const t = selectedText();
      if (!t) return;
      const ang = (Math.atan2(p.y - bag.drag.cy, p.x - bag.drag.cx) * 180) / Math.PI;
      let deg = ang - bag.drag.off;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      t.rotation = deg;
      ui.rotation.value = Math.round(deg * 10) / 10;
      syncTextEl(t, { layoutOnly: true });
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (bag.glyphPick) {
      bag.glyphPick = false;
      const box = ui.texts.querySelector(".text-box.selected");
      const inner = box?.querySelector(".inner");
      const item = selectedText() || currentTexts().find((x) => x.id === box?.dataset.id);
      if (inner && box) {
        const sel = captureCharSel(inner, box.dataset.id);
        clearNativeSel();
        writeStyleToForm(item && sel ? { ...item, ...charStyleAt(item, sel.start) } : item);
      } else {
        clearCharSel();
      }
    }
    const ptr = bag.boxPtr;
    bag.boxPtr = null;
    if (ptr && !bag.inlineEdit) {
      const moved = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) >= 4;
      if (ptr.already && !moved) bag.editArmed = true;
    }
    const boxDrag = bag.drag && ["move", "resize", "rot"].includes(bag.drag.type);
    finishPointer(e, false);
    if (boxDrag && bag.inlineEdit) {
      const inner = ui.texts?.querySelector(`[data-id="${bag.inlineEdit.id}"] .inner`);
      if (inner) {
        inner.focus({ preventScroll: true });
        if (bag.charSel) {
          restoreCharSel(inner, bag.charSel.start, bag.charSel.end);
          paintCharHighlight(inner, bag.charSel.start, bag.charSel.end);
        } else if (bag.editCaret != null) {
          placeCaret(inner, bag.editCaret);
        }
      }
    }
  });
  window.addEventListener("pointercancel", (e) => {
    bag.glyphPick = false;
    finishPointer(e, true);
  });
  document.addEventListener("selectionchange", () => {
    const box = ui.texts?.querySelector(".text-box.editing");
    const inner = box?.querySelector(".inner");
    if (!inner || !box) return;
    if (bag.drag && ["move", "resize", "rot"].includes(bag.drag.type)) return;
    const next = readInnerRange(inner, box.dataset.id);
    const inEditor = document.activeElement === inner || inner.contains(document.activeElement);
    if (next) {
      bag.charSel = next;
      paintCharHighlight(inner, next.start, next.end);
    } else if (inEditor) {
      bag.charSel = null;
      clearCharHighlight();
    }
    const item = currentTexts().find((x) => x.id === box.dataset.id);
    const sel = bag.charSel;
    if (item && sel) writeStyleToForm({ ...item, ...charStyleAt(item, sel.start) });
  });

  document.querySelector(".side")?.addEventListener("mousedown", (e) => {
    if (!bag.inlineEdit) return;
    if (e.target.closest("input, textarea, select")) return;
    const keep = e.target.closest("button, .seg, .chip, .fit-box-btn, .num-spin");
    if (!keep) return;
    const id = bag.inlineEdit.id;
    requestAnimationFrame(() => restoreEditSelection(id));
  });

  ui.texts.addEventListener("pointerdown", (e) => {
    const box = e.target.closest(".text-box");
    if (!box) return;
    if (e.button === 2) {
      bag.picking = true;
      updatePickerCursor(e);
      return;
    }
    if (state.tool === "pan" || e.button === 1) return;
    e.stopPropagation();
    const editingThis = bag.inlineEdit?.id === box.dataset.id;
    const onHandle = !!e.target.closest(".handle, .rot");
    const onInner = !!e.target.closest(".inner") && !onHandle;
    const inner = box.querySelector(".inner");
    if (editingThis) {
      bag.editCaret = inner ? caretOffset(inner) : 0;
    }
    if (editingThis && onInner && !e.altKey && !onHandle) return;
    if (editingThis) e.preventDefault();

    if (!editingThis && bag.inlineEdit) endInlineEdit();
    if (!editingThis && box.querySelector("[contenteditable='true']")) endInlineEdit();
    const t = currentTexts().find((x) => x.id === box.dataset.id);
    if (!t) return;
    const already = state.selectedTextIds.has(t.id);
    bag.boxPtr = { id: t.id, already, x: e.clientX, y: e.clientY };
    if (e.shiftKey && !editingThis) {
      toggleSelect(t.id);
      refreshSelection();
      const prim = selectedText();
      if (prim) writeStyleToForm(prim);
      return;
    }
    if (!already) selectOnly(t.id);
    else state.selectedTextId = t.id;
    refreshSelection();
    writeStyleToForm(t);
    if (!editingThis) clearCharSel();
    const p = clientToImage(e.clientX, e.clientY);
    const hist = captureState({ paint: false, projectData: true });
    const handle = e.target.dataset.h;
    if (handle === "rot") {
      bag.drag = {
        type: "rot",
        mx: p.x,
        my: p.y,
        cx: t.x + t.w / 2,
        cy: t.y + t.h / 2,
        off: (Math.atan2(p.y - (t.y + t.h / 2), p.x - (t.x + t.w / 2)) * 180) / Math.PI - t.rotation,
        hist,
      };
      return;
    }
    if (handle) {
      bag.drag = {
        type: "resize",
        mx: p.x,
        my: p.y,
        handle,
        snap: snapshotResize(t, handle),
        hist,
      };
      return;
    }
    bag.drag = {
      type: "move",
      mx: p.x,
      my: p.y,
      collapseOnClick: !editingThis && already && state.selectedTextIds.size > 1,
      collapseId: t.id,
      group: selectedTexts().map((item) => ({ t: item, x: item.x, y: item.y })),
      hist,
    };
  });

  ui.texts.addEventListener("dblclick", (e) => {
    const box = e.target.closest(".text-box");
    if (!box) return;
    if (bag.inlineEdit?.id === box.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    startInlineEdit(box, { x: e.clientX, y: e.clientY });
  });

  ui.viewport.addEventListener("dblclick", (e) => {
    if (state.tool !== "text" || e.shiftKey) return;
    if (e.target.closest(".text-box")) return;
    const ids = selectedDialogueList();
    const used = usedDialogueIds();
    if (ids.some((id) => !used.has(id))) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (p.x < 0 || p.y < 0 || p.x > state.imgW || p.y > state.imgH) return;
    e.preventDefault();
    createEmptyDialogueAt(p.x, p.y);
  });
}

function bindForm() {
  [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "writingMode",
    "alignH",
    "fillColor",
    "strokeColor",
    "strokeWidth",
    "lineHeight",
    "letterSpacing",
    "rotation",
    "boxW",
    "boxH",
  ].forEach((key) => {
    if (!ui[key]) return;
    ui[key].addEventListener("focus", () => {
      bag.styleEditing = false;
    });
    ui[key].addEventListener("input", applyFormToSelected);
    ui[key].addEventListener("change", applyFormToSelected);
  });
  ui.sizeMode?.addEventListener("change", () => {
    if (bag.restoring) return;
    applySizeModeToSelected(ui.sizeMode.value);
  });
  bindSelectWheel(ui.fontFamily, { host: ui.fontFamily?.closest(".box-fit-row") });
  bindSelectWheel(ui.stylePreset, { skipEmpty: true, host: ui.stylePreset?.closest(".box-fit-row") });
  bindSelectWheel(ui.fontWeight);
  $$(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $("#" + btn.dataset.target);
      if (!input) return;
      setColorTarget(btn.dataset.target);
      input.value = btn.dataset.color;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  bindColorPopover();
  $$("[data-add-swatch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".color-picks")?.dataset.colorInput || bag.lastColorInputId;
      const input = $("#" + id);
      addSwatch(input ? input.value : "#000000", id);
    });
  });
  renderSwatches();
  setColorTarget("fill-color");
  ui.brushSize.addEventListener("input", () => {
    ui.brushSizeVal.value = ui.brushSize.value;
    fillRange(ui.brushSize);
  });
  const commitBrushSize = () => {
    const next = clamp(Number(ui.brushSizeVal.value) || Number(ui.brushSize.value), 4, 220);
    ui.brushSize.value = String(next);
    ui.brushSizeVal.value = String(next);
    ui.brushSize.dispatchEvent(new Event("input"));
  };
  ui.brushSizeVal.addEventListener("change", commitBrushSize);
  ui.brushSizeVal.addEventListener("blur", commitBrushSize);
  ui.brushSizeVal.addEventListener("focus", () => ui.brushSizeVal.select());
  ui.brushSizeVal.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ui.brushSizeVal.blur();
  });
  ui.brushHard.addEventListener("input", () => fillRange(ui.brushHard));
  fillRange(ui.brushSize);
  fillRange(ui.brushHard);
}

function bindButtons() {
  decorateNumberInputs();
  $$("#tools button").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool));
    b.addEventListener("pointerenter", () => setStatusHint(toolHint(b.dataset.tool)));
    b.addEventListener("pointerleave", () => setStatusHint(toolHint()));
  });
  ["btn-undo", "btn-redo", "btn-clear-paint", "btn-hide-paint", "btn-hide-text", "btn-fit", "btn-fit-w", "btn-fit-h", "btn-open-project", "btn-new-project", "btn-fonts"].forEach((id) => {
    bindHint($("#" + id), id);
  });
  ["brush-size", "brush-hard", "brush-color"].forEach((id) => {
    const input = $("#" + id);
    bindHint(input?.closest("label") || input, id);
  });
  bindHint(ui.brushSizeVal, "brush-size");
  bindHint($("#zoom-toggle"), "zoom-label");
  $("#btn-undo").addEventListener("click", undo);
  $("#btn-redo").addEventListener("click", redo);
  $$(".filters button").forEach((b) => {
    b.addEventListener("click", () => setDialogueFilter(b.dataset.filter));
  });
  $("#btn-fit").addEventListener("click", fitPage);
  $("#btn-fit-w").addEventListener("click", () => fitSelectedBoxes({ width: true, height: false }));
  $("#btn-fit-h").addEventListener("click", () => fitSelectedBoxes({ width: false, height: true }));
  ui.zoomLabel.addEventListener("change", () => {
    setZoomLevel(ui.zoomLabel.value);
    ui.zoomLabel.blur();
  });
  $("#btn-hide-paint").addEventListener("click", () => {
    state.hidePaint = !state.hidePaint;
    if (state.hidePaint) state.showOriginal = false;
    applyCompare();
  });
  $("#btn-hide-text").addEventListener("click", () => {
    state.showOriginal = !state.showOriginal;
    if (state.showOriginal) state.hidePaint = false;
    applyCompare();
  });
  $("#btn-clear-paint").addEventListener("click", async () => {
    if (!state.pageName) return;
    if (!confirmT("confirm.clearPaint")) return;
    pushHistory({ paint: true, projectData: false });
    ui.paintCtx.clearRect(0, 0, ui.paint.width, ui.paint.height);
    const stem = state.pageName.replace(/\.[^.]+$/, "");
    try {
      const res = await fetch("/api/erase/" + encodeURIComponent(stem) + ".png", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      state.paintDirty = false;
    } catch {
      state.paintDirty = true;
      await saveEraseNow();
      if (state.paintDirty) toastT("clearPaintFail");
    }
  });
  $("#btn-unplace-text").addEventListener("click", unplaceSelectedTexts);
  $("#btn-del-text").addEventListener("click", deleteSelectedTexts);
  bindHint($("#btn-unplace-text"), "btn-unplace-text");
  bindHint($("#btn-del-text"), "btn-del-text");
  bindHint($("#btn-fonts-panel"), "btn-fonts");
  bindThumbsSort();
  if (ui.pageMenu) {
    $("#page-menu-delete")?.addEventListener("click", () => deletePage(ui.pageMenu.dataset.name));
    document.addEventListener("pointerdown", (e) => {
      if (!ui.pageMenu.hidden && !ui.pageMenu.contains(e.target)) hidePageMenu();
    });
    window.addEventListener("blur", hidePageMenu);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePageMenu();
    });
  }
  $("#btn-modal-append").addEventListener("click", () => {
    ui.modal.hidden = false;
    ui.bulkText.focus();
  });
  $("#btn-auto").addEventListener("click", openAutoModal);
  $("#btn-auto-cancel").addEventListener("click", closeAutoModal);
  $("#btn-auto-pages-current").addEventListener("click", () => setPagePickSelection(ui.autoPages, "current"));
  const btnGlossaryAdd = $("#btn-glossary-add");
  if (btnGlossaryAdd) btnGlossaryAdd.addEventListener("click", addGlossaryRow);
  const glossaryText = $("#auto-glossary-text");
  if (glossaryText) glossaryText.addEventListener("input", onGlossaryTextInput);
  $$("[data-settings-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setSettingsTab(btn.dataset.settingsTab));
  });
  $("#auto-pages-all").addEventListener("change", () => {
    setPagePickSelection(ui.autoPages, $("#auto-pages-all").checked ? "all" : "none");
  });
  $("#btn-api-settings").addEventListener("click", openSettingsModal);
  $("#btn-set-cancel").addEventListener("click", () => {
    ui.settingsModal.hidden = true;
  });
  $("#btn-set-reset-prompt").addEventListener("click", () => {
    ui.setOcrPrompt.value = t("prompts.ocr");
    ui.setTranslatePrompt.value = t("prompts.translate");
  });
  $("#btn-set-save").addEventListener("click", async () => {
    try {
      setSettingsBusy(true);
      await saveApiSettings();
      toastT("apiSaved");
    } catch (err) {
      toast(err.message);
    } finally {
      setSettingsBusy(false);
    }
  });
  $("#btn-set-test").addEventListener("click", async () => {
    setSettingsBusy(true);
    try {
      try {
        await saveApiSettings();
      } catch {
        probeToast("api", { ok: false, code: "unknown" });
        return;
      }
      probeToast("api", await postProbe("/api/auto/test"));
    } finally {
      setSettingsBusy(false);
    }
  });
  $("#btn-set-vision").addEventListener("click", async () => {
    setSettingsBusy(true);
    try {
      try {
        await saveApiSettings();
      } catch {
        probeToast("vision", { ok: false, code: "unknown" });
        return;
      }
      probeToast("vision", await postProbe("/api/auto/test-vision"));
    } finally {
      setSettingsBusy(false);
    }
  });
  ui.btnAutoRun.addEventListener("click", runAutoPipeline);
  ui.btnAutoApply.addEventListener("click", applyAutoResults);
  $("#btn-modal-cancel").addEventListener("click", () => {
    ui.modal.hidden = true;
  });
  $("#btn-modal-replace").addEventListener("click", () => {
    const blank = $("#opt-blank").checked;
    const bilingual = $("#opt-bilingual").checked;
    const rows = parseBulk(ui.bulkText.value, blank, bilingual);
    project.dialogue.push(...rows);
    if (rows[0] && !state.selectedDialogueId) selectDialogues([rows[0].id]);
    ui.modal.hidden = true;
    renderDialogue();
    markDirty();
    toastT("addedDialogue", { n: rows.length });
  });
  restoreApplyProps();
  loadStylePresets();
  fillStylePresetSelect();
  ui.stylePreset.addEventListener("change", () => {
    if (!ui.stylePreset.value) return;
    applyStylePreset(ui.stylePreset.value);
  });
  $("#btn-style-presets").addEventListener("click", openStyleModal);
  $("#btn-style-close").addEventListener("click", () => {
    ui.styleModal.hidden = true;
  });
  $("#btn-style-add").addEventListener("click", addStylePreset);
  ui.spIsDefault?.addEventListener("change", () => {
    setPresetAsDefault(ui.spIsDefault.checked);
  });
  $("#btn-style-from-current")?.addEventListener("click", applyCurrentFormToPreset);
  bindHint($("#btn-style-from-current"), "btn-style-from-current");
  $("#btn-style-remove").addEventListener("click", deleteStylePreset);
  [
    "spFont",
    "spFontSize",
    "spFontWeight",
    "spWritingMode",
    "spAlignH",
    "spFillColor",
    "spStrokeColor",
    "spStrokeWidth",
    "spLineHeight",
    "spLetterSpacing",
    "spRotation",
    "spBoxW",
    "spBoxH",
  ].forEach((key) => {
    if (!ui[key]) return;
    ui[key].addEventListener("input", () => commitStyleEditor());
    ui[key].addEventListener("change", () => commitStyleEditor({ list: true }));
  });
  $$("#style-editor [data-prop]").forEach((box) => {
    box.addEventListener("change", () => {
      const p = bag.stylePresets.find((x) => x.id === bag.editingPresetId);
      if (!p) return;
      p.props[box.dataset.prop] = box.checked;
      $$("#style-editor [data-prop='" + box.dataset.prop + "']").forEach((el) => {
        el.checked = box.checked;
      });
      saveStylePresets();
      syncStyleEditorLocks();
    });
  });
  $$(".apply-box [data-prop]").forEach((box) => {
    box.addEventListener("change", rememberApplyProps);
  });
  $("#btn-apply-page").addEventListener("click", () => {
    applyStyleToTexts(currentTexts());
    toastT("applyPage");
  });
  $("#btn-apply-all").addEventListener("click", () => {
    const all = Object.values(project.pages).flatMap((p) => p.texts || []);
    applyStyleToTexts(all, { allPages: true });
    toastT("applyAll");
  });
  $("#btn-save").addEventListener("click", async () => {
    await saveEraseNow();
    await saveProject();
    toastT("projectSaved");
  });
  $("#btn-open-project").addEventListener("click", () => switchWorkspace("open"));
  $("#btn-new-project").addEventListener("click", () => switchWorkspace("new"));
  $("#btn-export").addEventListener("click", () => {
    if (!state.pages.length) {
      toastT("needImport");
      return;
    }
    renderPagePicks(ui.exportPages, state.pageName ? [state.pageName] : state.pages.map((p) => p.name));
    ui.exportModal.hidden = false;
  });
  $("#btn-export-cancel").addEventListener("click", () => {
    if (!state.exporting) ui.exportModal.hidden = true;
  });
  $("#btn-export-pages-current").addEventListener("click", () => setPagePickSelection(ui.exportPages, "current"));
  $("#export-pages-all").addEventListener("change", () => {
    setPagePickSelection(ui.exportPages, $("#export-pages-all").checked ? "all" : "none");
  });
  $("#btn-export-run").addEventListener("click", async () => {
    if (state.exporting) return;
    const names = selectedPagePicks(ui.exportPages);
    if (!names.length) {
      toastT("pickExport");
      return;
    }
    state.exporting = true;
    ui.btnExportRun.disabled = true;
    try {
      await saveEraseNow();
      await saveProject();
      for (let i = 0; i < names.length; i++) {
        toastT("exporting", { i: i + 1, n: names.length });
        await exportPage(names[i]);
      }
      ui.exportModal.hidden = true;
      toastT(names.length === 1 ? "exportedOne" : "exportedMany", { n: names.length });
    } catch (err) {
      toastT("exportFail", { msg: err.message || err });
    } finally {
      state.exporting = false;
      ui.btnExportRun.disabled = false;
    }
  });
  $("#btn-import-page").addEventListener("click", () => ui.pageFile.click());
  ui.pageFile.addEventListener("change", async () => {
    const files = [...ui.pageFile.files];
    if (!files.length) return;
    const imported = [];
    try {
      for (const file of files) {
        const res = await fetch("/api/pages", {
          method: "POST",
          headers: { "X-Filename": encodeURIComponent(file.name) },
          body: file,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || file.name);
        imported.push(data.name);
      }
      await refreshPages({ select: imported[0] });
      toastT(imported.length === 1 ? "importedOne" : "importedMany", { name: imported[0], n: imported.length });
    } catch (err) {
      toastT("importFail", { msg: err.message || err });
    }
    ui.pageFile.value = "";
  });
  bindFontLibrary();
  $("#btn-help").addEventListener("click", () => {
    ui.help.hidden = false;
  });
  $("#btn-help-close").addEventListener("click", () => {
    ui.help.hidden = true;
  });
  $$(".modal").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      if (el === ui.autoModal) {
        closeAutoModal();
        return;
      }
      if (el === ui.exportModal && state.exporting) return;
      el.hidden = true;
    });
  });
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable) {
      if (e.key === "Escape") {
        e.target.blur();
        if (bag.inlineEdit) {
          e.preventDefault();
          endInlineEdit();
        }
      }
      return;
    }
    if (e.key === "Escape" && (bag.drag || bag.picking)) {
      e.preventDefault();
      finishPointer(e, true);
      return;
    }
    if (e.key === "Escape" && bag.inlineEdit) {
      e.preventDefault();
      endInlineEdit();
      return;
    }
    if ((e.key === "F2" || e.key === "Enter") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const box = ui.texts?.querySelector(".text-box.selected");
      if (box && !box.classList.contains("editing")) {
        e.preventDefault();
        startInlineEdit(box);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
      e.preventDefault();
      $("#btn-save").click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyX") {
      e.preventDefault();
      cutSelectedTexts();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") {
      e.preventDefault();
      copySelectedTexts(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") {
      e.preventDefault();
      pasteTexts();
      return;
    }
    const nextTool = TOOL_KEYS[e.code];
    if (nextTool) {
      e.preventDefault();
      if (e.repeat || bag.toolHold.code) return;
      bag.toolHold.code = e.code;
      bag.toolHold.prev = state.tool;
      bag.toolHold.long = false;
      setTool(nextTool, { temp: true });
      bag.toolHold.timer = setTimeout(() => {
        bag.toolHold.long = true;
      }, TOOL_HOLD_MS);
      return;
    }
    if (e.key === "[" ) ui.brushSize.value = String(clamp(Number(ui.brushSize.value) - 4, 4, 220));
    if (e.key === "]" ) ui.brushSize.value = String(clamp(Number(ui.brushSize.value) + 4, 4, 220));
    if (e.key === "[" || e.key === "]") ui.brushSize.dispatchEvent(new Event("input"));
    if (e.key === "Delete" || e.key === "Backspace") $("#btn-del-text").click();
    if (e.key === "ArrowLeft" && e.altKey) {
      const i = state.pages.findIndex((p) => p.name === state.pageName);
      if (i > 0) loadPage(state.pages[i - 1].name);
    }
    if (e.key === "ArrowRight" && e.altKey) {
      const i = state.pages.findIndex((p) => p.name === state.pageName);
      if (i >= 0 && i < state.pages.length - 1) loadPage(state.pages[i + 1].name);
    }
    const moving = selectedTexts();
    if (moving.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) pushHistory({ paint: false, projectData: true });
      const step = e.shiftKey ? 10 : 1;
      for (const t of moving) {
        if (e.key === "ArrowLeft") t.x -= step;
        if (e.key === "ArrowRight") t.x += step;
        if (e.key === "ArrowUp") t.y -= step;
        if (e.key === "ArrowDown") t.y += step;
        syncTextEl(t);
      }
      markDirty();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === bag.toolHold.code) {
      const prev = bag.toolHold.prev;
      const wasLong = bag.toolHold.long;
      clearToolHold();
      if (wasLong && prev && prev !== state.tool) setTool(prev);
    }
  });
  window.addEventListener("blur", () => {
    if (bag.toolHold.code && bag.toolHold.long && bag.toolHold.prev) setTool(bag.toolHold.prev);
    clearToolHold();
  });
}

function cacheUi() {
  ui.viewport = $("#viewport");
  ui.world = $("#world");
  ui.base = $("#base");
  ui.paint = $("#paint");
  ui.texts = $("#texts");
  ui.baseCtx = ui.base.getContext("2d", { willReadFrequently: true });
  ui.paintCtx = ui.paint.getContext("2d", { willReadFrequently: true });
  ui.thumbs = $("#thumbs");
  ui.pageMenu = $("#page-menu");
  ui.pageCount = $("#page-count");
  ui.dialogueList = $("#dialogue-list");
  ui.zoomLabel = $("#zoom-label");
  ui.zoomFace = $("#zoom-face");
  ui.statusPage = $("#status-page");
  ui.statusHint = $("#status-hint");
  ui.projectName = $("#project-name");
  ui.brushCursor = $("#brush-cursor");
  ui.pickerCursor = $("#picker-cursor");
  ui.rectPreview = $("#rect-preview");
  ui.lassoPreview = $("#lasso-preview");
  ui.lassoCtx = ui.lassoPreview ? ui.lassoPreview.getContext("2d") : null;
  ui.brushSize = $("#brush-size");
  ui.brushSizeVal = $("#brush-size-val");
  ui.brushHard = $("#brush-hard");
  ui.brushColor = $("#brush-color");
  ui.fontFamily = $("#font-family");
  ui.fontSize = $("#font-size");
  ui.fontWeight = $("#font-weight");
  ui.writingMode = $("#writing-mode");
  ui.alignH = $("#align-h");
  ui.fillColor = $("#fill-color");
  ui.fillOpacity = $("#fill-opacity");
  ui.strokeColor = $("#stroke-color");
  ui.strokeWidth = $("#stroke-width");
  ui.lineHeight = $("#line-height");
  ui.letterSpacing = $("#letter-spacing");
  ui.rotation = $("#rotation");
  ui.boxW = $("#box-w");
  ui.boxH = $("#box-h");
  ui.sizeMode = $("#size-mode");
  ui.stylePreset = $("#style-preset");
  ui.styleModal = $("#style-modal");
  ui.stylePresetList = $("#style-preset-list");
  ui.styleEditor = $("#style-editor");
  ui.stylePreviewInner = $("#style-preview-inner");
  ui.spIsDefault = $("#sp-is-default");
  ui.spFont = $("#sp-font");
  ui.spFontSize = $("#sp-font-size");
  ui.spFontWeight = $("#sp-font-weight");
  ui.spWritingMode = $("#sp-writing-mode");
  ui.spAlignH = $("#sp-align-h");
  ui.spFillColor = $("#sp-fill-color");
  ui.spFillOpacity = $("#sp-fill-opacity");
  ui.spStrokeColor = $("#sp-stroke-color");
  ui.spStrokeWidth = $("#sp-stroke-width");
  ui.spLineHeight = $("#sp-line-height");
  ui.spLetterSpacing = $("#sp-letter-spacing");
  ui.spRotation = $("#sp-rotation");
  ui.spBoxW = $("#sp-box-w");
  ui.spBoxH = $("#sp-box-h");
  ui.autoAdvance = $("#auto-advance");
  ui.modal = $("#modal");
  ui.help = $("#help");
  ui.bulkText = $("#bulk-text");
  ui.optBlank = $("#opt-blank");
  ui.optBilingual = $("#opt-bilingual");
  ui.fontFile = $("#font-file");
  ui.fontModal = $("#font-modal");
  ui.fontList = $("#font-list");
  ui.fontDrop = $("#font-drop");
  ui.fontSearch = $("#font-search");
  ui.fontCount = $("#font-count");
  ui.pageFile = $("#page-file");
  ui.exportModal = $("#export-modal");
  ui.exportPages = $("#export-pages");
  ui.btnExportRun = $("#btn-export-run");
  ui.toast = $("#toast");
  ui.autoModal = $("#auto-modal");
  ui.autoPages = $("#auto-pages");
  ui.autoBreak = $("#auto-break");
  ui.autoSfx = $("#auto-sfx");
  ui.autoPlace = $("#auto-place");
  ui.autoErase = $("#auto-erase");
  ui.autoLogBox = $("#auto-log");
  ui.autoPreview = $("#auto-preview");
  ui.autoGlossary = $("#auto-glossary");
  ui.autoGlossaryText = $("#auto-glossary-text");
  ui.btnGlossaryAdd = $("#btn-glossary-add");
  ui.btnAutoRun = $("#btn-auto-run");
  ui.btnAutoApply = $("#btn-auto-apply");
  ui.btnAutoCancel = $("#btn-auto-cancel");
  ui.settingsModal = $("#settings-modal");
  ui.setOcrEngine = $("#set-ocr-engine");
  ui.setApiBase = $("#set-api-base");
  ui.setModel = $("#set-model");
  ui.setApiKey = $("#set-api-key");
  ui.setOcrPrompt = $("#set-ocr-prompt");
  ui.setTranslatePrompt = $("#set-translate-prompt");
}

function applyWorkspaceToUi(ws) {
  state.workspaceId = (ws && ws.id) || "";
  if (!ui.projectName) return;
  ui.projectName.textContent = (ws && ws.name) || t("ui.projectFallback");
  ui.projectName.title = (ws && ws.folder) || "";
}

async function switchWorkspace(action) {
  if (state.exporting || bag.autoBusy) return;
  try {
    if (state.paintDirty) await saveEraseNow();
    if (state.dirty) await saveProject();
    const res = await fetch("/api/workspace/" + action, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.cancelled) return;
    if (!res.ok || !data.ok) throw new Error(data.error || action);
    applyWorkspaceToUi(data);
    await bootProject();
    toastT(action === "new" ? "projectCreated" : "projectOpened", { name: data.name });
  } catch (err) {
    toastT("projectSwitchFail", { msg: err.message || err });
  }
}

async function bootProject() {
  clearTimeout(bag.saveTimer);
  clearTimeout(bag.eraseTimer);
  pageHistory.clear();
  state.pages = [];
  state.pageName = "";
  state.dirty = false;
  state.paintDirty = false;
  clearDialogueSelection();
  selectOnly(null);
  state.collapsedFolders = new Set();
  project.dialogue = [];
  project.pages = {};
  project.defaultStyle = defaultStyle();
  project.glossary = [];
  if (ui.texts) ui.texts.innerHTML = "";
  if (ui.baseCtx && ui.base) ui.baseCtx.clearRect(0, 0, ui.base.width, ui.base.height);
  if (ui.paintCtx && ui.paint) ui.paintCtx.clearRect(0, 0, ui.paint.width, ui.paint.height);

  const [wsRes, pagesRes, projRes] = await Promise.all([
    apiGet("/api/workspace"),
    apiGet("/api/pages"),
    apiGet("/api/project"),
  ]);
  const ws = await wsRes.json();
  applyWorkspaceToUi(ws);
  const pagesData = await pagesRes.json();
  const saved = await projRes.json();
  if (saved.dialogue) project.dialogue = saved.dialogue;
  if (saved.pages) project.pages = saved.pages;
  project.glossary = Array.isArray(saved.glossary)
    ? saved.glossary.map((row) => ({
        src: String(row?.src || ""),
        text: String(row?.text || ""),
      }))
    : [];
  state.pages = applyPageOrder(pagesData.pages || [], saved.pageOrder || []);
  if (saved.defaultStyle) project.defaultStyle = { ...defaultStyle(), ...saved.defaultStyle };
  const sid = saved.selectedDialogueId || project.dialogue[0]?.id || null;
  selectDialogues(sid ? [sid] : []);
  for (const d of project.dialogue) {
    if (!d.pageName) d.pageName = placedPageOf(d.id) || "";
  }
  if (Array.isArray(saved.collapsedFolders)) {
    state.collapsedFolders = new Set(saved.collapsedFolders);
  } else {
    for (const p of state.pages) {
      if (!project.dialogue.some((d) => dialogueFolderOf(d) === p.name)) {
        state.collapsedFolders.add(p.name);
      }
    }
  }
  applyFontCatalog(saved.fonts || saved.importedFonts || []);
  writeStyleToForm(project.defaultStyle);
  renderThumbs();
  const first = [recalledPage(), saved.pageName, state.pages[0]?.name]
    .find((name) => name && state.pages.some((p) => p.name === name));
  if (!first) {
    renderDialogue();
    updateStatusPage();
    setStatusHint(toolHint());
    toastT("importPagesHint");
    return;
  }
  const pageP = loadPage(first, { fit: true });
  renderDialogue();
  await pageP;
  setStatusHint(toolHint());
}

async function init() {
  cacheUi();
  fillFontSelect();
  bindPointers();
  bindForm();
  bindButtons();
  bindKeys();
  setTool("select");
  await Promise.all([loadCopy(), bootProject()]);
}

init().catch((err) => {
  console.error(err);
  toastT("bootFail", { msg: err.message });
});
