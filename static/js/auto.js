// --- AI 翻譯 ---
import { $, $$, state, project, ui, bag, uid, pageEntry, selectDialogues } from "./store.js";
import { t, toast, toastT, confirmT } from "./copy.js";
import { apiGet, apiJson, markDirty } from "./api.js";
import { pushHistory } from "./history.js";
import { renderTexts } from "./text.js";
import { renderDialogue, pageLabel } from "./dialogue.js";
import { styleForNewText, estimateBox } from "./style.js";
async function postProbe(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: collectApiSettings() }),
  });
  const data = await res.json().catch(() => ({}));
  if (data && typeof data === "object" && data.code) return data;
  return { ok: false, code: "unknown" };
}

function collectApiSettings() {
  return {
    apiBase: ui.setApiBase.value.trim(),
    model: ui.setModel.value.trim(),
    apiKey: ui.setApiKey.value.trim(),
    ocrPrompt: ui.setOcrPrompt.value,
    translatePrompt: ui.setTranslatePrompt.value,
    ocrEngine: ui.setOcrEngine.value || "local",
  };
}

function collectAutoOptions() {
  return {
    includeSfx: ui.autoSfx.checked,
    doBreak: ui.autoBreak.checked,
    placeOnCanvas: ui.autoPlace.checked,
  };
}

function fillApiForm(settings) {
  if (!settings) return;
  ui.setApiBase.value = settings.apiBase || "";
  ui.setModel.value = settings.model || "";
  ui.setApiKey.value = "";
  ui.setApiKey.placeholder = settings.hasApiKey
    ? t("placeholders.apiKeySaved")
    : t("placeholders.apiKey");
    ui.setOcrPrompt.value = settings.ocrPrompt || t("prompts.ocr");
    ui.setTranslatePrompt.value = settings.translatePrompt || t("prompts.translate");
  ui.setOcrEngine.value = settings.ocrEngine === "api" ? "api" : "local";
}

function fillAutoOptions(settings) {
  if (!settings) return;
  ui.autoSfx.checked = !!settings.includeSfx;
  ui.autoBreak.checked = settings.doBreak !== false;
  ui.autoPlace.checked = settings.placeOnCanvas !== false;
}

function pagePickMaster(container) {
  if (container === ui.autoPages) return $("#auto-pages-all");
  if (container === ui.exportPages) return $("#export-pages-all");
  return null;
}

function syncPagePickMaster(container) {
  const master = pagePickMaster(container);
  if (!master || !container) return;
  const boxes = $$("input[type='checkbox']", container);
  master.checked = boxes.length > 0 && boxes.every((box) => box.checked);
}

function renderPagePicks(container, selected) {
  if (!container) return;
  const chosen = new Set(selected || []);
  container.innerHTML = "";
  container._lastPick = -1;
  container._paint = false;
  container._paintValue = true;
  const syncLabel = (el) => el.closest("label")?.classList.toggle("on", el.checked);
  const boxesOf = () => $$("input[type='checkbox']", container);
  const paintLabel = (label) => {
    if (!label || !container.contains(label)) return;
    const box = label.querySelector("input[type='checkbox']");
    if (!box || box.checked === container._paintValue) return;
    box.checked = container._paintValue;
    syncLabel(box);
    const idx = [...container.children].indexOf(label);
    if (idx >= 0) container._lastPick = idx;
    syncPagePickMaster(container);
  };
  state.pages.forEach((p, i) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = p.name;
    box.checked = chosen.has(p.name);
    label.classList.toggle("on", box.checked);
    label.addEventListener("click", (e) => {
      if (e.shiftKey && container._lastPick >= 0) {
        e.preventDefault();
        const a = Math.min(container._lastPick, i);
        const b = Math.max(container._lastPick, i);
        boxesOf().forEach((el, idx) => {
          if (idx >= a && idx <= b) {
            el.checked = true;
            syncLabel(el);
          }
        });
        syncPagePickMaster(container);
        return;
      }
      container._lastPick = i;
    });
    box.addEventListener("change", () => {
      syncLabel(box);
      container._lastPick = i;
      syncPagePickMaster(container);
    });
    label.append(box, document.createTextNode(String(i + 1).padStart(3, "0")));
    container.appendChild(label);
  });
  container.onpointerdown = (e) => {
    if (e.button !== 0 || e.shiftKey) return;
    const label = e.target.closest("label");
    if (!label) return;
    e.preventDefault();
    const startBox = label.querySelector("input[type='checkbox']");
    container._paint = true;
    container._paintValue = !(startBox && startBox.checked);
    try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    paintLabel(label);
  };
  container.onpointermove = (e) => {
    if (!container._paint) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    paintLabel(el && el.closest("label"));
  };
  container.onpointerup = container.onpointercancel = () => {
    container._paint = false;
  };
  syncPagePickMaster(container);
}

function selectedPagePicks(container) {
  return $$("input[type='checkbox']:checked", container).map((el) => el.value);
}

function setPagePickSelection(container, mode) {
  const boxes = $$("input[type='checkbox']", container);
  boxes.forEach((box) => {
    if (mode === "all") box.checked = true;
    else if (mode === "none") box.checked = false;
    else box.checked = box.value === state.pageName;
    box.closest("label")?.classList.toggle("on", box.checked);
  });
  syncPagePickMaster(container);
}

function autoLog(msg) {
  ui.autoLogBox.hidden = false;
  const line = document.createElement("div");
  line.textContent = msg;
  ui.autoLogBox.appendChild(line);
  ui.autoLogBox.scrollTop = ui.autoLogBox.scrollHeight;
}

function resetAutoPanels() {
  ui.autoLogBox.hidden = true;
  ui.autoLogBox.innerHTML = "";
  ui.autoPreview.hidden = true;
  ui.autoPreview.innerHTML = "";
  ui.btnAutoApply.hidden = true;
  bag.autoResults = [];
}

function renderAutoPreview(items) {
  ui.autoPreview.hidden = !items.length;
  ui.autoPreview.innerHTML = "";
  items.forEach((it) => {
    const art = document.createElement("article");
    art.className = "auto-item";
    const head = document.createElement("header");
    head.textContent = `${pageLabel(it.pageName)}　#${it.order}`;
    const src = document.createElement("div");
    src.className = "src";
    src.textContent = it.src || "";
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.value = it.text || "";
    ta.addEventListener("input", () => {
      it.text = ta.value;
    });
    art.append(head, src, ta);
    ui.autoPreview.appendChild(art);
  });
}

async function loadSavedSettings() {
  const res = await apiGet("/api/settings");
  const data = await res.json();
  return data.settings || {};
}

async function saveApiSettings() {
  const data = await apiJson("/api/settings", { settings: collectApiSettings() });
  fillApiForm(data.settings || {});
  return data.settings;
}

async function openSettingsModal() {
  ui.settingsModal.hidden = false;
  try {
    fillApiForm(await loadSavedSettings());
  } catch (err) {
    toastT("settingsLoadFail", { msg: err.message });
  }
}

async function openAutoModal() {
  ui.autoModal.hidden = false;
  resetAutoPanels();
  renderPagePicks(ui.autoPages, state.pageName ? [state.pageName] : []);
  try {
    fillAutoOptions(await loadSavedSettings());
  } catch (err) {
    toastT("autoLoadFail", { msg: err.message });
  }
}

function setAutoBusy(busy) {
  bag.autoBusy = busy;
  ui.btnAutoRun.disabled = busy;
  ui.btnAutoApply.disabled = busy;
}

function setSettingsBusy(busy) {
  ["btn-set-test", "btn-set-vision", "btn-set-save"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.disabled = busy;
  });
}

async function runAutoPipeline() {
  if (bag.autoBusy) return;
  const names = selectedPagePicks(ui.autoPages);
  if (!names.length) {
    toastT("pickAutoPages");
    return;
  }
  let saved;
  try {
    saved = await loadSavedSettings();
  } catch (err) {
    toast(err.message);
    return;
  }
  if ((saved.ocrEngine || "local") === "api" && !saved.hasApiKey) {
    toastT("needVisionKey");
    openSettingsModal();
    return;
  }
  const useLocal = (saved.ocrEngine || "local") !== "api";
  if (names.length > 3 && !confirmT("confirm.autoMany", { n: names.length, extra: useLocal ? t("confirm.autoManyLocal") : "" })) return;
  resetAutoPanels();
  setAutoBusy(true);
    ui.btnAutoRun.textContent = t("log.running");
  try {
    await apiJson("/api/settings", { settings: collectAutoOptions() });
    const includeSfx = ui.autoSfx.checked;
    const collected = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      autoLog(t("log.recognize", { i: i + 1, n: names.length, name }));
      try {
        const res = await apiJson("/api/auto/recognize", { pageName: name, includeSfx });
        const bubbles = res.bubbles || [];
        autoLog(t("log.found", { n: bubbles.length }));
        if (res.warning) autoLog("　" + res.warning);
        if (!bubbles.length && res.rawPreview) autoLog(t("log.modelRaw", { text: res.rawPreview }));
        for (const b of bubbles) collected.push({ ...b, pageName: name });
      } catch (err) {
        autoLog(t("log.fail", { msg: err.message }));
      }
    }
    if (!collected.length) {
      autoLog(t("log.none"));
      toastT("noDialogue");
      return;
    }
    let translated = [];
    if (!saved.hasApiKey) {
      autoLog(t("log.noTranslateApi"));
      translated = collected.map((src) => ({ ...src, text: src.src }));
    } else {
      autoLog(t("log.translateStart", { n: collected.length }));
      const chunkSize = 6;
      for (let i = 0; i < collected.length; i += chunkSize) {
        const chunk = collected.slice(i, i + chunkSize);
        autoLog(t("log.translateChunk", { a: i + 1, b: Math.min(i + chunk.length, collected.length), n: collected.length }));
        try {
          const res = await apiJson("/api/auto/translate", {
            items: chunk,
            doBreak: ui.autoBreak.checked,
          });
          const byId = new Map(
            (res.items || []).map((it) => [it.id || `${it.pageName}#${it.order}`, it])
          );
          for (const src of chunk) {
            const hit = byId.get(src.pageName + "#" + src.order) || byId.get(String(src.order));
            translated.push({
              ...src,
              text: (hit && hit.text) || src.src,
            });
          }
        } catch (err) {
          autoLog(t("log.translateFail", { msg: err.message }));
          for (const src of chunk) translated.push({ ...src, text: src.src });
        }
      }
    }
    bag.autoResults = translated;
    renderAutoPreview(bag.autoResults);
    ui.btnAutoApply.hidden = false;
    autoLog(t("log.done"));
    toastT("recognizeDone", { n: bag.autoResults.length });
  } catch (err) {
    autoLog(t("log.abort", { msg: err.message }));
    toast(err.message);
  } finally {
    setAutoBusy(false);
    ui.btnAutoRun.textContent = t("log.start");
  }
}

function bubbleIsVertical(item) {
  if (!item || typeof item !== "object") return true;
  if (item.vertical === true || item.vertical === false) return item.vertical;
  const mode = String(item.writingMode || item.direction || "").toLowerCase();
  if (["horizontal", "horizontal-tb", "ltr", "rtl"].includes(mode)) return false;
  if (["vertical", "vertical-rl", "vertical-lr"].includes(mode)) return true;
  const w = Number(item.w) || 0;
  const h = Number(item.h) || 0;
  if (w > 0 && h > 0) return h >= w;
  return true;
}

function applyAutoResults() {
  if (!bag.autoResults.length) {
    toastT("noWrite");
    return;
  }
  pushHistory({ paint: false, projectData: true, allPages: true });
  const place = ui.autoPlace.checked;
  let n = 0;
  for (const item of bag.autoResults) {
    const text = String(item.text || "").replace(/\r/g, "");
    if (!text.trim() && !String(item.src || "").trim()) continue;
    const d = {
      id: uid("d"),
      text: text || item.src || "",
      src: item.src || "",
      pageName: item.pageName || "",
    };
    project.dialogue.push(d);
    if (place && item.pageName) {
      const style = { ...styleForNewText(), vertical: bubbleIsVertical(item) };
      const box = estimateBox(d.text || t("ui.measureSample"), style);
      const t = {
        id: uid("t"),
        dialogueId: d.id,
        text: d.text,
        x: (item.x || 0) + Math.max(0, ((item.w || box.w) - box.w) / 2),
        y: (item.y || 0) + Math.max(0, ((item.h || box.h) - box.h) / 2),
        ...style,
        w: box.w,
        h: box.h,
      };
      pageEntry(item.pageName).texts.push(t);
    }
    if (item.pageName) state.collapsedFolders.delete(item.pageName);
    n++;
  }
  if (!state.selectedDialogueId && project.dialogue[0]) {
    selectDialogues([project.dialogue[0].id]);
  }
  renderTexts();
  renderDialogue();
  markDirty();
  ui.autoModal.hidden = true;
  toastT("wrote", { n });
}

export {
  postProbe,
  renderPagePicks,
  selectedPagePicks,
  setPagePickSelection,
  saveApiSettings,
  openSettingsModal,
  openAutoModal,
  setSettingsBusy,
  runAutoPipeline,
  applyAutoResults,
};
