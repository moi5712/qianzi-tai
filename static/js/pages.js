// --- 頁面 ---
import { $$, state, project, ui, bag, pageHistory, importedFontList, fontFileByFamily, fontFacesByFamily, loadedFamilies, pageMediaUrl, pageEntry, rememberPage } from "./store.js";
import { t, toastT, confirmT } from "./copy.js";
import { apiGet, saveProject, saveEraseNow, markDirty } from "./api.js";
import { applyView, fitPage, applyCompare, updateStatusPage } from "./view.js";
import { writeStyleToForm, syncStyleFontSelect } from "./style.js";
import { selectOnly, renderTexts } from "./text.js";
import { renderDialogue, listInsertAt, markListInsert, moveArrayItem } from "./dialogue.js";
import { updateHistoryButtons } from "./history.js";
const FONT_WEIGHT_TAIL = /[-_](thin|extralight|ultralight|extra-?light|light|book|regular|medium|semibold|semi-?bold|demibold|bold|extrabold|extra-?bold|ultrabold|heavy|black)$/i;

function familyOfFontFile(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function fontGroupOf(font) {
  if (font?.builtin) return { group: font.family, weight: font.weightLabel || "" };
  const stem = font?.family || familyOfFontFile(font?.file);
  const m = String(stem || "").match(FONT_WEIGHT_TAIL);
  if (!m) return { group: stem, weight: "" };
  return { group: stem.slice(0, -m[0].length), weight: m[1] };
}

function fontDisplayLabel(font) {
  if (!font) return "";
  if (font.builtin) return font.label || font.family;
  if (font.label && font.label !== font.family) return font.label;
  const { group, weight } = fontGroupOf(font);
  return weight ? group + " " + weight : (font.label || font.family);
}

function uniqueFontFamilies(list) {
  const seen = new Set();
  const out = [];
  for (const font of list || []) {
    if (!font?.family || seen.has(font.family)) continue;
    seen.add(font.family);
    out.push(font);
  }
  return out;
}

function groupedImportedFonts() {
  const map = new Map();
  for (const font of importedFontList) {
    const { group } = fontGroupOf(font);
    const key = group || font.family;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(font);
  }
  return [...map.entries()];
}

function normalizeFontEntry(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const file = item;
    const family = familyOfFontFile(file);
    if (!family) return null;
    return { file, family, label: family, weight: 400, weightLabel: "", builtin: false, url: "/fonts/" + file };
  }
  const file = String(item.file || item.name || "");
  const family = String(item.family || familyOfFontFile(file));
  if (!file || !family) return null;
  return {
    file,
    family,
    label: String(item.label || family).trim() || family,
    weight: Number(item.weight) || 400,
    weightLabel: String(item.weightLabel || "").trim(),
    builtin: Boolean(item.builtin),
    url: item.url || ((item.builtin ? "/static/bundled-fonts/" : "/fonts/") + file),
  };
}

function addFontOption(sel, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label || value;
  sel.appendChild(opt);
}

function fillFontSelect() {
  if (!ui.fontFamily) return;
  const current = ui.fontFamily.value || project.defaultStyle.font;
  ui.fontFamily.replaceChildren();
  const builtin = uniqueFontFamilies(importedFontList.filter((f) => f.builtin));
  const custom = uniqueFontFamilies(importedFontList.filter((f) => !f.builtin));
  if (builtin.length) {
    const group = document.createElement("optgroup");
    group.label = "內建";
    for (const font of builtin) addFontOption(group, font.family, fontDisplayLabel(font));
    ui.fontFamily.appendChild(group);
  }
  if (custom.length) {
    const group = document.createElement("optgroup");
    group.label = "已匯入";
    for (const font of custom) addFontOption(group, font.family, fontDisplayLabel(font));
    ui.fontFamily.appendChild(group);
  }
  const values = [...ui.fontFamily.options].map((opt) => opt.value);
  ui.fontFamily.value = values.includes(current) ? current : (builtin[0]?.family || custom[0]?.family || "");
  if (!ui.fontFamily.value && ui.fontFamily.options[0]) ui.fontFamily.selectedIndex = 0;
  project.defaultStyle.font = ui.fontFamily.value;
  syncStyleFontSelect();
}

function registerImportedFonts(list) {
  importedFontList.length = 0;
  fontFileByFamily.clear();
  fontFacesByFamily.clear();
  for (const raw of list || []) {
    const item = normalizeFontEntry(raw);
    if (!item) continue;
    importedFontList.push(item);
    const faces = fontFacesByFamily.get(item.family) || [];
    if (!faces.some((face) => face.file === item.file)) faces.push(item);
    fontFacesByFamily.set(item.family, faces);
    if (!fontFileByFamily.has(item.family)) fontFileByFamily.set(item.family, item.file);
  }
  fillFontSelect();
}

const loadedFaceKeys = new Set();

function faceCacheKey(family, weight) {
  return family + "@" + (Number(weight) || 400);
}

function nearestFontFace(family, weight) {
  const faces = fontFacesByFamily.get(family) || [];
  if (!faces.length) return null;
  const want = Number(weight) || 400;
  let best = faces[0];
  let bestDist = Math.abs(Number(best.weight || 400) - want);
  for (const face of faces) {
    const dist = Math.abs(Number(face.weight || 400) - want);
    if (dist < bestDist) {
      best = face;
      bestDist = dist;
    }
  }
  return best;
}

function unloadFont(family) {
  if (!family) return;
  loadedFamilies.delete(family);
  for (const key of [...loadedFaceKeys]) {
    if (key.startsWith(family + "@")) loadedFaceKeys.delete(key);
  }
  for (const face of [...document.fonts]) {
    if (face.family === family || face.family === `"${family}"`) document.fonts.delete(face);
  }
}

const fontLoadWait = new Map();

async function ensureFontLoaded(family, weight) {
  if (!family) return;
  const face = nearestFontFace(family, weight);
  if (!face) {
    loadedFamilies.add(family);
    return;
  }
  const key = faceCacheKey(family, face.weight);
  if (loadedFaceKeys.has(key)) {
    loadedFamilies.add(family);
    return;
  }
  if (fontLoadWait.has(key)) return fontLoadWait.get(key);
  const done = (async () => {
    try {
      const fontFace = new FontFace(family, `url(${face.url})`, {
        weight: String(face.weight || 400),
        display: "swap",
      });
      document.fonts.add(fontFace);
      await fontFace.load();
      loadedFaceKeys.add(key);
      loadedFamilies.add(family);
    } catch (err) {
      console.warn("font", family, err);
    } finally {
      fontLoadWait.delete(key);
    }
  })();
  fontLoadWait.set(key, done);
  return done;
}

function collectTextFontJobs(texts) {
  const jobs = [];
  const seen = new Set();
  const add = (font, weight) => {
    if (!font) return;
    const key = faceCacheKey(font, weight);
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push(ensureFontLoaded(font, weight));
  };
  for (const item of texts || []) {
    add(item?.font, item?.fontWeight);
    for (const run of item?.runs || []) {
      add(run.font || item?.font, run.fontWeight ?? item?.fontWeight);
    }
  }
  return jobs;
}

async function ensureFontsForTexts(texts) {
  await Promise.all(collectTextFontJobs(texts));
}

async function loadPage(name, { fit = false } = {}) {
  if (state.pageName && state.paintDirty) await saveEraseNow();
  if (state.dirty) await saveProject();
  const fontsPromise = ensureFontsForTexts(pageEntry(name).texts);
  const img = new Image();
  img.src = pageMediaUrl(name);
  const eraseUrl = state.pages.find((p) => p.name === name)?.erase || "";
  const eraseImg = eraseUrl ? new Image() : null;
  if (eraseImg) eraseImg.src = eraseUrl;
  try {
    await img.decode();
  } catch {
    toastT("pageLoadFail", { name });
    return;
  }
  state.pageName = name;
  selectOnly(null);
  state.imgW = img.naturalWidth;
  state.imgH = img.naturalHeight;
  ui.world.style.width = state.imgW + "px";
  ui.world.style.height = state.imgH + "px";
  for (const c of [ui.base, ui.paint, ui.lassoPreview]) {
    if (!c) continue;
    c.width = state.imgW;
    c.height = state.imgH;
  }
  ui.baseCtx.drawImage(img, 0, 0);
  ui.paintCtx.clearRect(0, 0, state.imgW, state.imgH);
  renderTexts();
  fontsPromise.then(() => {
    if (state.pageName === name) renderTexts();
  });
  if (eraseImg) {
    eraseImg.decode().then(() => {
      if (state.pageName !== name) return;
      ui.paintCtx.drawImage(eraseImg, 0, 0);
    }).catch(() => {});
  }
  applyCompare();
  $$(".thumb").forEach((el) => el.classList.toggle("active", el.dataset.name === name));
  const activeThumb = ui.thumbs.querySelector(".thumb.active");
  if (activeThumb) activeThumb.scrollIntoView({ block: "nearest" });
  updateStatusPage();
  writeStyleToForm(project.defaultStyle);
  if (fit) fitPage();
  else applyView();
  updateHistoryButtons();
  rememberPage(name);
}

function applyPageOrder(pages, order) {
  const byName = new Map((pages || []).map((p) => [p.name, p]));
  const used = new Set();
  const next = [];
  for (const name of order || []) {
    const p = byName.get(name);
    if (p && !used.has(name)) {
      next.push(p);
      used.add(name);
    }
  }
  for (const p of pages || []) {
    if (!used.has(p.name)) next.push(p);
  }
  return next;
}

function hidePageMenu() {
  if (ui.pageMenu) ui.pageMenu.hidden = true;
}

function showPageMenu(e, name) {
  if (!ui.pageMenu) return;
  ui.pageMenu.dataset.name = name;
  ui.pageMenu.hidden = false;
  const x = Math.min(e.clientX, innerWidth - 140);
  const y = Math.min(e.clientY, innerHeight - 48);
  ui.pageMenu.style.left = x + "px";
  ui.pageMenu.style.top = y + "px";
}

function clearPageDropMarks() {
  $$(".thumb.drop-before, .thumb.drop-after, .thumb.dragging").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "dragging");
  });
}

function movePage(fromName, insertAt) {
  const from = state.pages.findIndex((p) => p.name === fromName);
  if (!moveArrayItem(state.pages, from, insertAt)) return;
  renderThumbs();
  renderDialogue();
  updateStatusPage();
  markDirty();
}

async function deletePage(name) {
  if (!name || !state.pages.some((p) => p.name === name)) return;
  if (!confirmT("confirm.deletePage", { name })) return;
  hidePageMenu();
  const idx = state.pages.findIndex((p) => p.name === name);
  const fallback = state.pages[idx + 1]?.name || state.pages[idx - 1]?.name || "";
  const wasCurrent = state.pageName === name;
  let data;
  try {
    const res = await fetch("/api/pages/" + encodeURIComponent(name), { method: "DELETE" });
    data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || t("ui.deleteFail"));
  } catch (err) {
    toastT("deleteFail", { msg: err.message || err });
    return;
  }
  const gone = new Set();
  for (const item of project.pages[name]?.texts || []) {
    if (item.dialogueId) gone.add(item.dialogueId);
  }
  for (const d of project.dialogue) {
    if (d.pageName === name || gone.has(d.id)) gone.add(d.id);
  }
  project.dialogue = project.dialogue.filter((d) => !gone.has(d.id));
  for (const page of Object.values(project.pages)) {
    page.texts = (page.texts || []).filter((item) => !gone.has(item.dialogueId));
  }
  delete project.pages[name];
  pageHistory.delete(name);
  state.collapsedFolders.delete(name);
  state.pages = applyPageOrder(data.pages || [], state.pages.filter((p) => p.name !== name).map((p) => p.name));
  if (wasCurrent) {
    selectOnly(null);
    state.pageName = "";
    state.paintDirty = false;
    if (ui.texts) ui.texts.innerHTML = "";
    if (ui.baseCtx && ui.base) ui.baseCtx.clearRect(0, 0, ui.base.width, ui.base.height);
    if (ui.paintCtx && ui.paint) ui.paintCtx.clearRect(0, 0, ui.paint.width, ui.paint.height);
  } else if (gone.size) {
    renderTexts();
  }
  renderThumbs();
  renderDialogue();
  updateStatusPage();
  rememberPage(wasCurrent ? "" : state.pageName);
  await saveProject();
  if (wasCurrent && fallback && state.pages.some((p) => p.name === fallback)) {
    await loadPage(fallback, { fit: true });
  } else if (wasCurrent) {
    markDirty();
  }
  toastT("deleted", { name });
}

function renderThumbs() {
  ui.thumbs.innerHTML = "";
  state.pages.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb" + (p.name === state.pageName ? " active" : "");
    b.dataset.name = p.name;
    b.draggable = true;
    b.innerHTML = `<img alt="" draggable="false" loading="lazy" src="${p.thumb}" /><span>${String(i + 1).padStart(3, "0")}</span>`;
    b.addEventListener("click", () => {
      if (bag.pageDrag.moved) return;
      loadPage(p.name);
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showPageMenu(e, p.name);
    });
    b.addEventListener("dragstart", (e) => {
      hidePageMenu();
      bag.pageDrag = { name: p.name, moved: false };
      b.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.name);
    });
    b.addEventListener("dragend", () => {
      b.classList.remove("dragging");
      clearPageDropMarks();
      setTimeout(() => {
        bag.pageDrag = { name: null, moved: false };
      }, 0);
    });
    ui.thumbs.appendChild(b);
  });
  ui.pageCount.textContent = String(state.pages.length);
}

function bindThumbsSort() {
  if (!ui.thumbs || ui.thumbs.dataset.sortBound) return;
  ui.thumbs.dataset.sortBound = "1";
  ui.thumbs.addEventListener("dragover", (e) => {
    if (!bag.pageDrag.name) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    bag.pageDrag.moved = true;
    const items = $$(".thumb", ui.thumbs);
    markListInsert(items, listInsertAt(items, e.clientY));
  });
  ui.thumbs.addEventListener("drop", (e) => {
    e.preventDefault();
    const fromName = e.dataTransfer.getData("text/plain") || bag.pageDrag.name;
    const items = $$(".thumb", ui.thumbs);
    const at = listInsertAt(items, e.clientY);
    clearPageDropMarks();
    if (fromName) movePage(fromName, at);
  });
}

async function refreshPages({ select } = {}) {
  const pagesRes = await apiGet("/api/pages");
  const pagesData = await pagesRes.json();
  state.pages = applyPageOrder(pagesData.pages || [], state.pages.map((p) => p.name));
  renderThumbs();
  if (select && state.pages.some((p) => p.name === select)) {
    await loadPage(select, { fit: !state.pageName });
    return;
  }
  if (state.pageName && state.pages.some((p) => p.name === state.pageName)) {
    $$(".thumb").forEach((el) => el.classList.toggle("active", el.dataset.name === state.pageName));
    return;
  }
  const first = state.pages[0]?.name;
  if (first) await loadPage(first, { fit: true });
  else {
    updateStatusPage();
    toastT("importPagesHint");
  }
}

export {
  fillFontSelect,
  familyOfFontFile,
  fontGroupOf,
  fontDisplayLabel,
  uniqueFontFamilies,
  groupedImportedFonts,
  normalizeFontEntry,
  registerImportedFonts,
  unloadFont,
  ensureFontLoaded,
  ensureFontsForTexts,
  loadPage,
  applyPageOrder,
  hidePageMenu,
  deletePage,
  renderThumbs,
  bindThumbsSort,
  refreshPages,
};
