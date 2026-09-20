// --- 頁面 ---
import { $$, state, project, ui, bag, pageHistory, fontFileByFamily, loadedFamilies, SYSTEM_FONTS, pageMediaUrl, pageEntry, rememberPage } from "./store.js";
import { t, toastT, confirmT } from "./copy.js";
import { apiGet, saveProject, saveEraseNow, markDirty } from "./api.js";
import { applyView, fitPage, applyCompare, updateStatusPage } from "./view.js";
import { writeStyleToForm, syncStyleFontSelect } from "./style.js";
import { selectOnly, renderTexts } from "./text.js";
import { renderDialogue, listInsertAt, markListInsert, moveArrayItem } from "./dialogue.js";
import { updateHistoryButtons } from "./history.js";
function fillFontSelect(imported) {
  const current = ui.fontFamily.value || project.defaultStyle.font;
  const names = [...imported.map((f) => f.replace(/\.[^.]+$/, "")), ...SYSTEM_FONTS];
  const uniq = [...new Set(names)];
  ui.fontFamily.replaceChildren();
  for (const n of uniq) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    ui.fontFamily.appendChild(opt);
  }
  ui.fontFamily.value = uniq.includes(current) ? current : uniq[0];
  project.defaultStyle.font = ui.fontFamily.value;
  syncStyleFontSelect();
}

function familyOfFontFile(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function registerImportedFonts(list) {
  fontFileByFamily.clear();
  for (const name of list || []) {
    const family = familyOfFontFile(name);
    if (family) fontFileByFamily.set(family, name);
  }
  fillFontSelect(list || []);
}

async function ensureFontLoaded(family) {
  if (!family || loadedFamilies.has(family)) return;
  const name = fontFileByFamily.get(family);
  if (!name) {
    loadedFamilies.add(family);
    return;
  }
  loadedFamilies.add(family);
  try {
    const face = new FontFace(family, `url(/fonts/${encodeURIComponent(name)})`);
    await face.load();
    document.fonts.add(face);
  } catch (err) {
    loadedFamilies.delete(family);
    console.warn("font", name, err);
  }
}

async function ensureFontsForTexts(texts) {
  const families = new Set();
  for (const item of texts || []) {
    if (item?.font) families.add(item.font);
  }
  await Promise.all([...families].map(ensureFontLoaded));
}

async function loadPage(name, { fit = false } = {}) {
  if (state.pageName && state.paintDirty) await saveEraseNow();
  if (state.dirty) await saveProject();
  const img = new Image();
  img.src = pageMediaUrl(name);
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
  const stem = name.replace(/\.[^.]+$/, "");
  try {
    const eraseImg = new Image();
    eraseImg.src = "/api/erase/" + encodeURIComponent(stem) + ".png?t=" + Date.now();
    await eraseImg.decode();
    ui.paintCtx.drawImage(eraseImg, 0, 0);
  } catch {
    /* no erase yet */
  }
  const entry = pageEntry(name);
  await ensureFontsForTexts(entry.texts);
  renderTexts();
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
  registerImportedFonts,
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
