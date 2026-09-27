// --- 指標與鍵盤 ---
import { $, $$, state, ui, bag, TOOL_KEYS, TOOL_HOLD_MS, clamp, currentTexts, selectedDialogueList, usedDialogueIds } from "./store.js";
import { writeStyleToForm } from "./style.js";
import { placeTextAt, createEmptyDialogueAt, startInlineEdit, endInlineEdit, selectOnly, selectedText, selectedTexts, toggleSelect, selectByMarquee, refreshSelection, syncTextEl, restoreEditSelection } from "./text.js";
import { canEditAct, dispatchEditAction, hideEditMenu } from "./ctx-menu.js";
import { snapshotResize, applyBoxResize } from "./boxgeom.js";
import { pushHistory, undo, redo, captureState, commitHistory } from "./history.js";
import { setTool, applyView, clientToImage, clearToolHold, zoomAt } from "./view.js";
import { strokeSegment, updateBrushCursor, updatePickerCursor, updateRectPreview, hideRectPreview, updateLassoPreview, hideLassoPreview, fillLasso, previewPickAt, applyPickColor } from "./paint.js";
import { saveEraseSoon, markDirty } from "./api.js";
import { captureCharSel, charStyleAt, clearCharSel, clearNativeSel, readInnerRange, paintCharHighlight, restoreCharSel, placeCaret, caretOffset } from "./glyphs.js";
import { loadPage } from "./pages.js";

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
  if (bag.picking) {
    if (!cancelled && e) {
      const p = clientToImage(e.clientX, e.clientY);
      applyPickColor(p.x, p.y);
    } else {
      bag.pickHex = "";
      updatePickerCursor(e);
    }
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
    if (e.target.closest(".text-box")) return;
    e.preventDefault();
  });

  ui.viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#view-float")) return;
    if (!e.target.closest(".text-box")) {
      endInlineEdit();
      bag.editArmed = false;
    }
    if (e.button === 2) {
      if (e.target.closest(".text-box")) return;
      e.preventDefault();
      ui.viewport.setPointerCapture(e.pointerId);
      bag.picking = true;
      const p = clientToImage(e.clientX, e.clientY);
      updatePickerCursor(e);
      previewPickAt(p.x, p.y);
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
      bag.picking = true;
      updatePickerCursor(e);
      previewPickAt(p.x, p.y);
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
      state.paintDirty = true;
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
    if (state.tool === "brush" || state.tool === "eraser" || state.tool === "picker" || bag.picking) {
      if (!bag.cursorRaf) {
        bag.cursorRaf = requestAnimationFrame(() => {
          bag.cursorRaf = 0;
          const ev = bag.cursorEvent;
          if (!ev) return;
          if (state.tool === "brush" || state.tool === "eraser") updateBrushCursor(ev);
          if (state.tool === "picker" || bag.picking) {
            updatePickerCursor(ev);
            const p = clientToImage(ev.clientX, ev.clientY);
            previewPickAt(p.x, p.y);
          }
        });
      }
      bag.cursorEvent = e;
    }
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
      state.paintDirty = true;
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
    if (bag.selRaf) return;
    bag.selRaf = requestAnimationFrame(() => {
      bag.selRaf = 0;
      onSelectionChange();
    });
  });
  function onSelectionChange() {
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
  }

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
      e.preventDefault();
      e.stopPropagation();
      bag.editFocus = "text";
      hideEditMenu();
      const t = currentTexts().find((x) => x.id === box.dataset.id);
      if (t) {
        if (!state.selectedTextIds.has(t.id)) selectOnly(t.id);
        else state.selectedTextId = t.id;
        refreshSelection();
        writeStyleToForm(t);
      }
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

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyC" || e.code === "KeyV")) {
      e.preventDefault();
      dispatchEditAction(e.code === "KeyC" ? "copy-style" : "paste-style");
      return;
    }
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
      dispatchEditAction("cut");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") {
      e.preventDefault();
      dispatchEditAction("copy");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") {
      e.preventDefault();
      dispatchEditAction("paste");
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
    if (e.key === "Backspace") {
      if (!canEditAct("unplace")) return;
      e.preventDefault();
      dispatchEditAction("unplace");
      return;
    }
    if (e.key === "Delete") {
      if (!canEditAct("delete")) return;
      e.preventDefault();
      dispatchEditAction("delete");
      return;
    }
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

export { bindPointers, bindKeys };
