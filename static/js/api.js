// --- 存檔 ---
import { state, project, ui, bag } from "./store.js";
import { t, toastT } from "./copy.js";
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  return res;
}

async function apiJson(url, payload, opts) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    signal: opts && opts.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || url + " " + t("ui.requestFail"));
  return data;
}

async function saveProject() {
  const payload = {
    dialogue: project.dialogue,
    pages: project.pages,
    defaultStyle: project.defaultStyle,
    glossary: project.glossary || [],
    pageName: state.pageName,
    pageOrder: state.pages.map((p) => p.name),
    selectedDialogueId: state.selectedDialogueId,
    collapsedFolders: [...state.collapsedFolders],
  };
  const res = await fetch("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    toastT("saveFail");
    return;
  }
  state.dirty = false;
}

function saveEraseSoon() {
  state.paintDirty = true;
  clearTimeout(bag.eraseTimer);
  bag.eraseTimer = setTimeout(saveEraseNow, 700);
}

async function saveEraseNow() {
  if (!state.pageName || !state.paintDirty) return;
  const blob = await new Promise((resolve) => ui.paint.toBlob(resolve, "image/png"));
  if (!blob) return;
  const stem = state.pageName.replace(/\.[^.]+$/, "");
  const res = await fetch("/api/erase/" + encodeURIComponent(stem) + ".png", { method: "POST", body: blob });
  if (!res.ok) return;
  state.paintDirty = false;
  const page = state.pages.find((p) => p.name === state.pageName);
  if (page) page.erase = "/api/erase/" + encodeURIComponent(stem) + ".png?v=" + Date.now();
}

function markDirty() {
  state.dirty = true;
  clearTimeout(bag.saveTimer);
  bag.saveTimer = setTimeout(saveProject, 1200);
}

export {
  apiGet,
  apiJson,
  saveProject,
  saveEraseSoon,
  saveEraseNow,
  markDirty,
};
