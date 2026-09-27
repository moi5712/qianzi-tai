// --- GitHub Pages／純瀏覽器後端：IndexedDB 取代本機 Python API ---

export let WEB_MODE = false;

const DB_NAME = "qianzi-tai";
const DB_VER = 1;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const FONT_EXT = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const WEB_FONTS = [
  { file: "NotoSansTC", family: "Noto Sans TC", label: "Noto Sans TC", weight: 400, weightLabel: "Regular", builtin: true, url: "" },
  { file: "NotoSerifTC", family: "Noto Serif TC", label: "Noto Serif TC", weight: 400, weightLabel: "Regular", builtin: true, url: "" },
];
const DEFAULT_SETTINGS = {
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  ocrPrompt: "",
  translatePrompt: "",
  includeSfx: false,
  doBreak: true,
  placeOnCanvas: true,
  autoErase: true,
  maxLongSide: 1792,
  ocrEngine: "api",
};

const nativeFetch = window.fetch.bind(window);
const urlCache = new Map();
let db = null;

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function textRes(text, status = 404, mime = "text/plain; charset=utf-8") {
  return new Response(text, { status, headers: { "Content-Type": mime } });
}

function blobRes(blob, mime) {
  return new Response(blob, {
    status: 200,
    headers: { "Content-Type": mime || blob.type || "application/octet-stream" },
  });
}

function objectUrl(key, blob) {
  const prev = urlCache.get(key);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function stemOf(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function safeName(name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  if (!base || base === "." || base === ".." || base.includes("\0")) throw new Error("檔名無效");
  return base;
}

function uniqueName(filename, existing, allowed) {
  const name = safeName(filename);
  const ext = extOf(name);
  if (!allowed.has(ext)) throw new Error(allowed === IMAGE_EXT ? "只接受 PNG、JPG、WEBP" : "只接受 TTF、OTF、WOFF");
  const stem = stemOf(name).trim() || (allowed === IMAGE_EXT ? "page" : "font");
  let dest = stem + ext;
  let n = 2;
  while (existing.has(dest)) {
    dest = `${stem}-${n}${ext}`;
    n += 1;
  }
  return dest;
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function openDb() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const next = req.result;
      for (const name of ["meta", "pages", "erase", "fonts"]) {
        if (!next.objectStoreNames.contains(name)) next.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function metaGet(key) {
  return idbReq(db.transaction("meta").objectStore("meta").get(key));
}

function metaSet(key, value) {
  return idbReq(db.transaction("meta", "readwrite").objectStore("meta").put(value, key));
}

function storeGet(name, key) {
  return idbReq(db.transaction(name).objectStore(name).get(key));
}

function storeSet(name, key, value) {
  return idbReq(db.transaction(name, "readwrite").objectStore(name).put(value, key));
}

function storeDel(name, key) {
  return idbReq(db.transaction(name, "readwrite").objectStore(name).delete(key));
}

function storeAll(name) {
  return idbReq(db.transaction(name).objectStore(name).getAll());
}

function storeKeys(name) {
  return idbReq(db.transaction(name).objectStore(name).getAllKeys());
}

function storeClear(name) {
  return idbReq(db.transaction(name, "readwrite").objectStore(name).clear());
}

function emptyWorkspace() {
  return { id: "", name: "未開啟專案", folder: "" };
}

async function currentWorkspace() {
  return (await metaGet("workspace")) || emptyWorkspace();
}

async function ensureWorkspace() {
  const ws = await currentWorkspace();
  if (ws.id) return ws;
  const created = { id: "browser", name: "瀏覽器專案", folder: "此瀏覽器" };
  await metaSet("workspace", created);
  if (!(await metaGet("project"))) await metaSet("project", {});
  if (!(await metaGet("settings"))) await metaSet("settings", { ...DEFAULT_SETTINGS });
  return created;
}

function needProject(ws) {
  return !!(ws && ws.id);
}

function publicSettings(data) {
  const out = { ...DEFAULT_SETTINGS, ...(data || {}) };
  out.ocrEngine = "api";
  const key = String(out.apiKey || "");
  out.hasApiKey = Boolean(key.trim());
  out.apiKey = "";
  return out;
}

async function loadSettings() {
  const saved = (await metaGet("settings")) || {};
  return { ...DEFAULT_SETTINGS, ...saved, ocrEngine: "api" };
}

async function mergeSettings(incoming) {
  const data = await loadSettings();
  if (!incoming || typeof incoming !== "object") return data;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in incoming)) continue;
    if (key === "apiKey" && !String(incoming.apiKey || "").trim()) continue;
    data[key] = incoming[key];
  }
  data.ocrEngine = "api";
  await metaSet("settings", data);
  return data;
}

async function fontCatalog() {
  const user = await storeAll("fonts");
  const fonts = [
    ...WEB_FONTS,
    ...user.map((item) => ({
      file: item.file,
      family: item.family,
      label: item.label || item.family,
      weight: item.weight || 400,
      weightLabel: item.weightLabel || "",
      builtin: false,
      url: item.blob ? objectUrl("font:" + item.file, item.blob) : "",
    })),
  ];
  return { fonts };
}

async function pagesPayload() {
  const pages = (await storeAll("pages"))
    .filter((p) => p && p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const eraseKeys = new Set(await storeKeys("erase"));
  return {
    pages: pages.map((p) => {
      const stem = stemOf(p.name);
      return {
        name: p.name,
        url: p.blob ? objectUrl("media:" + p.name, p.blob) : "/media/" + encodeURIComponent(p.name),
        thumb: p.thumb ? objectUrl("thumb:" + stem, p.thumb) : "/thumbs/" + encodeURIComponent(stem) + ".jpg",
        erase: eraseKeys.has(stem) ? "/api/erase/" + encodeURIComponent(stem) + ".png?v=" + Date.now() : "",
        size: p.size || (p.blob && p.blob.size) || 0,
      };
    }),
    folder: (await currentWorkspace()).folder || "",
  };
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

async function makeThumb(blob) {
  const img = await blobToImage(blob);
  const max = 160;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72));
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function pickFiles(directory) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) {
      input.webkitdirectory = true;
      input.directory = true;
    } else {
      input.accept = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
    }
    const done = (files) => resolve(files);
    input.addEventListener("change", () => done([...(input.files || [])]));
    input.addEventListener("cancel", () => done(null));
    input.click();
  });
}

async function collectDirFiles(dirHandle, prefix = "") {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: prefix + name });
      files.push(file);
    } else if (handle.kind === "directory") {
      files.push(...(await collectDirFiles(handle, prefix + name + "/")));
    }
  }
  return files;
}

async function pickDirectoryFiles() {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      const files = await collectDirFiles(dir);
      files._folderName = dir.name;
      return files;
    } catch (err) {
      if (err && err.name === "AbortError") return null;
    }
  }
  return pickFiles(true);
}

function relPath(file) {
  return String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
}

function isHiddenPath(path) {
  return /(^|\/)(\.lettering|匯出|thumbs)(\/|$)/i.test(path);
}

async function importFolder(files, name) {
  const folderName = name || files._folderName || relPath(files[0] || {}).split("/")[0] || "專案";
  await storeClear("pages");
  await storeClear("erase");
  const used = new Set();
  let project = {};
  for (const file of files) {
    const path = relPath(file);
    const base = safeName(file.name);
    if (path.endsWith(".lettering/project.json") || base === "project.json" && path.includes(".lettering")) {
      try {
        project = JSON.parse(await file.text()) || {};
      } catch {
        project = {};
      }
      continue;
    }
    if (path.includes(".lettering/erase/") && extOf(base) === ".png") {
      await storeSet("erase", stemOf(base), file);
      continue;
    }
    if (!IMAGE_EXT.has(extOf(base)) || isHiddenPath(path)) continue;
    const dest = uniqueName(base, used, IMAGE_EXT);
    used.add(dest);
    let thumb = null;
    try {
      thumb = await makeThumb(file);
    } catch {
      thumb = null;
    }
    await storeSet("pages", dest, { name: dest, blob: file, thumb, size: file.size });
  }
  await metaSet("project", project && typeof project === "object" ? project : {});
  const ws = { id: "folder-" + Date.now().toString(36), name: folderName, folder: folderName };
  await metaSet("workspace", ws);
  return { ok: true, ...ws };
}

async function createWorkspace() {
  await storeClear("pages");
  await storeClear("erase");
  await metaSet("project", {});
  const ws = { id: "browser-" + Date.now().toString(36), name: "未命名專案", folder: "此瀏覽器" };
  await metaSet("workspace", ws);
  return { ok: true, ...ws };
}

function injectWebFonts() {
  const href = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@400;600;700&display=swap";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = "https://fonts.googleapis.com";
  const pre2 = document.createElement("link");
  pre2.rel = "preconnect";
  pre2.href = "https://fonts.gstatic.com";
  pre2.crossOrigin = "anonymous";
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(pre, pre2, link);
}

export function applyWebUi() {
  const sel = document.getElementById("set-ocr-engine");
  const local = sel && sel.querySelector('option[value="local"]');
  if (local) local.remove();
  if (sel) sel.value = "api";
}

function classifyChatError(err, status) {
  const text = String((err && err.message) || err || "");
  const low = text.toLowerCase();
  if (err && (err.name === "AbortError" || err.code === 20)) throw err;
  if (status === 401 || /invalid_api_key|unauthorized|incorrect api key/.test(low)) return "http_401";
  if (status === 403) return "http_403";
  if (status === 404 || (/model/.test(low) && /not found|does not exist|invalid model/.test(low))) return "http_404";
  if (status === 429 || /rate.?limit|insufficient_quota/.test(low)) return "http_429";
  if (status >= 500) return "http_5xx";
  if (status) return "http_other";
  if (/請先填 API Key/.test(text)) return "missing_key";
  if (/請先填模型/.test(text)) return "missing_model";
  if (/請先填 API 位址/.test(text)) return "missing_base";
  if (/failed to fetch|networkerror|load failed|cors/.test(low)) return "cors";
  if (/timed? ?out/.test(low)) return "timeout";
  if (/不是 JSON/.test(text)) return "invalid_json";
  if (/沒有回傳內容/.test(text)) return "no_content";
  return "unknown";
}

function chatUrl(apiBase) {
  const base = String(apiBase || "").trim().replace(/\/$/, "");
  if (!base) throw new Error("請先填 API 位址");
  return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
}

function partsText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const kind = String(part.type || "");
      if (kind === "reasoning" || kind === "thinking") return "";
      return String(part.text || "");
    })
    .join("");
}

function payloadAttempts(settings) {
  const base = String(settings.apiBase || "").toLowerCase();
  const model = String(settings.model || "").toLowerCase();
  if (base.includes("deepseek") || model.includes("deepseek")) {
    return [
      { max_tokens: 8192, thinking: { type: "disabled" } },
      { max_tokens: 16384, thinking: { type: "disabled" } },
      { max_tokens: 16384 },
    ];
  }
  return [{ max_tokens: 8192 }, { max_tokens: 16384 }, {}];
}

async function chatComplete(settings, messages, timeoutSec = 180, signal) {
  const key = String(settings.apiKey || "").trim();
  const model = String(settings.model || "").trim();
  if (!key) throw new Error("請先填 API Key");
  if (!model) throw new Error("請先填模型名稱");
  const url = chatUrl(settings.apiBase);
  let lastError = null;
  for (const extra of payloadAttempts(settings)) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutSec * 1000);
    const onAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const res = await nativeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ model, messages, temperature: 0.2, ...extra }),
        signal: ac.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        lastError = Object.assign(new Error(`API HTTP ${res.status}：${raw.slice(0, 800)}`), { status: res.status });
        if (extra && (res.status === 400 || res.status === 422)) continue;
        throw lastError;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        lastError = new Error("API 回傳不是 JSON");
        continue;
      }
      if (data && data.error) {
        const msg = data.error.message || data.error;
        lastError = new Error("API 錯誤：" + msg);
        continue;
      }
      const choice = data && data.choices && data.choices[0];
      const text = partsText(choice && choice.message && choice.message.content).trim();
      if (text) return text;
      if (choice && choice.finish_reason === "length" && extra) continue;
      break;
    } catch (err) {
      if (err && (err.name === "AbortError" || err.code === 20) && signal && signal.aborted) throw err;
      if (err && err.status) throw err;
      lastError = Object.assign(new Error("連不到 API：" + (err && err.message ? err.message : err)), { code: "cors" });
      throw lastError;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  if (lastError) throw lastError;
  throw new Error("模型沒有回傳內容");
}

function extractJson(text) {
  let raw = String(text || "").trim();
  if (!raw) throw new Error("模型沒有回傳內容");
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  let blob = "";
  if (objStart >= 0 && objEnd > objStart && (arrStart < 0 || objStart <= arrStart)) blob = raw.slice(objStart, objEnd + 1);
  else if (arrStart >= 0 && arrEnd > arrStart) blob = raw.slice(arrStart, arrEnd + 1);
  else throw new Error("模型回傳不是 JSON");
  return JSON.parse(blob);
}

function collectList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["bubbles", "items", "dialogues", "dialogue", "texts", "lines", "results", "data"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function itemSrc(item) {
  for (const key of ["src", "original", "jp", "ocr"]) {
    const val = String(item[key] || "").trim();
    if (val) return val;
  }
  return "";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toBox(item, imgW, imgH) {
  let x = Number(item.x) || 0;
  let y = Number(item.y) || 0;
  let w = Number(item.w) || 0;
  let h = Number(item.h) || 0;
  if (Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h)) <= 1.5) {
    x *= imgW;
    y *= imgH;
    w *= imgW;
    h *= imgH;
  }
  x = clamp(x, 0, imgW);
  y = clamp(y, 0, imgH);
  w = clamp(w, 8, imgW - x);
  h = clamp(h, 8, imgH - y);
  let vertical = item.vertical;
  if (typeof vertical !== "boolean") vertical = h >= w;
  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2), vertical };
}

function scaleBox(box, sentW, sentH, origW, origH) {
  if (sentW === origW && sentH === origH) return box;
  const sx = origW / Math.max(sentW, 1);
  const sy = origH / Math.max(sentH, 1);
  const x = clamp(box.x * sx, 0, origW);
  const y = clamp(box.y * sy, 0, origH);
  return {
    ...box,
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    w: +clamp(box.w * sx, 8, origW - x).toFixed(2),
    h: +clamp(box.h * sy, 8, origH - y).toFixed(2),
  };
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function encodePageImage(blob, maxLongSide = 1792) {
  const img = await blobToImage(blob);
  const origW = img.naturalWidth;
  const origH = img.naturalHeight;
  const limit = Math.max(640, Math.min(Number(maxLongSide) || 1792, 4096));
  const longest = Math.max(origW, origH);
  let w = origW;
  let h = origH;
  if (longest > limit) {
    const scale = limit / longest;
    w = Math.max(1, Math.round(origW * scale));
    h = Math.max(1, Math.round(origH * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  return { b64: arrayBufferToBase64(await jpeg.arrayBuffer()), origW, origH, sentW: w, sentH: h };
}

async function recognizePage(pageName, settings, includeSfx, signal) {
  const page = await storeGet("pages", pageName);
  if (!page || !page.blob) throw new Error("找不到頁面圖：" + pageName);
  const useSfx = includeSfx == null ? !!settings.includeSfx : !!includeSfx;
  const { b64, origW, origH, sentW, sentH } = await encodePageImage(page.blob, settings.maxLongSide);
  let prompt = String(settings.ocrPrompt || "").trim();
  if (!useSfx) prompt += "\n本次不要輸出 sfx，只輸出 speech / thought / narration。";
  prompt += "\nvertical 只能是 true 或 false：true 直排，false 橫排。";
  prompt += `\n本頁檔名：${pageName}，像素 ${sentW}×${sentH}。`;
  const content = await chatComplete(
    settings,
    [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "text", text: "請仔細看附上的漫畫圖，把全部對白氣泡檢測出來，只輸出 JSON。" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64 } },
        ],
      },
    ],
    180,
    signal,
  );
  const bubbles = [];
  for (const [i, item] of collectList(extractJson(content)).entries()) {
    if (!item || typeof item !== "object") continue;
    const src = itemSrc(item);
    if (!src) continue;
    let kind = String(item.kind || "speech").trim().toLowerCase();
    if (!["speech", "thought", "narration", "sfx"].includes(kind)) kind = "speech";
    if (kind === "sfx" && !useSfx) continue;
    const order = Number.parseInt(item.order, 10);
    bubbles.push({
      order: Number.isFinite(order) ? order : i + 1,
      src,
      kind,
      ...scaleBox(toBox(item, sentW, sentH), sentW, sentH, origW, origH),
    });
  }
  bubbles.sort((a, b) => a.order - b.order || a.y - b.y || b.x - a.x);
  bubbles.forEach((item, i) => {
    item.order = i + 1;
  });
  return {
    ok: true,
    pageName,
    width: origW,
    height: origH,
    bubbles,
    warning: bubbles.length ? "" : "模型未輸出任何對白。請至「API 設定」選擇支援圖像辨識的模型。",
    rawPreview: bubbles.length ? "" : String(content || "").trim().slice(0, 400),
  };
}

function pairList(rows, limit = 0) {
  const out = [];
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const src = String(row.src || "").trim();
    const text = String(row.text || "").trim();
    if (!src || !text) continue;
    out.push({ src, text });
  }
  return limit && out.length > limit ? out.slice(-limit) : out;
}

function normalizeBreak(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}

function rowText(row) {
  for (const key of ["text", "translation", "translated"]) {
    const val = String(row[key] || "").trim();
    if (val) return val;
  }
  return "";
}

function rowId(row, index) {
  for (const key of ["id", "key"]) {
    const val = String(row[key] || "").trim();
    if (val) return val;
  }
  const order = row.order;
  const page = String(row.pageName || row.page || "").trim();
  if (typeof order === "string" && order.includes("#")) return order.trim();
  if (page && order != null && String(order) !== "") return `${page}#${order}`;
  if (order != null && String(order) !== "") return `#${order}`;
  return `idx:${index}`;
}

async function translateItems(payload, settings, signal) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const valid = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const src = String(item.src || "").trim();
    if (!src) continue;
    const order = Number.parseInt(item.order, 10) || 0;
    const page = String(item.pageName || "");
    valid.push({
      id: `${page}#${order}`,
      order,
      src,
      pageName: page,
      kind: String(item.kind || "speech"),
    });
  }
  if (!valid.length) return { ok: true, items: [] };
  let prompt = String(settings.translatePrompt || "").trim();
  if (payload.doBreak === false) prompt += "\n不要斷行，每則對白保持單行。";
  prompt += "\n若原文沒有句號或逗號，則禁止自行添加標點。";
  prompt += '\ntext 必須輸出繁體中文，禁止輸出原文。\nid 必須與輸入完全相同。\n輸出格式：{"items":[{"id":"<id>","text":"<zh-Hant>"}]}';
  const glossary = pairList(payload.glossary);
  const memory = pairList(payload.memory, 40);
  const userParts = ["翻譯以下對白。每行格式是 id<TAB>日文原文。只輸出 JSON。"];
  if (glossary.length) {
    userParts.push("用語表：");
    userParts.push(...glossary.map((row) => `- ${row.src} → ${row.text}`));
  }
  if (memory.length) {
    userParts.push("近期已確認譯文：");
    userParts.push(...memory.map((row) => `- ${row.src} → ${row.text}`));
  }
  userParts.push(valid.map((item) => `${item.id}\t${item.src}`).join("\n"));
  const content = await chatComplete(
    settings,
    [
      { role: "system", content: prompt },
      { role: "user", content: userParts.join("\n") },
    ],
    180,
    signal,
  );
  const data = extractJson(content);
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === "object") {
    rows = collectList(data);
    if (!rows.length) {
      rows = Object.entries(data).filter(([, val]) => typeof val === "string").map(([id, text]) => ({ id, text }));
    }
  }
  const mapped = {};
  const sequential = [];
  rows.forEach((row, i) => {
    if (typeof row === "string") {
      sequential.push(row);
      return;
    }
    if (!row || typeof row !== "object") return;
    const text = rowText(row);
    sequential.push(text);
    mapped[rowId(row, i)] = text;
    const order = Number.parseInt(row.order, 10);
    if (Number.isFinite(order)) mapped["#" + order] = text;
  });
  const out = valid.map((item, i) => {
    let text = mapped[item.id] || mapped["#" + item.order] || "";
    if (!text && i < sequential.length) text = sequential[i];
    text = normalizeBreak(text).replace(/[。，]/g, "");
    text = normalizeBreak(text);
    if (payload.doBreak === false) text = text.replace(/\s*\n\s*/g, "");
    if (!text) text = item.src;
    return { ...item, text };
  });
  return { ok: true, items: out };
}

function probeToken(n = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(n);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[arr[i] % alphabet.length];
  return s;
}

async function testConnection(settings, signal) {
  try {
    const content = await chatComplete(settings, [{ role: "user", content: "Reply with exactly: READY" }], 40, signal);
    return { ok: Boolean(String(content || "").trim()), code: String(content || "").trim() ? "connected" : "no_content" };
  } catch (err) {
    return { ok: false, code: err.code || classifyChatError(err, err.status) };
  }
}

async function testVision(settings, signal) {
  const token = probeToken(4);
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f8f8f8";
  ctx.fillRect(0, 0, 360, 140);
  ctx.fillStyle = "#141414";
  ctx.font = "72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(token, 180, 70);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.93));
  const b64 = arrayBufferToBase64(await jpeg.arrayBuffer());
  try {
    const content = await chatComplete(
      settings,
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Read the 4 characters in the image. Reply with only those characters. If you cannot see an image, reply NOIMG." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64 } },
          ],
        },
      ],
      60,
      signal,
    );
    const compact = String(content || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (token && compact.includes(token)) return { ok: true, code: "vision_ok" };
    if (compact === "NOIMG") return { ok: false, code: "no_vision" };
    if (!String(content || "").trim()) return { ok: false, code: "no_content" };
    return { ok: false, code: "vision_mismatch" };
  } catch (err) {
    return { ok: false, code: err.code || classifyChatError(err, err.status) };
  }
}

function parseJsonBody(buf) {
  if (!buf || !buf.byteLength) return {};
  try {
    const data = JSON.parse(new TextDecoder().decode(buf));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return null;
  }
}

function routePath(url) {
  const path = decodeURIComponent(url.pathname);
  const prefix = location.pathname.replace(/\/index\.html$/i, "").replace(/\/$/, "");
  if (prefix && path.startsWith(prefix + "/")) return path.slice(prefix.length);
  return path;
}

function shouldHandle(path) {
  return (
    path === "/copy.json" ||
    path === "/文案.json" ||
    path.startsWith("/api/") ||
    path.startsWith("/media/") ||
    path.startsWith("/thumbs/") ||
    path.startsWith("/fonts/")
  );
}

async function handle(url, req) {
  const path = routePath(url);
  const method = (req.method || "GET").toUpperCase();
  const signal = req.signal;

  if (path === "/copy.json" || path === "/文案.json") {
    const target = new URL("copy.json", document.baseURI);
    if (url.href === target.href) return nativeFetch(target.href);
    return nativeFetch(target.href);
  }

  if (method === "GET" && path.startsWith("/media/")) {
    const name = safeName(path.slice("/media/".length));
    const page = await storeGet("pages", name);
    if (!page || !page.blob) return textRes("not found");
    return blobRes(page.blob, page.blob.type || "image/png");
  }
  if (method === "GET" && path.startsWith("/thumbs/")) {
    const stem = stemOf(safeName(path.slice("/thumbs/".length)));
    const pages = await storeAll("pages");
    const page = pages.find((p) => stemOf(p.name) === stem);
    if (!page) return textRes("not found");
    if (!page.thumb) {
      try {
        page.thumb = await makeThumb(page.blob);
        await storeSet("pages", page.name, page);
      } catch {
        return textRes("not found");
      }
    }
    return blobRes(page.thumb, "image/jpeg");
  }
  if (method === "GET" && path.startsWith("/fonts/")) {
    const name = safeName(path.slice("/fonts/".length));
    const font = await storeGet("fonts", name);
    if (!font || !font.blob) return textRes("not found");
    return blobRes(font.blob, font.blob.type || "font/ttf");
  }
  if (method === "GET" && path.startsWith("/api/erase/")) {
    const stem = stemOf(safeName(path.slice("/api/erase/".length)));
    const blob = await storeGet("erase", stem);
    if (!blob) return textRes("not found");
    return blobRes(blob, "image/png");
  }
  if (method === "GET" && path === "/api/workspace") return jsonRes(await currentWorkspace());
  if (method === "GET" && path === "/api/pages") return jsonRes(await pagesPayload());
  if (method === "GET" && path === "/api/fonts") return jsonRes(await fontCatalog());
  if (method === "GET" && path === "/api/project") {
    const project = (await metaGet("project")) || {};
    return jsonRes(project && typeof project === "object" ? project : {});
  }
  if (method === "GET" && path === "/api/settings") {
    return jsonRes({ ok: true, settings: publicSettings(await loadSettings()) });
  }

  if (method === "POST" && (path === "/api/workspace/open" || path === "/api/workspace/new")) {
    if (path.endsWith("/new")) return jsonRes(await createWorkspace());
    const files = await pickDirectoryFiles();
    if (!files) return jsonRes({ ok: false, cancelled: true });
    try {
      return jsonRes(await importFolder(files));
    } catch (err) {
      return jsonRes({ ok: false, error: String(err.message || err) }, 400);
    }
  }

  const body = req.bodyBuf;
  if (method === "POST" && path === "/api/project") {
    if (!needProject(await currentWorkspace())) return jsonRes({ ok: false, error: "請先開啟或新建專案" }, 400);
    const data = parseJsonBody(body);
    if (data == null) return jsonRes({ ok: false, error: "JSON 無法解析" }, 400);
    await metaSet("project", data);
    return jsonRes({ ok: true });
  }
  if (method === "POST" && path.startsWith("/api/erase/")) {
    if (!needProject(await currentWorkspace())) return jsonRes({ ok: false, error: "請先開啟或新建專案" }, 400);
    const stem = stemOf(safeName(path.slice("/api/erase/".length)));
    await storeSet("erase", stem, new Blob([body], { type: "image/png" }));
    return jsonRes({ ok: true });
  }
  if (method === "POST" && path.startsWith("/api/export/")) {
    const name = stemOf(safeName(path.slice("/api/export/".length))) + ".png";
    downloadBlob(new Blob([body], { type: "image/png" }), name);
    return jsonRes({ ok: true, path: name });
  }
  if (method === "POST" && path === "/api/fonts/label") {
    const data = parseJsonBody(body);
    if (data == null) return jsonRes({ ok: false, error: "JSON 無法解析" }, 400);
    const filename = safeName(String(data.file || ""));
    const label = String(data.label || "").trim();
    if (!label) return jsonRes({ ok: false, error: "請輸入字體名稱" }, 400);
    const item = await storeGet("fonts", filename);
    if (!item) return jsonRes({ ok: false, error: "找不到字體" }, 404);
    item.label = label.slice(0, 40);
    await storeSet("fonts", filename, item);
    return jsonRes({ ok: true, font: item, ...(await fontCatalog()) });
  }
  if (method === "POST" && path === "/api/fonts") {
    if (!body || !body.byteLength) return jsonRes({ ok: false, error: "沒有檔案" }, 400);
    let filename;
    try {
      filename = uniqueName(decodeURIComponent(req.headers.get("X-Filename") || "font.ttf"), new Set(await storeKeys("fonts")), FONT_EXT);
    } catch (err) {
      return jsonRes({ ok: false, error: String(err.message || err) }, 400);
    }
    const blob = new Blob([body]);
    const family = stemOf(filename);
    const item = { file: filename, family, label: family, weight: 400, weightLabel: "", blob };
    await storeSet("fonts", filename, item);
    return jsonRes({ ok: true, name: filename, font: { ...item, blob: undefined, builtin: false, url: objectUrl("font:" + filename, blob) }, ...(await fontCatalog()) });
  }
  if (method === "POST" && path === "/api/pages") {
    if (!needProject(await currentWorkspace())) return jsonRes({ ok: false, error: "請先開啟或新建專案" }, 400);
    if (!body || !body.byteLength) return jsonRes({ ok: false, error: "沒有檔案" }, 400);
    let filename;
    try {
      filename = uniqueName(decodeURIComponent(req.headers.get("X-Filename") || "page.png"), new Set(await storeKeys("pages")), IMAGE_EXT);
    } catch (err) {
      return jsonRes({ ok: false, error: String(err.message || err) }, 400);
    }
    const blob = new Blob([body]);
    let thumb = null;
    try {
      thumb = await makeThumb(blob);
    } catch {
      thumb = null;
    }
    await storeSet("pages", filename, { name: filename, blob, thumb, size: blob.size });
    const payload = await pagesPayload();
    payload.ok = true;
    payload.name = filename;
    return jsonRes(payload);
  }
  if (method === "POST" && path === "/api/settings") {
    const data = parseJsonBody(body);
    if (data == null) return jsonRes({ ok: false, error: "JSON 無法解析" }, 400);
    const settings = await mergeSettings(data.settings && typeof data.settings === "object" ? data.settings : data);
    return jsonRes({ ok: true, settings: publicSettings(settings) });
  }
  if (method === "POST" && (path === "/api/auto/test" || path === "/api/auto/test-vision" || path === "/api/auto/recognize" || path === "/api/auto/translate")) {
    const data = parseJsonBody(body);
    if (data == null) return jsonRes({ ok: false, error: "JSON 無法解析" }, 400);
    const settings = await mergeSettings(data.settings && typeof data.settings === "object" ? data.settings : {});
    try {
      if (path === "/api/auto/test") return jsonRes(await testConnection(settings, signal));
      if (path === "/api/auto/test-vision") return jsonRes(await testVision(settings, signal));
      if (!needProject(await currentWorkspace())) return jsonRes({ ok: false, error: "請先開啟或新建專案" }, 400);
      if (path === "/api/auto/recognize") {
        return jsonRes(await recognizePage(safeName(String(data.pageName || "")), settings, data.includeSfx, signal));
      }
      return jsonRes(await translateItems(data, settings, signal));
    } catch (err) {
      if (err && (err.name === "AbortError" || err.code === 20)) throw err;
      return jsonRes({ ok: false, error: String(err.message || err), code: err.code || classifyChatError(err, err.status) }, 400);
    }
  }

  if (method === "DELETE" && path.startsWith("/api/erase/")) {
    await storeDel("erase", stemOf(safeName(path.slice("/api/erase/".length))));
    return jsonRes({ ok: true });
  }
  if (method === "DELETE" && path.startsWith("/api/fonts/")) {
    const name = safeName(path.slice("/api/fonts/".length));
    if (!FONT_EXT.has(extOf(name))) return jsonRes({ ok: false, error: "不是字體檔" }, 400);
    await storeDel("fonts", name);
    const payload = await fontCatalog();
    payload.ok = true;
    payload.name = name;
    return jsonRes(payload);
  }
  if (method === "DELETE" && path.startsWith("/api/pages/")) {
    if (!needProject(await currentWorkspace())) return jsonRes({ ok: false, error: "請先開啟或新建專案" }, 400);
    const name = safeName(path.slice("/api/pages/".length));
    if (!IMAGE_EXT.has(extOf(name))) return jsonRes({ ok: false, error: "不是圖片" }, 400);
    await storeDel("pages", name);
    await storeDel("erase", stemOf(name));
    const payload = await pagesPayload();
    payload.ok = true;
    payload.name = name;
    return jsonRes(payload);
  }
  return null;
}

async function detectWebMode() {
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return false;
  if (host.endsWith("github.io") || location.protocol === "https:") return true;
  try {
    const res = await nativeFetch("/api/workspace");
    return !res.ok;
  } catch {
    return true;
  }
}

export async function installWebBackend() {
  WEB_MODE = await detectWebMode();
  if (!WEB_MODE) return;
  injectWebFonts();
  await openDb();
  await ensureWorkspace();
  window.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url, location.href);
    if (url.origin !== location.origin) return nativeFetch(input, init);
    const path = routePath(url);
    if (!shouldHandle(path) && !shouldHandle(url.pathname)) return nativeFetch(input, init);
    const method = req.method.toUpperCase();
    const wrapped = {
      method,
      headers: req.headers,
      signal: req.signal,
      bodyBuf: method === "GET" || method === "HEAD" ? null : await req.arrayBuffer(),
    };
    try {
      const res = await handle(url, wrapped);
      if (res) return res;
    } catch (err) {
      if (err && (err.name === "AbortError" || err.code === 20)) throw err;
      return jsonRes({ ok: false, error: String(err.message || err) }, 400);
    }
    return nativeFetch(input, init);
  };
}
