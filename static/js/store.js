// --- 共用狀態與常數 ---

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function fontFamilyCss(name) {
  const family = String(name || "").trim();
  return family
    ? `"${family}", "Microsoft JhengHei", "Noto Sans TC", sans-serif`
    : `"Microsoft JhengHei", "Noto Sans TC", sans-serif`;
}

export const TOOL_KEYS = { KeyV: "select", Space: "pan", KeyB: "brush", KeyE: "eraser", KeyU: "rect", KeyL: "lasso", KeyI: "picker", KeyT: "text" };
export const TOOL_HOLD_MS = 280;

const LAST_PAGE_KEY = "lettering-last-page";
export const SWATCH_KEY = "lettering-swatches";
export const APPLY_PROPS_KEY = "lettering-apply-props";
export const STYLE_PRESET_KEY = "lettering-style-presets";
export const SWATCH_MAX = 24;

export const STYLE_FIELDS = [
  { key: "font", form: "fontFamily", editor: "spFont", type: "str" },
  { key: "fontSize", form: "fontSize", editor: "spFontSize", type: "num", fallback: 32 },
  { key: "fontWeight", form: "fontWeight", editor: "spFontWeight", type: "num", fallback: 700 },
  { key: "vertical", form: "writingMode", editor: "spWritingMode", type: "mode" },
  { key: "alignH", form: "alignH", editor: "spAlignH", type: "str" },
  { key: "color", form: "fillColor", editor: "spFillColor", type: "str" },
  { key: "opacity", form: "fillOpacity", editor: "spFillOpacity", type: "num", fallback: 100 },
  { key: "strokeColor", form: "strokeColor", editor: "spStrokeColor", type: "str" },
  { key: "strokeWidth", form: "strokeWidth", editor: "spStrokeWidth", type: "num", fallback: 0 },
  { key: "lineHeight", form: "lineHeight", editor: "spLineHeight", type: "num", fallback: 1.15 },
  { key: "letterSpacing", form: "letterSpacing", editor: "spLetterSpacing", type: "num", fallback: 0 },
  { key: "rotation", form: "rotation", editor: "spRotation", type: "num", fallback: 0 },
  { key: "w", form: "boxW", editor: "spBoxW", type: "num", fallback: 80 },
  { key: "h", form: "boxH", editor: "spBoxH", type: "num", fallback: 160 },
];

export function defaultStyle() {
  return {
    font: "源暎アンチック",
    fontSize: 32,
    fontWeight: 700,
    vertical: true,
    alignH: "center",
    alignV: "middle",
    color: "#1a1a1a",
    opacity: 100,
    strokeColor: "#ffffff",
    strokeWidth: 3,
    lineHeight: 1.15,
    letterSpacing: 0,
    rotation: 0,
    w: 86,
    h: 170,
  };
}

export function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function rotateVec(x, y, deg) {
  const r = ((deg || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const state = {
  pages: [],
  pageName: "",
  tool: "select",
  zoom: 0.4,
  panX: 40,
  panY: 20,
  imgW: 0,
  imgH: 0,
  dialogueFilter: "all",
  collapsedFolders: new Set(),
  selectedDialogueId: null,
  selectedDialogueIds: new Set(),
  selectedTextId: null,
  selectedTextIds: new Set(),
  dirty: false,
  paintDirty: false,
  exporting: false,
  showOriginal: false,
  hidePaint: false,
  workspaceId: "",
};

export const project = {
  dialogue: [],
  pages: {},
  defaultStyle: defaultStyle(),
  glossary: [],
};

export const ui = {};
export const pageHistory = new Map();
export const importedFontList = [];
export const fontFacesByFamily = new Map();
export const loadedFamilies = new Set();

export const bag = {
  COPY: {},
  saveTimer: 0,
  eraseTimer: 0,
  toastTimer: 0,
  drag: null,
  dialogueDrag: { id: null, moved: false },
  pageDrag: { name: null, moved: false },
  styleDrag: { id: null, moved: false },
  styleEditing: false,
  restoring: false,
  textClip: { items: [], fromCut: false, pasteN: 0 },
  dialogueClip: { items: [], fromCut: false, pasteN: 0 },
  styleClip: null,
  editFocus: "text",
  autoResults: [],
  autoBusy: false,
  autoAbort: null,
  lastColorInputId: "fill-color",
  stylePresets: [],
  editingPresetId: "",
  styleEditorBusy: false,
  toolHold: { code: null, prev: null, long: false, timer: 0 },
  hoveredAction: "",
  formSyncRaf: 0,
  formSyncSeq: 0,
  picking: false,
  pickHex: "",
  charSel: null,
  glyphPick: false,
  inlineEdit: null,
  editArmed: false,
  boxPtr: null,
  editCaret: null,
  cursorRaf: 0,
  cursorEvent: null,
  selRaf: 0,
};

function pageStoreKey() {
  return LAST_PAGE_KEY + ":" + (state.workspaceId || "none");
}

export function rememberPage(name) {
  if (!name) return;
  try {
    localStorage.setItem(pageStoreKey(), name);
  } catch {
    /* ignore */
  }
}

export function recalledPage() {
  try {
    return localStorage.getItem(pageStoreKey()) || "";
  } catch {
    return "";
  }
}

export function pageMediaUrl(name) {
  const page = state.pages.find((p) => p.name === name);
  return page?.url || ("/media/" + encodeURIComponent(name));
}

export function pageEntry(name = state.pageName) {
  if (!name) return { texts: [] };
  if (!project.pages[name]) project.pages[name] = { texts: [] };
  return project.pages[name];
}

export function currentTexts() {
  return pageEntry().texts;
}

export function usedDialogueIds() {
  const ids = new Set();
  for (const page of Object.values(project.pages)) {
    for (const t of page.texts || []) {
      if (t.dialogueId) ids.add(t.dialogueId);
    }
  }
  return ids;
}

export function selectedDialogueList() {
  if (state.selectedDialogueIds.size) return [...state.selectedDialogueIds];
  return state.selectedDialogueId ? [state.selectedDialogueId] : [];
}

export function selectDialogues(ids, primary) {
  const list = [...new Set((ids || []).filter(Boolean))];
  state.selectedDialogueIds = new Set(list);
  state.selectedDialogueId = primary && state.selectedDialogueIds.has(primary)
    ? primary
    : list.at(-1) || null;
}

export function clearDialogueSelection() {
  state.selectedDialogueIds = new Set();
  state.selectedDialogueId = null;
}

export function toggleDialogueId(id) {
  if (!id) return;
  if (state.selectedDialogueIds.has(id)) state.selectedDialogueIds.delete(id);
  else state.selectedDialogueIds.add(id);
  state.selectedDialogueId = state.selectedDialogueIds.has(id)
    ? id
    : [...state.selectedDialogueIds].at(-1) || null;
}
