// --- 對白 ---
import { $$, state, project, ui, bag, uid, usedDialogueIds, selectedDialogueList, selectDialogues, clearDialogueSelection, toggleDialogueId } from "./store.js";
import { t, bindHint } from "./copy.js";
import { pushHistory } from "./history.js";
import { markDirty } from "./api.js";
import { setTool } from "./view.js";
import { syncTextEl, renderTexts, selectOnly, selectTextsByDialogue, selectTextsByDialogueIds, revealDialogueInList, focusDialoguePlacement, removeTextsByDialogue } from "./text.js";
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
  row.draggable = false;
  row.dataset.id = d.id;
  row.innerHTML = `<div class="meta"><span class="line-index"><i class="drag-hint" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 5h2v14h-2zM8 5h2v14H8z"/></svg></i>#${n}</span>
    <span class="line-actions"><button type="button" class="line-del" aria-label="${t("ui.deleteLine")}">×</button></span></div>
    <div class="body" contenteditable="true" spellcheck="false" data-placeholder="${t("placeholders.dialogueEmpty")}"></div>${d.src ? '<div class="src"></div>' : ""}`;
  const body = row.querySelector(".body");
  body.textContent = d.text;
  if (d.src) row.querySelector(".src").textContent = d.src;
  row.querySelector(".line-del").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteDialogue(d.id);
  });
  bindHint(row.querySelector(".drag-hint"), "drag-sort");
  bindHint(row.querySelector(".line-del"), "line-del");
  const handle = row.querySelector(".drag-hint");
  handle.addEventListener("mousedown", () => {
    row.draggable = true;
  });
  row.addEventListener("mouseup", () => {
    row.draggable = false;
  });
  row.addEventListener("click", async (e) => {
    if (bag.dialogueDrag.moved) return;
    if (e.target.closest(".line-del")) return;
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
    if (e.target.closest(".line-del")) return;
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
    if (e.target.closest(".line-del") || e.target.closest(".body")) {
      e.preventDefault();
      return;
    }
    bag.dialogueDrag = { id: d.id, moved: false };
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", d.id);
  });
  row.addEventListener("dragend", () => {
    row.draggable = false;
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
    markDirty();
    renderDialogue();
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

function renderDialogue() {
  const used = usedDialogueIds();
  const filter = state.dialogueFilter;
  ui.dialogueList.innerHTML = "";
  const visible = (d) => {
    const isUsed = used.has(d.id);
    if (filter === "used" && !isUsed) return false;
    if (filter === "unused" && isUsed) return false;
    return true;
  };
  const loose = project.dialogue.filter((d) => !dialogueFolderOf(d) && visible(d));
  if (loose.length || filter === "all") {
    ui.dialogueList.appendChild(makeFolder("", t("ui.unusedFolder"), loose, used));
  }
  for (const p of state.pages) {
    const items = project.dialogue.filter((d) => dialogueFolderOf(d) === p.name && visible(d));
    if (!items.length && filter !== "all") continue;
    ui.dialogueList.appendChild(makeFolder(p.name, pageLabel(p.name), items, used));
  }
}

function deleteDialogue(id) {
  pushHistory({ paint: false, projectData: true, allPages: true });
  project.dialogue = project.dialogue.filter((d) => d.id !== id);
  removeTextsByDialogue(id);
  if (state.selectedDialogueIds.has(id)) state.selectedDialogueIds.delete(id);
  if (state.selectedDialogueId === id) {
    state.selectedDialogueId = [...state.selectedDialogueIds].at(-1) || project.dialogue[0]?.id || null;
    if (state.selectedDialogueId) state.selectedDialogueIds.add(state.selectedDialogueId);
  }
  renderTexts();
  renderDialogue();
  markDirty();
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

function takePageMark(text) {
  const raw = String(text || "").trim();
  const mark = /^【\s*(\d+)\s*】$/;
  const full = raw.match(mark);
  if (full) return { page: resolvePageName(full[1]), rest: "" };
  const lines = raw.split("\n");
  const first = (lines[0] || "").trim();
  const head = first.match(mark);
  if (!head) return { page: null, rest: raw };
  return { page: resolvePageName(head[1]), rest: lines.slice(1).join("\n").trim() };
}

function parseBulk(raw, blank, bilingual) {
  const text = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];
  const chunks = blank
    ? text.split(/\n[ \t]*\n+/).map((s) => s.trim()).filter(Boolean)
    : text.split("\n").map((s) => s.trim()).filter(Boolean);
  let currentPage = "";
  const rows = [];
  for (const chunk of chunks) {
    const { page, rest } = takePageMark(chunk);
    if (page !== null) currentPage = page;
    if (!rest) continue;
    if (!bilingual) {
      rows.push({ id: uid("d"), text: rest, src: "", pageName: currentPage });
      continue;
    }
    const parts = rest.split(/\t+| *\| */);
    rows.push({
      id: uid("d"),
      src: (parts[0] || "").trim(),
      text: (parts[1] || parts[0] || "").trim(),
      pageName: currentPage,
    });
  }
  return rows;
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
  parseBulk,
};
