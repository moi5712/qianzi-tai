// --- 對白 ---
import { $$, state, project, ui, bag, uid, usedDialogueIds, selectedDialogueList, selectDialogues, clearDialogueSelection, toggleDialogueId } from "./store.js";
import { t, bindHint } from "./copy.js";
import { pushHistory } from "./history.js";
import { markDirty } from "./api.js";
import { setTool } from "./view.js";
import { syncTextEl, renderTexts, selectOnly, selectTextsByDialogue, selectTextsByDialogueIds, revealDialogueInList, focusDialoguePlacement, removeTextsByDialogue } from "./text.js";
import { clampRuns } from "./glyphs.js";
import { dialogueVisible, parseBulk as parseBulkRaw } from "./dialogue-util.js";
function placedPageOf(id, prefer = state.pageName) {
  let first = "";
  for (const p of state.pages) {
    const texts = project.pages[p.name]?.texts || [];
    if (!texts.some((t) => t.dialogueId === id)) continue;
    if (p.name === prefer) return p.name;
    if (!first) first = p.name;
  }
  return first;
}

function dialogueFolderOf(d) {
  return d.pageName || "";
}

function pageLabel(name) {
  const idx = state.pages.findIndex((p) => p.name === name);
  const num = idx >= 0 ? String(idx + 1).padStart(3, "0") : name;
  return idx >= 0 ? t("ui.pageFolder", { n: idx + 1, num }) : name;
}

function editableText(el) {
  const raw = (el.innerText || "").replace(/\r/g, "");
  return raw === "\n" ? "" : raw;
}

function syncDialogueFromText(t) {
  if (!t?.dialogueId) return;
  const d = project.dialogue.find((x) => x.id === t.dialogueId);
  if (!d || d.text === t.text) return;
  d.text = t.text;
  const body = ui.dialogueList.querySelector(`.line[data-id="${t.dialogueId}"] .body`);
  if (body && document.activeElement !== body) body.textContent = d.text;
  else if (!body) renderDialogue();
}

function syncTextsFromDialogue(d) {
  for (const [pageName, page] of Object.entries(project.pages)) {
    for (const t of page.texts || []) {
      if (t.dialogueId !== d.id || t.text === d.text) continue;
      t.text = d.text;
      clampRuns(t);
      if (pageName === state.pageName) syncTextEl(t);
    }
  }
}

function listInsertAt(items, clientY) {
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return items.length;
}

function markListInsert(items, insertAt) {
  for (const el of items) el.classList.remove("drop-before", "drop-after");
  if (!items.length) return;
  if (insertAt >= items.length) items[items.length - 1].classList.add("drop-after");
  else items[insertAt].classList.add("drop-before");
}

function moveArrayItem(arr, from, to) {
  if (from < 0 || from >= arr.length) return false;
  if (to < 0) to = 0;
  if (to > arr.length) to = arr.length;
  if (from === to || from + 1 === to) return false;
  const [item] = arr.splice(from, 1);
  if (to > from) to--;
  arr.splice(to, 0, item);
  return true;
}

function clearDialogueDropMarks() {
  $$(".drop-before, .drop-after, .drop-on").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "drop-on");
  });
}

function dialogueLinesOf(body) {
  return $$(":scope > .line", body);
}

function dropDialogueAt(fromId, items, clientY, folder) {
  if (!fromId) return;
  if (!items.length) {
    moveDialogue(fromId, { folder });
    return;
  }
  const at = listInsertAt(items, clientY);
  const ids = items.map((el) => el.dataset.id);
  const from = ids.indexOf(fromId);
  if (from >= 0 && (from === at || from + 1 === at)) return;
  if (at >= items.length) moveDialogue(fromId, { afterId: ids[ids.length - 1], folder });
  else moveDialogue(fromId, { beforeId: ids[at], folder });
}

function moveDialogue(fromId, { beforeId = "", afterId = "", folder = "" } = {}) {
  const from = project.dialogue.find((d) => d.id === fromId);
  if (!from) return;
  const destFolder = folder || "";
  const folderChanged = (from.pageName || "") !== destFolder;
  if (folderChanged && placedPageOf(from.id)) {
    pushHistory({ paint: false, projectData: true, allPages: true });
    removeTextsByDialogue(from.id);
  }
  from.pageName = destFolder;
  const rest = project.dialogue.filter((d) => d.id !== fromId);
  let insertAt = rest.length;
  if (beforeId) {
    const i = rest.findIndex((d) => d.id === beforeId);
    if (i >= 0) insertAt = i;
  } else if (afterId) {
    const i = rest.findIndex((d) => d.id === afterId);
    if (i >= 0) insertAt = i + 1;
  } else {
    let last = -1;
    rest.forEach((d, i) => {
      if (dialogueFolderOf(d) === destFolder) last = i;
    });
    insertAt = last >= 0 ? last + 1 : rest.length;
  }
  rest.splice(insertAt, 0, from);
  project.dialogue = rest;
  if (destFolder) state.collapsedFolders.delete(destFolder);
  else state.collapsedFolders.delete("");
  if (folderChanged) renderTexts();
  renderDialogue();
  markDirty();
}

function makeDialogueRow(d, n, used) {
  const isUsed = (used || usedDialogueIds()).has(d.id);
  const row = document.createElement("div");
  row.className = "line" + (state.selectedDialogueIds.has(d.id) || d.id === state.selectedDialogueId ? " selected" : "") + (isUsed ? " used" : " unused");
  row.draggable = true;
  row.dataset.id = d.id;
  row.innerHTML = `<div class="meta"><span class="line-index">#${n}</span>
    <span class="line-actions">
      <button type="button" class="line-unplace" aria-label="${t("ui.unplaceLine")}" ${isUsed ? "" : "hidden"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 4.5 L4.5 19.5"/><path d="M4.5 4.5 L19.5 19.5"/></svg>
      </button>
      <button type="button" class="line-del" aria-label="${t("ui.deleteLine")}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </span></div>
    <div class="body" contenteditable="true" spellcheck="false" data-placeholder="${t("placeholders.dialogueEmpty")}"></div>${d.src ? '<div class="src"></div>' : ""}`;
  const body = row.querySelector(".body");
  body.draggable = false;
  body.textContent = d.text;
  if (d.src) row.querySelector(".src").textContent = d.src;
  row.querySelector(".line-unplace").addEventListener("click", (e) => {
    e.stopPropagation();
    unplaceDialogue(d.id);
  });
  row.querySelector(".line-del").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteDialogue(d.id);
  });
  bindHint(row.querySelector(".line-unplace"), "line-unplace");
  bindHint(row.querySelector(".line-del"), "line-del");
  body.addEventListener("pointerdown", () => {
    row.draggable = false;
  });
  body.addEventListener("pointerup", () => {
    if (document.activeElement !== body) row.draggable = true;
  });
  row.addEventListener("click", async (e) => {
    if (bag.dialogueDrag.moved) return;
    if (e.target.closest(".line-del, .line-unplace")) return;
    if (e.shiftKey) {
      toggleDialogueId(d.id);
      setTool("text");
      revealDialogueInList(state.selectedDialogueIds);
      await focusDialoguePlacement(d, { keepSelection: true });
      selectTextsByDialogueIds(selectedDialogueList());
      return;
    }
    if (state.selectedDialogueIds.size === 1 && state.selectedDialogueIds.has(d.id) && !e.target.closest(".body")) {
      const page = placedPageOf(d.id);
      if (page && page !== state.pageName) {
        setTool("text");
        await focusDialoguePlacement(d, { pan: true });
        return;
      }
      clearDialogueSelection();
      row.classList.remove("selected");
      selectOnly(null);
      $$(".text-box", ui.texts).forEach((el) => el.classList.remove("selected"));
      return;
    }
    selectDialogues([d.id]);
    setTool("text");
    if (!(await focusDialoguePlacement(d))) {
      revealDialogueInList([d.id]);
      selectTextsByDialogue(d.id);
    }
  });
  row.addEventListener("dblclick", async (e) => {
    if (e.target.closest(".line-del, .line-unplace")) return;
    const page = placedPageOf(d.id);
    if (!page || page === state.pageName) return;
    e.preventDefault();
    if (e.target.closest(".body")) e.target.blur();
    await focusDialoguePlacement(d, { pan: true });
  });
  let bodyStarted = false;
  let bodyOrig = d.text;
  let bodyCancel = false;
  body.addEventListener("focus", () => {
    bodyStarted = false;
    bodyCancel = false;
    bodyOrig = d.text;
    row.draggable = false;
  });
  body.addEventListener("input", () => {
    if (bodyCancel) return;
    if (!bodyStarted) {
      pushHistory({ paint: false, projectData: true });
      bodyStarted = true;
    }
    d.text = editableText(body);
    syncTextsFromDialogue(d);
    markDirty();
  });
  body.addEventListener("blur", () => {
    if (bodyCancel) {
      d.text = bodyOrig;
      body.textContent = bodyOrig;
      syncTextsFromDialogue(d);
      bodyCancel = false;
      row.draggable = true;
      return;
    }
    const next = editableText(body);
    if (next !== d.text) {
      if (!bodyStarted) pushHistory({ paint: false, projectData: true });
      d.text = next;
      syncTextsFromDialogue(d);
      markDirty();
    }
    if (!d.text) body.textContent = "";
    row.draggable = true;
  });
  body.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      bodyCancel = true;
      d.text = bodyOrig;
      body.textContent = bodyOrig;
      syncTextsFromDialogue(d);
      body.blur();
    }
  });
  row.addEventListener("dragstart", (e) => {
    if (e.target.closest(".line-del, .line-unplace") || e.target.closest(".body")) {
      e.preventDefault();
      return;
    }
    bag.dialogueDrag = { id: d.id, moved: false };
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", d.id);
  });
  row.addEventListener("dragend", () => {
    row.draggable = document.activeElement !== body;
    row.classList.remove("dragging");
    clearDialogueDropMarks();
    setTimeout(() => {
      bag.dialogueDrag = { id: null, moved: false };
    }, 0);
  });
  return row;
}

function makeFolder(key, title, items, used) {
  const wrap = document.createElement("div");
  const collapsed = state.collapsedFolders.has(key);
  wrap.className = "folder" + (collapsed ? " collapsed" : "");
  wrap.dataset.folder = key;
  wrap.innerHTML = `<button type="button" class="folder-head">
      <span class="folder-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.35 8H6.65c-.64 0-.99.76-.56 1.24l5.35 6.11c.3.34.83.34 1.13 0l5.35-6.11C18.34 8.76 18 8 17.36 8Z"/></svg></span>
      <span class="folder-title"></span>
      <span class="folder-count">${items.length}</span>
    </button>
    <div class="folder-body"></div>`;
  wrap.querySelector(".folder-title").textContent = title;
  const body = wrap.querySelector(".folder-body");
  items.forEach((d, i) => body.appendChild(makeDialogueRow(d, i + 1, used)));
  const head = wrap.querySelector(".folder-head");
  head.addEventListener("click", () => {
    if (bag.dialogueDrag.moved) return;
    if (state.collapsedFolders.has(key)) state.collapsedFolders.delete(key);
    else state.collapsedFolders.add(key);
    wrap.classList.toggle("collapsed", state.collapsedFolders.has(key));
    markDirty();
  });
  head.addEventListener("dragover", (e) => {
    if (!bag.dialogueDrag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    bag.dialogueDrag.moved = true;
    clearDialogueDropMarks();
    wrap.classList.add("drop-on");
  });
  head.addEventListener("dragleave", (e) => {
    if (!head.contains(e.relatedTarget)) wrap.classList.remove("drop-on");
  });
  head.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const fromId = e.dataTransfer.getData("text/plain") || bag.dialogueDrag.id;
    clearDialogueDropMarks();
    if (fromId) moveDialogue(fromId, { folder: key });
  });
  body.addEventListener("dragover", (e) => {
    if (!bag.dialogueDrag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    bag.dialogueDrag.moved = true;
    clearDialogueDropMarks();
    const items = dialogueLinesOf(body);
    markListInsert(items, listInsertAt(items, e.clientY));
  });
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const fromId = e.dataTransfer.getData("text/plain") || bag.dialogueDrag.id;
    const items = dialogueLinesOf(body);
    clearDialogueDropMarks();
    dropDialogueAt(fromId, items, e.clientY, key);
  });
  return wrap;
}

let lastDialogueFilter = null;

function desiredFolders(used, filter) {
  const folders = [];
  const loose = project.dialogue.filter((d) => !dialogueFolderOf(d) && dialogueVisible(d, used, filter));
  if (loose.length || filter === "all") {
    folders.push({ key: "", title: t("ui.unusedFolder"), items: loose });
  }
  for (const p of state.pages) {
    const items = project.dialogue.filter((d) => dialogueFolderOf(d) === p.name && dialogueVisible(d, used, filter));
    if (!items.length && filter !== "all") continue;
    folders.push({ key: p.name, title: pageLabel(p.name), items });
  }
  return folders;
}

function updateDialogueRow(row, d, n, used) {
  const isUsed = used.has(d.id);
  const selected = state.selectedDialogueIds.has(d.id) || d.id === state.selectedDialogueId;
  row.classList.toggle("selected", selected);
  row.classList.toggle("used", isUsed);
  row.classList.toggle("unused", !isUsed);
  const unplace = row.querySelector(".line-unplace");
  if (unplace) unplace.hidden = !isUsed;
  const index = row.querySelector(".line-index");
  if (index) index.textContent = "#" + n;
  const body = row.querySelector(".body");
  if (body && document.activeElement !== body && body.textContent !== d.text) {
    body.textContent = d.text;
  }
  let srcEl = row.querySelector(".src");
  if (d.src) {
    if (!srcEl) {
      srcEl = document.createElement("div");
      srcEl.className = "src";
      row.appendChild(srcEl);
    }
    if (srcEl.textContent !== d.src) srcEl.textContent = d.src;
  } else if (srcEl) {
    srcEl.remove();
  }
}

function syncFolderLines(wrap, items, used) {
  const body = wrap.querySelector(".folder-body");
  if (!body) return;
  const have = new Map();
  for (const el of dialogueLinesOf(body)) {
    if (el.dataset.id) have.set(el.dataset.id, el);
  }
  const keep = new Set(items.map((d) => d.id));
  for (const [id, el] of have) {
    if (!keep.has(id)) el.remove();
  }
  items.forEach((d, i) => {
    let row = have.get(d.id);
    if (!row || !row.isConnected) row = makeDialogueRow(d, i + 1, used);
    else updateDialogueRow(row, d, i + 1, used);
    const next = body.children[i];
    if (next !== row) body.insertBefore(row, next || null);
  });
}

function renderDialogueFull(used, folders) {
  ui.dialogueList.innerHTML = "";
  for (const folder of folders) {
    ui.dialogueList.appendChild(makeFolder(folder.key, folder.title, folder.items, used));
  }
}

function renderDialogue() {
  if (!ui.dialogueList) return;
  const used = usedDialogueIds();
  const filter = state.dialogueFilter;
  const folders = desiredFolders(used, filter);
  const filterChanged = lastDialogueFilter !== null && lastDialogueFilter !== filter;
  const currentIds = new Set(project.dialogue.map((d) => d.id));
  const existingIds = [...ui.dialogueList.querySelectorAll(".line[data-id]")].map((el) => el.dataset.id);
  const stale = existingIds.length > 0 && !existingIds.some((id) => currentIds.has(id));
  lastDialogueFilter = filter;
  if (filterChanged || stale || !ui.dialogueList.querySelector(".folder")) {
    renderDialogueFull(used, folders);
    return;
  }
  const have = new Map();
  for (const el of [...ui.dialogueList.children]) {
    if (el.classList.contains("folder")) have.set(el.dataset.folder ?? "", el);
  }
  const keep = new Set(folders.map((f) => f.key));
  for (const [key, el] of have) {
    if (!keep.has(key)) el.remove();
  }
  folders.forEach((folder, i) => {
    let wrap = have.get(folder.key);
    if (!wrap || !wrap.isConnected) {
      wrap = makeFolder(folder.key, folder.title, folder.items, used);
    } else {
      wrap.classList.toggle("collapsed", state.collapsedFolders.has(folder.key));
      const title = wrap.querySelector(".folder-title");
      if (title && title.textContent !== folder.title) title.textContent = folder.title;
      const count = wrap.querySelector(".folder-count");
      if (count) count.textContent = String(folder.items.length);
      syncFolderLines(wrap, folder.items, used);
    }
    const next = ui.dialogueList.children[i];
    if (next !== wrap) ui.dialogueList.insertBefore(wrap, next || null);
  });
}

function deleteDialogues(ids, { history = true } = {}) {
  const drop = [...new Set((ids || []).filter(Boolean))];
  if (!drop.length) return false;
  if (history) pushHistory({ paint: false, projectData: true, allPages: true });
  const gone = new Set(drop);
  project.dialogue = project.dialogue.filter((d) => !gone.has(d.id));
  for (const id of drop) removeTextsByDialogue(id);
  for (const id of drop) {
    if (state.selectedDialogueIds.has(id)) state.selectedDialogueIds.delete(id);
  }
  if (gone.has(state.selectedDialogueId)) {
    state.selectedDialogueId = [...state.selectedDialogueIds].at(-1) || project.dialogue[0]?.id || null;
    if (state.selectedDialogueId) state.selectedDialogueIds.add(state.selectedDialogueId);
  }
  renderTexts();
  renderDialogue();
  markDirty();
  return true;
}

function unplaceDialogues(ids) {
  const drop = [...new Set((ids || []).filter((id) => id && usedDialogueIds().has(id)))];
  if (!drop.length) return false;
  pushHistory({ paint: false, projectData: true, allPages: true });
  for (const id of drop) removeTextsByDialogue(id);
  renderTexts();
  renderDialogue();
  markDirty();
  return true;
}

function unplaceDialogue(id) {
  return unplaceDialogues([id]);
}

function unplaceSelectedDialogues() {
  return unplaceDialogues(selectedDialogueList());
}

function deleteDialogue(id) {
  return deleteDialogues([id]);
}

function deleteSelectedDialogues() {
  return deleteDialogues(selectedDialogueList());
}

function copySelectedDialogues(fromCut = false) {
  const items = selectedDialogueList()
    .map((id) => project.dialogue.find((d) => d.id === id))
    .filter(Boolean);
  if (!items.length) return false;
  bag.dialogueClip = {
    items: items.map((d) => JSON.parse(JSON.stringify(d))),
    fromCut,
    pasteN: 0,
  };
  return true;
}

function cutSelectedDialogues() {
  const ids = selectedDialogueList();
  if (!copySelectedDialogues(true)) return false;
  return deleteDialogues(ids);
}

function pasteDialogues({ pageName } = {}) {
  if (!bag.dialogueClip.items.length) return false;
  pushHistory({ paint: false, projectData: true, allPages: true });
  const folder = pageName
    ?? project.dialogue.find((d) => d.id === state.selectedDialogueId)?.pageName
    ?? state.pageName
    ?? "";
  const clones = bag.dialogueClip.items.map((src) => {
    const d = JSON.parse(JSON.stringify(src));
    d.id = uid("d");
    d.pageName = folder;
    return d;
  });
  let at = project.dialogue.length;
  const sel = state.selectedDialogueId;
  if (sel) {
    const i = project.dialogue.findIndex((d) => d.id === sel);
    if (i >= 0) at = i + 1;
  }
  project.dialogue.splice(at, 0, ...clones);
  selectDialogues(clones.map((d) => d.id));
  renderDialogue();
  revealDialogueInList(state.selectedDialogueIds);
  markDirty();
  return true;
}

function resolvePageName(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 1) return "";
  const pad = String(n).padStart(3, "0");
  const stemEq = (name, key) => name.replace(/\.[^.]+$/, "") === key;
  return (
    state.pages.find((p) => stemEq(p.name, pad) || stemEq(p.name, String(n)))?.name ||
    state.pages[n - 1]?.name ||
    ""
  );
}

function setFoldersCollapsed(collapsed) {
  const keys = [...ui.dialogueList.querySelectorAll(".folder")].map((el) => el.dataset.folder ?? "");
  if (!keys.length) return;
  for (const key of keys) {
    if (collapsed) state.collapsedFolders.add(key);
    else state.collapsedFolders.delete(key);
  }
  $$(".folder", ui.dialogueList).forEach((wrap) => {
    wrap.classList.toggle("collapsed", state.collapsedFolders.has(wrap.dataset.folder ?? ""));
  });
  markDirty();
}

function parseBulk(raw, blank, bilingual) {
  return parseBulkRaw(raw, blank, bilingual, { uid, resolvePage: resolvePageName });
}

export {
  placedPageOf,
  dialogueFolderOf,
  pageLabel,
  syncDialogueFromText,
  listInsertAt,
  markListInsert,
  moveArrayItem,
  renderDialogue,
  setFoldersCollapsed,
  parseBulk,
  copySelectedDialogues,
  cutSelectedDialogues,
  pasteDialogues,
  deleteSelectedDialogues,
  unplaceDialogue,
  unplaceSelectedDialogues,
};
