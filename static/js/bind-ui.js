// --- 表單與按鈕 ---
import { $, $$, state, project, ui, bag, clamp, currentTexts, selectDialogues } from "./store.js";
import { t, toast, toastT, confirmT, toolHint, setStatusHint, bindHint, probeToast } from "./copy.js";
import { saveProject, saveEraseNow, markDirty } from "./api.js";
import { pushHistory, undo, redo } from "./history.js";
import { setTool, applyCompare, fitPage, setZoomLevel, setDialogueFilter } from "./view.js";
import { applyFormToSelected, loadStylePresets, fillStylePresetSelect, restoreApplyProps, rememberApplyProps, decorateNumberInputs, bindSelectWheel, fitSelectedBoxes, applyStyleToTexts, applyStylePreset, openStyleModal, addStylePreset, deleteStylePreset, setPresetAsDefault, applyCurrentFormToPreset, commitStyleEditor, syncStyleEditorLocks, saveStylePresets, copySelectedStyle, pasteCopiedStyle } from "./style.js";
import { renderDialogue, parseBulk, setFoldersCollapsed } from "./dialogue.js";
import { bindThumbsSort, refreshPages, deletePage, hidePageMenu } from "./pages.js";
import { bindFontLibrary } from "./fonts.js";
import { bindColorPopover, fillRange, setColorTarget, addSwatch, renderSwatches } from "./color.js";
import { openAutoModal, closeAutoModal, openSettingsModal, runAutoPipeline, applyAutoResults, saveApiSettings, setPagePickSelection, selectedPagePicks, renderPagePicks, setSettingsBusy, postProbe, addGlossaryRow, onGlossaryTextInput, setSettingsTab } from "./auto.js";
import { exportPage } from "./export.js";
import { WEB_MODE } from "./web-backend.js";

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

function bindButtons(switchWorkspace) {
  decorateNumberInputs();
  $$("#tools button").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool));
    b.addEventListener("pointerenter", () => setStatusHint(toolHint(b.dataset.tool)));
    b.addEventListener("pointerleave", () => setStatusHint(toolHint()));
  });
  ["btn-undo", "btn-redo", "btn-clear-paint", "btn-hide-paint", "btn-hide-text", "btn-fit", "btn-fit-w", "btn-fit-h"].forEach((id) => {
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
  $("#btn-folders-expand").addEventListener("click", () => setFoldersCollapsed(false));
  $("#btn-folders-collapse").addEventListener("click", () => setFoldersCollapsed(true));
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
  $("#btn-copy-style").addEventListener("click", copySelectedStyle);
  $("#btn-paste-style").addEventListener("click", pasteCopiedStyle);
  bindHint($("#btn-copy-style"), "btn-copy-style");
  bindHint($("#btn-paste-style"), "btn-paste-style");
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
    const blank = ui.optBlank?.checked;
    const bilingual = ui.optBilingual?.checked;
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
      toastT(names.length === 1 ? (WEB_MODE ? "exportedOneWeb" : "exportedOne") : (WEB_MODE ? "exportedManyWeb" : "exportedMany"), { n: names.length });
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
  $("#btn-keys").addEventListener("click", () => {
    ui.keys.hidden = false;
  });
  $("#btn-keys-close").addEventListener("click", () => {
    ui.keys.hidden = true;
  });
  $$(".modal").forEach((el) => {
    let downOnBackdrop = false;
    el.addEventListener("pointerdown", (e) => {
      downOnBackdrop = e.target === el;
    });
    el.addEventListener("pointerup", (e) => {
      const close = downOnBackdrop && e.target === el;
      downOnBackdrop = false;
      if (!close) return;
      if (el === ui.autoModal) {
        closeAutoModal();
        return;
      }
      if (el === ui.exportModal && state.exporting) return;
      el.hidden = true;
    });
  });
}


export { bindForm, bindButtons };
