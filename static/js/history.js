// --- 歷史 ---
import { $, state, project, ui, pageHistory, bag, pageEntry, selectedDialogueList } from "./store.js";
import { renderTexts, selectedText, revealDialogueInList, refreshSelection, selectTextsByDialogueIds } from "./text.js";
import { renderDialogue } from "./dialogue.js";
import { writeStyleToForm } from "./style.js";
import { saveEraseSoon, markDirty } from "./api.js";
function clonePaint() {
  if (!ui.paintCtx || !ui.paint.width) return null;
  return ui.paintCtx.getImageData(0, 0, ui.paint.width, ui.paint.height);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function histFor(name = state.pageName) {
  if (!name) return { undo: [], redo: [] };
  if (!pageHistory.has(name)) pageHistory.set(name, { undo: [], redo: [] });
  return pageHistory.get(name);
}

function captureState({ paint = true, projectData = true, allPages = false } = {}) {
  const fullPages = !!(projectData && (allPages || !state.pageName));
  let pages = null;
  if (projectData) {
    pages = fullPages
      ? cloneJson(project.pages)
      : { [state.pageName]: cloneJson(pageEntry()) };
  }
  return {
    paint: paint ? clonePaint() : null,
    pages,
    allPages: fullPages,
    dialogue: projectData ? cloneJson(project.dialogue) : null,
    selectedTextId: state.selectedTextId,
    selectedTextIds: [...state.selectedTextIds],
    selectedDialogueId: state.selectedDialogueId,
    selectedDialogueIds: [...state.selectedDialogueIds],
  };
}

function applyState(entry) {
  bag.restoring = true;
  if (entry.paint && ui.paintCtx) {
    try {
      ui.paintCtx.putImageData(entry.paint, 0, 0);
    } catch {
      ui.paintCtx.clearRect(0, 0, ui.paint.width, ui.paint.height);
    }
    saveEraseSoon();
  }
  if (entry.pages) {
    if (entry.allPages) project.pages = cloneJson(entry.pages);
    else {
      for (const [name, page] of Object.entries(entry.pages)) {
        project.pages[name] = cloneJson(page);
      }
    }
  }
  if (entry.dialogue) project.dialogue = cloneJson(entry.dialogue);
  state.selectedTextId = entry.selectedTextId;
  state.selectedTextIds = new Set(entry.selectedTextIds || (entry.selectedTextId ? [entry.selectedTextId] : []));
  if (entry.selectedDialogueId !== undefined) state.selectedDialogueId = entry.selectedDialogueId;
  if (entry.selectedDialogueIds) state.selectedDialogueIds = new Set(entry.selectedDialogueIds);
  else if (entry.selectedDialogueId) state.selectedDialogueIds = new Set([entry.selectedDialogueId]);
  if (entry.pages) renderTexts();
  if (entry.dialogue) renderDialogue();
  if (state.selectedTextIds.size) {
    refreshSelection();
    const t = selectedText();
    writeStyleToForm(t || project.defaultStyle);
  } else {
    selectTextsByDialogueIds(selectedDialogueList());
    revealDialogueInList(state.selectedDialogueIds);
    writeStyleToForm(selectedText() || project.defaultStyle);
  }
  bag.restoring = false;
  markDirty();
}

function updateHistoryButtons() {
  const h = histFor();
  const undoBtn = $("#btn-undo");
  const redoBtn = $("#btn-redo");
  if (undoBtn) undoBtn.disabled = !h.undo.length;
  if (redoBtn) redoBtn.disabled = !h.redo.length;
}

function commitHistory(entry) {
  if (!entry || !state.pageName) return;
  const h = histFor();
  h.undo.push(entry);
  if (h.undo.length > 20) h.undo.shift();
  h.redo.length = 0;
  updateHistoryButtons();
}

function pushHistory(opts) {
  if (!state.pageName || !ui.paint || !ui.paint.width) return;
  commitHistory(captureState(opts));
}

function undo() {
  const h = histFor();
  if (!h.undo.length) return;
  const entry = h.undo.pop();
  h.redo.push(captureState({ paint: !!entry.paint, projectData: !!entry.pages, allPages: !!entry.allPages }));
  applyState(entry);
  updateHistoryButtons();
}

function redo() {
  const h = histFor();
  if (!h.redo.length) return;
  const entry = h.redo.pop();
  h.undo.push(captureState({ paint: !!entry.paint, projectData: !!entry.pages, allPages: !!entry.allPages }));
  applyState(entry);
  updateHistoryButtons();
}

export {
  captureState,
  updateHistoryButtons,
  commitHistory,
  pushHistory,
  undo,
  redo,
};
