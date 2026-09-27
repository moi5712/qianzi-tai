// --- 啟動 ---
import { $, state, project, ui, bag, pageHistory, defaultStyle, recalledPage, selectDialogues, clearDialogueSelection } from "./store.js";
import { t, toastT, toolHint, setStatusHint, loadCopy } from "./copy.js";
import { apiGet, saveProject, saveEraseNow } from "./api.js";
import { writeStyleToForm } from "./style.js";
import { selectOnly } from "./text.js";
import { setTool, updateStatusPage } from "./view.js";
import { renderDialogue, placedPageOf, dialogueFolderOf } from "./dialogue.js";
import { loadPage, renderThumbs, applyPageOrder } from "./pages.js";
import { fillFontSelect } from "./fontload.js";
import { applyFontCatalog } from "./fonts.js";
import { bindPointers, bindKeys } from "./bind-input.js";
import { bindForm, bindButtons } from "./bind-ui.js";
import { bindEditMenu } from "./ctx-menu.js";
import { installWebBackend, WEB_MODE, applyWebUi } from "./web-backend.js";

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
  ui.editMenu = $("#edit-menu");
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
  ui.keys = $("#keys");
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

  const [wsRes, pagesRes, projRes, fontsRes] = await Promise.all([
    apiGet("/api/workspace"),
    apiGet("/api/pages"),
    apiGet("/api/project"),
    apiGet("/api/fonts"),
  ]);
  const ws = await wsRes.json();
  applyWorkspaceToUi(ws);
  const pagesData = await pagesRes.json();
  const saved = await projRes.json();
  const fontsData = await fontsRes.json().catch(() => ({}));
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
  applyFontCatalog(fontsData.fonts || saved.fonts || saved.importedFonts || []);
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
  await installWebBackend();
  cacheUi();
  if (WEB_MODE) applyWebUi();
  fillFontSelect();
  bindPointers();
  bindForm();
  bindButtons(switchWorkspace);
  bindEditMenu();
  bindKeys();
  setTool("select");
  await Promise.all([loadCopy(), bootProject()]);
}

init().catch((err) => {
  console.error(err);
  toastT("bootFail", { msg: err.message });
});
