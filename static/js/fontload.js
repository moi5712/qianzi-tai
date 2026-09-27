// --- 字體載入與目錄 ---
import { ui, project, importedFontList, fontFacesByFamily, loadedFamilies } from "./store.js";
import { syncStyleFontSelect } from "./style.js";

const FONT_WEIGHT_TAIL = /[-_](thin|extralight|ultralight|extra-?light|light|book|regular|medium|semibold|semi-?bold|demibold|bold|extrabold|extra-?bold|ultrabold|heavy|black)$/i;
const loadedFaceKeys = new Set();
const fontLoadWait = new Map();

export function familyOfFontFile(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

export function fontGroupOf(font) {
  if (font?.builtin) return { group: font.family, weight: font.weightLabel || "" };
  const stem = font?.family || familyOfFontFile(font?.file);
  const m = String(stem || "").match(FONT_WEIGHT_TAIL);
  if (!m) return { group: stem, weight: "" };
  return { group: stem.slice(0, -m[0].length), weight: m[1] };
}

export function fontDisplayLabel(font) {
  if (!font) return "";
  if (font.builtin) return font.label || font.family;
  if (font.label && font.label !== font.family) return font.label;
  const { group, weight } = fontGroupOf(font);
  return weight ? group + " " + weight : (font.label || font.family);
}

export function uniqueFontFamilies(list) {
  const seen = new Set();
  const out = [];
  for (const font of list || []) {
    if (!font?.family || seen.has(font.family)) continue;
    seen.add(font.family);
    out.push(font);
  }
  return out;
}

export function groupedImportedFonts() {
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

export function fillFontSelect() {
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

export function registerImportedFonts(list) {
  importedFontList.length = 0;
  fontFacesByFamily.clear();
  for (const raw of list || []) {
    const item = normalizeFontEntry(raw);
    if (!item) continue;
    importedFontList.push(item);
    const faces = fontFacesByFamily.get(item.family) || [];
    if (!faces.some((face) => face.file === item.file)) faces.push(item);
    fontFacesByFamily.set(item.family, faces);
  }
  fillFontSelect();
}

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

export function unloadFont(family) {
  if (!family) return;
  loadedFamilies.delete(family);
  for (const key of [...loadedFaceKeys]) {
    if (key.startsWith(family + "@")) loadedFaceKeys.delete(key);
  }
  for (const face of [...document.fonts]) {
    if (face.family === family || face.family === `"${family}"`) document.fonts.delete(face);
  }
}

export async function ensureFontLoaded(family, weight) {
  if (!family) return;
  const face = nearestFontFace(family, weight);
  if (!face || !face.url) {
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

export async function ensureFontsForTexts(texts) {
  await Promise.all(collectTextFontJobs(texts));
}
