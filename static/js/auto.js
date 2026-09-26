// --- AI 翻譯 ---
import { $, $$, state, project, ui, bag, uid, pageEntry, selectDialogues, pageMediaUrl } from "./store.js";
import { t, toast, toastT, confirmT } from "./copy.js";
import { apiGet, apiJson, markDirty, saveEraseNow } from "./api.js";
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
    autoErase: !!(ui.autoErase && ui.autoErase.checked),
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
  if (ui.autoErase) ui.autoErase.checked = settings.autoErase !== false;
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
    art.className = "auto-item" + (it.lowConf ? " low-conf" : "");
    const head = document.createElement("header");
    head.append(document.createTextNode(`${pageLabel(it.pageName)}　#${it.order}`));
    if (it.lowConf) {
      const mark = document.createElement("span");
      mark.className = "low-conf-mark";
      mark.textContent = t("log.needReview");
      head.append(" ", mark);
    }
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

function collectGlossary() {
  if (!Array.isArray(project.glossary)) project.glossary = [];
  return project.glossary
    .map((row) => ({
      src: String(row?.src || "").trim(),
      text: String(row?.text || "").trim(),
    }))
    .filter((row) => row.src && row.text);
}

function recentTranslationMemory() {
  const rows = [];
  for (const d of project.dialogue || []) {
    const src = String(d.src || "").trim();
    const text = String(d.text || "").trim();
    if (!src || !text || text === src) continue;
    rows.push({ src, text });
  }
  return rows.slice(-20);
}

function glossaryToText(rows) {
  return (rows || [])
    .filter((row) => String(row?.src || "").trim() || String(row?.text || "").trim())
    .map((row) => `${String(row.src || "").trim()}=${String(row.text || "").trim()}`)
    .join("\n");
}

function parseGlossaryText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*(?:=|→|｜|\t)\s*/);
      return { src: parts[0] || "", text: parts.slice(1).join("=") };
    });
}

function syncGlossaryText() {
  if (!ui.autoGlossaryText) return;
  if (document.activeElement === ui.autoGlossaryText) return;
  ui.autoGlossaryText.value = glossaryToText(project.glossary);
}

function renderGlossary(opts = {}) {
  if (!ui.autoGlossary) return;
  if (!Array.isArray(project.glossary)) project.glossary = [];
  const rows = project.glossary.length ? project.glossary.slice() : [{ src: "", text: "" }];
  ui.autoGlossary.innerHTML = "";
  rows.forEach((row, i) => {
    const line = document.createElement("div");
    line.className = "glossary-row";
    const src = document.createElement("input");
    src.type = "text";
    src.value = row.src || "";
    src.placeholder = t("placeholders.glossarySrc");
    src.spellcheck = false;
    src.addEventListener("input", () => {
      if (!project.glossary[i]) project.glossary[i] = { src: "", text: "" };
      project.glossary[i].src = src.value;
      markDirty();
      syncGlossaryText();
    });
    const text = document.createElement("input");
    text.type = "text";
    text.value = row.text || "";
    text.placeholder = t("placeholders.glossaryText");
    text.spellcheck = false;
    text.addEventListener("input", () => {
      if (!project.glossary[i]) project.glossary[i] = { src: "", text: "" };
      project.glossary[i].text = text.value;
      markDirty();
      syncGlossaryText();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost compact";
    del.textContent = t("ui.glossaryDel");
    del.addEventListener("click", () => {
      if (project.glossary.length) project.glossary.splice(i, 1);
      markDirty();
      renderGlossary();
    });
    line.append(src, text, del);
    ui.autoGlossary.appendChild(line);
  });
  if (!opts.skipText) syncGlossaryText();
}

function addGlossaryRow() {
  if (!Array.isArray(project.glossary)) project.glossary = [];
  const last = project.glossary[project.glossary.length - 1];
  if (last && !String(last.src || "").trim() && !String(last.text || "").trim()) {
    renderGlossary();
    return;
  }
  project.glossary.push({ src: "", text: "" });
  markDirty();
  renderGlossary();
}

function onGlossaryTextInput() {
  project.glossary = parseGlossaryText(ui.autoGlossaryText.value);
  markDirty();
  renderGlossary({ skipText: true });
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

function setSettingsTab(name) {
  const tab = name === "prompts" || name === "glossary" ? name : "api";
  $$("[data-settings-tab]").forEach((btn) => {
    const on = btn.dataset.settingsTab === tab;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".settings-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== tab;
  });
  if (tab === "glossary") renderGlossary();
}

async function openSettingsModal() {
  ui.settingsModal.hidden = false;
  setSettingsTab("api");
  try {
    fillApiForm(await loadSavedSettings());
  } catch (err) {
    toastT("settingsLoadFail", { msg: err.message });
  }
  renderGlossary();
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

function isAbortError(err) {
  return !!(err && (err.name === "AbortError" || err.code === 20));
}

function setAutoBusy(busy) {
  bag.autoBusy = busy;
  ui.btnAutoRun.disabled = busy;
  ui.btnAutoApply.disabled = busy;
  if (ui.btnAutoCancel) ui.btnAutoCancel.textContent = busy ? t("log.stop") : t("log.close");
}

function closeAutoModal() {
  const ac = bag.autoAbort;
  const wasBusy = bag.autoBusy;
  if (ac) ac.abort();
  bag.autoAbort = null;
  setAutoBusy(false);
  ui.btnAutoRun.textContent = t("log.start");
  ui.autoModal.hidden = true;
  if (wasBusy) toastT("autoCancelled");
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
  const ac = new AbortController();
  bag.autoAbort = ac;
  const { signal } = ac;
  setAutoBusy(true);
  ui.btnAutoRun.textContent = t("log.running");
  try {
    await apiJson("/api/settings", { settings: collectAutoOptions() }, { signal });
    const includeSfx = ui.autoSfx.checked;
    const collected = [];
    for (let i = 0; i < names.length; i++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const name = names[i];
      autoLog(t("log.recognize", { i: i + 1, n: names.length, name }));
      try {
        const res = await apiJson("/api/auto/recognize", { pageName: name, includeSfx }, { signal });
        const bubbles = res.bubbles || [];
        autoLog(t("log.found", { n: bubbles.length }));
        if (res.warning) autoLog("　" + res.warning);
        if (!bubbles.length && res.rawPreview) autoLog(t("log.modelRaw", { text: res.rawPreview }));
        for (const b of bubbles) collected.push({ ...b, pageName: name, pageW: res.width, pageH: res.height });
      } catch (err) {
        if (isAbortError(err)) throw err;
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
      const glossary = collectGlossary();
      const runMemory = [];
      for (let i = 0; i < collected.length; i += chunkSize) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const chunk = collected.slice(i, i + chunkSize);
        autoLog(t("log.translateChunk", { a: i + 1, b: Math.min(i + chunk.length, collected.length), n: collected.length }));
        try {
          const res = await apiJson("/api/auto/translate", {
            items: chunk,
            doBreak: ui.autoBreak.checked,
            glossary,
            memory: [...recentTranslationMemory(), ...runMemory],
          }, { signal });
          const byId = new Map(
            (res.items || []).map((it) => [it.id || `${it.pageName}#${it.order}`, it])
          );
          for (const src of chunk) {
            const hit = byId.get(src.pageName + "#" + src.order) || byId.get(String(src.order));
            const text = (hit && hit.text) || src.src;
            translated.push({
              ...src,
              text,
            });
            if (src.src && text && text !== src.src) runMemory.push({ src: src.src, text });
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
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
    if (isAbortError(err) || signal.aborted) return;
    autoLog(t("log.abort", { msg: err.message }));
    toast(err.message);
  } finally {
    if (bag.autoAbort === ac) bag.autoAbort = null;
    if (!bag.autoAbort) {
      setAutoBusy(false);
      ui.btnAutoRun.textContent = t("log.start");
    }
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

function paddedBox(item, imgW, imgH) {
  const padX = Math.max(4, (Number(item.w) || 0) * 0.12);
  const padY = Math.max(4, (Number(item.h) || 0) * 0.12);
  const x = Math.max(0, (Number(item.x) || 0) - padX);
  const y = Math.max(0, (Number(item.y) || 0) - padY);
  return {
    x,
    y,
    w: Math.min(imgW - x, (Number(item.w) || 0) + padX * 2),
    h: Math.min(imgH - y, (Number(item.h) || 0) + padY * 2),
  };
}

function sampleFill(ctx, box, imgW, imgH) {
  const pts = [
    [box.x + 2, box.y + 2],
    [box.x + box.w - 3, box.y + 2],
    [box.x + 2, box.y + box.h - 3],
    [box.x + box.w - 3, box.y + box.h - 3],
  ];
  const samples = [];
  for (const [x, y] of pts) {
    const px = Math.min(imgW - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(imgH - 1, Math.max(0, Math.floor(y)));
    try {
      const d = ctx.getImageData(px, py, 1, 1).data;
      samples.push({ r: d[0], g: d[1], b: d[2] });
    } catch {
      /* ignore */
    }
  }
  if (!samples.length) return "#ffffff";
  samples.sort((a, b) => b.r + b.g + b.b - (a.r + a.g + a.b));
  const c = samples[0];
  if (c.r + c.g + c.b < 360) return "#ffffff";
  return `rgb(${c.r},${c.g},${c.b})`;
}

function decodeImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

async function writeErasePage(pageName, boxes) {
  const img = await decodeImage(pageMediaUrl(pageName));
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (pageName === state.pageName && ui.paint) ctx.drawImage(ui.paint, 0, 0);
  else {
    try {
      const stem = pageName.replace(/\.[^.]+$/, "");
      ctx.drawImage(await decodeImage("/api/erase/" + encodeURIComponent(stem) + ".png?t=" + Date.now()), 0, 0);
    } catch {
      /* none */
    }
  }
  const sample = document.createElement("canvas");
  sample.width = w;
  sample.height = h;
  const sctx = sample.getContext("2d");
  sctx.drawImage(img, 0, 0);
  for (const item of boxes) {
    const box = paddedBox(item, w, h);
    if (box.w < 4 || box.h < 4) continue;
    ctx.fillStyle = sampleFill(sctx, box, w, h);
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  if (pageName === state.pageName && ui.paintCtx) {
    ui.paintCtx.clearRect(0, 0, ui.paint.width, ui.paint.height);
    ui.paintCtx.drawImage(canvas, 0, 0);
    state.paintDirty = true;
    await saveEraseNow();
    return;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const stem = pageName.replace(/\.[^.]+$/, "");
  await fetch("/api/erase/" + encodeURIComponent(stem) + ".png", { method: "POST", body: blob });
}

async function writeEraseForResults(items) {
  const byPage = new Map();
  for (const item of items || []) {
    if (!item.pageName || !(Number(item.w) > 0 && Number(item.h) > 0)) continue;
    if (!byPage.has(item.pageName)) byPage.set(item.pageName, []);
    byPage.get(item.pageName).push(item);
  }
  for (const [pageName, boxes] of byPage) {
    await writeErasePage(pageName, boxes);
  }
}

async function applyAutoResults() {
  if (!bag.autoResults.length) {
    toastT("noWrite");
    return;
  }
  const doErase = !!(ui.autoErase && ui.autoErase.checked);
  pushHistory({ paint: doErase, projectData: true, allPages: true });
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
  if (doErase) {
    try {
      await writeEraseForResults(bag.autoResults);
    } catch (err) {
      toast(err.message);
    }
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
  closeAutoModal,
  setSettingsBusy,
  runAutoPipeline,
  applyAutoResults,
  addGlossaryRow,
  onGlossaryTextInput,
  setSettingsTab,
};
