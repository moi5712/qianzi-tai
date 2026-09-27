// --- 剪下／複製／貼上／刪除選單 ---
import { $, $$, state, ui, bag, selectedDialogueList, selectDialogues, clearDialogueSelection, usedDialogueIds } from "./store.js";
import { copySelectedTexts, cutSelectedTexts, pasteTexts, deleteSelectedTexts, unplaceSelectedTexts, selectOnly, selectTextsByDialogue, refreshSelection, selectedText } from "./text.js";
import { copySelectedDialogues, cutSelectedDialogues, pasteDialogues, deleteSelectedDialogues, unplaceSelectedDialogues } from "./dialogue.js";
import { hidePageMenu } from "./pages.js";
import { writeStyleToForm, copySelectedStyle, pasteCopiedStyle } from "./style.js";

function editMenu() {
  return ui.editMenu || $("#edit-menu");
}

export function hideEditMenu() {
  const menu = editMenu();
  if (menu) menu.hidden = true;
}

function placeMenu(menu, clientX, clientY) {
  menu.hidden = false;
  const w = menu.offsetWidth || 168;
  const h = menu.offsetHeight || 168;
  const x = Math.max(8, Math.min(clientX, innerWidth - w - 8));
  const y = Math.max(8, Math.min(clientY, innerHeight - h - 8));
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function hasClip(kind) {
  return kind === "dialogue" ? bag.dialogueClip.items.length > 0 : bag.textClip.items.length > 0;
}

function hasSelection(kind) {
  return kind === "dialogue" ? selectedDialogueList().length > 0 : state.selectedTextIds.size > 0;
}

export function clipboardScope() {
  if (ui.dialogueList?.contains(document.activeElement)) return "dialogue";
  if (bag.editFocus === "dialogue") return "dialogue";
  if (state.selectedTextIds.size) return "text";
  if (selectedDialogueList().length) return "dialogue";
  return "text";
}

export function canEditAct(act, kind = clipboardScope()) {
  if (act === "copy-style" || act === "paste-style") return true;
  if (act === "paste") return hasClip(kind);
  if (act === "unplace") {
    return kind === "text"
      ? !!state.selectedTextIds.size
      : selectedDialogueList().some((id) => usedDialogueIds().has(id));
  }
  if (act === "cut" || act === "copy" || act === "delete") return hasSelection(kind);
  return false;
}

export function dispatchEditAction(act, { kind, pageName } = {}) {
  const scope = kind || clipboardScope();
  hideEditMenu();
  if (act === "copy-style") {
    copySelectedStyle();
    return true;
  }
  if (act === "paste-style") {
    pasteCopiedStyle();
    return true;
  }
  if (!canEditAct(act, scope)) return false;
  if (scope === "dialogue") {
    if (act === "cut") cutSelectedDialogues();
    else if (act === "copy") copySelectedDialogues(false);
    else if (act === "paste") pasteDialogues(pageName !== undefined ? { pageName } : {});
    else if (act === "unplace") unplaceSelectedDialogues();
    else if (act === "delete") deleteSelectedDialogues();
    else return false;
    return true;
  }
  if (act === "cut") cutSelectedTexts();
  else if (act === "copy") copySelectedTexts(false);
  else if (act === "paste") pasteTexts();
  else if (act === "unplace") unplaceSelectedTexts();
  else if (act === "delete") deleteSelectedTexts();
  else return false;
  return true;
}

export function hideAppMenus() {
  $$(".menu-btn").forEach((btn) => btn.setAttribute("aria-expanded", "false"));
  $$(".app-menu").forEach((menu) => { menu.hidden = true; });
}

function appMenuOf(btn) {
  return btn?.dataset.menu ? document.getElementById("menu-" + btn.dataset.menu) : null;
}

function openAppMenu(btn) {
  hideEditMenu();
  hidePageMenu();
  hideAppMenus();
  const menu = appMenuOf(btn);
  if (!menu) return;
  btn.setAttribute("aria-expanded", "true");
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth || 168;
  const h = menu.offsetHeight || 80;
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(r.bottom + 2, innerHeight - h - 8)) + "px";
}

export function bindMenubar() {
  const bar = $(".menubar");
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = "1";
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-btn");
    if (!btn) return;
    e.preventDefault();
    if (btn.getAttribute("aria-expanded") === "true") hideAppMenus();
    else openAppMenu(btn);
  });
  bar.addEventListener("pointerenter", (e) => {
    const btn = e.target.closest(".menu-btn");
    if (!btn || !document.querySelector(".menu-btn[aria-expanded='true']")) return;
    if (btn.getAttribute("aria-expanded") === "true") return;
    openAppMenu(btn);
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (!document.querySelector(".app-menu:not([hidden])")) return;
    if (e.target.closest(".menubar, .app-menu")) return;
    hideAppMenus();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".app-menu button")) hideAppMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideAppMenus();
  });
  window.addEventListener("blur", hideAppMenus);
  $$(".app-menu").forEach((menu) => {
    menu.addEventListener("contextmenu", (e) => e.preventDefault());
  });
}

export function showEditMenu(e, kind, { pageName } = {}) {
  const menu = editMenu();
  if (!menu) return;
  hideAppMenus();
  hidePageMenu();
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.dataset.kind = kind;
  if (pageName !== undefined) menu.dataset.pageName = pageName;
  else menu.removeAttribute("data-page-name");
  for (const btn of menu.querySelectorAll("[data-act]")) {
    const act = btn.dataset.act;
    if (act === "unplace") btn.hidden = false;
    btn.disabled = act === "paste-style" ? !bag.styleClip : !canEditAct(act, kind);
  }
  placeMenu(menu, e.clientX, e.clientY);
}

function runEditAct(act) {
  const menu = editMenu();
  const kind = menu?.dataset.kind || bag.editFocus || "text";
  const pageName = menu?.hasAttribute("data-page-name") ? (menu.dataset.pageName || "") : undefined;
  dispatchEditAction(act, { kind, pageName });
}

function syncDialogueRowSelection() {
  $$(".line", ui.dialogueList).forEach((el) => {
    el.classList.toggle("selected", state.selectedDialogueIds.has(el.dataset.id));
  });
}

function selectDialogueRow(id) {
  if (!id) return;
  if (!state.selectedDialogueIds.has(id)) {
    selectDialogues([id]);
    syncDialogueRowSelection();
    selectTextsByDialogue(id);
  }
}

function nativeTextPick(el) {
  if (!el || document.activeElement !== el) return false;
  const sel = window.getSelection();
  return !!(sel && !sel.isCollapsed && el.contains(sel.anchorNode));
}

export function bindEditMenu() {
  const menu = editMenu();
  if (menu && !menu.dataset.bound) {
    menu.dataset.bound = "1";
    ui.editMenu = menu;
    menu.addEventListener("contextmenu", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      runEditAct(btn.dataset.act);
    });
    document.addEventListener("pointerdown", (e) => {
      if (menu.hidden || menu.contains(e.target)) return;
      hideEditMenu();
    });
    window.addEventListener("blur", hideEditMenu);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideEditMenu();
    });
  }

  const list = ui.dialogueList;
  if (list && !list.dataset.editBound) {
    list.dataset.editBound = "1";
    list.addEventListener("pointerdown", () => {
      bag.editFocus = "dialogue";
    });
    list.addEventListener("click", (e) => {
      if (bag.dialogueDrag.moved) return;
      if (e.target.closest(".line, .folder-head, .line-del, .line-unplace, .ctx-menu")) return;
      clearDialogueSelection();
      syncDialogueRowSelection();
      selectOnly(null);
      $$(".text-box", ui.texts).forEach((el) => el.classList.remove("selected"));
    });
    list.addEventListener("contextmenu", (e) => {
      if (nativeTextPick(e.target.closest(".body"))) return;
      e.preventDefault();
      bag.editFocus = "dialogue";
      const row = e.target.closest(".line");
      const folder = e.target.closest(".folder");
      if (row?.dataset.id) selectDialogueRow(row.dataset.id);
      showEditMenu(e, "dialogue", folder ? { pageName: folder.dataset.folder || "" } : {});
    });
    list.addEventListener("scroll", hideEditMenu, { passive: true });
  }

  if (ui.texts && !ui.texts.dataset.editBound) {
    ui.texts.dataset.editBound = "1";
    ui.texts.addEventListener("contextmenu", (e) => {
      const box = e.target.closest(".text-box");
      if (!box) return;
      if (bag.inlineEdit?.id === box.dataset.id && e.target.closest(".inner") && nativeTextPick(e.target.closest(".inner"))) return;
      e.preventDefault();
      e.stopPropagation();
      bag.editFocus = "text";
      if (box.dataset.id && !state.selectedTextIds.has(box.dataset.id)) {
        selectOnly(box.dataset.id);
        refreshSelection();
        const cur = selectedText();
        if (cur) writeStyleToForm(cur);
      }
      showEditMenu(e, "text");
    });
  }

  bindMenubar();
}
