// --- 文案 ---

import { ui, state, bag } from "./store.js";

function copyValue(key) {
  const parts = String(key || "").split(".");
  let cur = bag.COPY;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

export function t(key, vars) {
  const cur = copyValue(key);
  if (cur == null) return "";
  let s = typeof cur === "string" ? cur : "";
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
  }
  return s;
}

export function toolHint(tool = state.tool) {
  return t("tools." + tool);
}

export function toastT(key, vars) {
  toast(t("toast." + key, vars) || key);
}

export function confirmT(key, vars) {
  const msg = t(key, vars);
  return !!(msg && confirm(msg));
}

export function toast(msg, ms) {
  ui.toast.hidden = false;
  ui.toast.textContent = msg;
  clearTimeout(bag.toastTimer);
  const wait = Number(ms);
  bag.toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, wait > 0 ? wait : Math.min(8000, 2400 + String(msg || "").length * 28));
}

export function probeToast(kind, data) {
  if (data && data.ok) {
    if (data.code === "local_ocr_ok") toastT("localOcrOk");
    else toastT(kind === "vision" ? "visionOk" : "apiOk");
    return;
  }
  const code = (data && data.code) || "unknown";
  const local = code === "need_local_ocr" || String(code).startsWith("local_ocr");
  const title = t(local ? "probe.localFail" : kind === "vision" ? "probe.visionFail" : "probe.apiFail");
  const reason = t("probe.reasons." + code) || t("probe.reasons.unknown");
  const action = t("probe.actions." + code) || t("probe.actions.unknown");
  toast(`${title}${reason}${action}`);
}

export function setStatusHint(text) {
  if (ui.statusHint) ui.statusHint.textContent = text || "";
}

export function actionHint(id) {
  if (id === "btn-hide-paint") return t(state.hidePaint ? "actions.btn-hide-paint-on" : "actions.btn-hide-paint");
  if (id === "btn-hide-text") return t(state.showOriginal ? "actions.btn-hide-text-on" : "actions.btn-hide-text");
  return t("actions." + id);
}

export function bindHint(el, id) {
  if (!el) return;
  el.addEventListener("pointerenter", () => {
    bag.hoveredAction = id;
    setStatusHint(actionHint(id) || el.dataset.hint || "");
  });
  el.addEventListener("pointerleave", () => {
    bag.hoveredAction = "";
    setStatusHint(toolHint());
  });
}

export async function loadCopy() {
  try {
    const res = await fetch("/copy.json");
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    bag.COPY = data && typeof data === "object" ? data : {};
  } catch {
    bag.COPY = {};
  }
}
