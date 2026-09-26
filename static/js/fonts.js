// --- 字體庫 ---
import { $, ui, importedFontList } from "./store.js";
import { t, toastT, confirmT } from "./copy.js";
import { apiGet } from "./api.js";
import {
  registerImportedFonts,
  ensureFontLoaded,
  unloadFont,
  familyOfFontFile,
  fontGroupOf,
  fontDisplayLabel,
  groupedImportedFonts,
  uniqueFontFamilies,
} from "./pages.js";

let fontPreviewObserver = null;

function applyFontCatalog(list) {
  const prev = new Set(importedFontList.filter((f) => !f.builtin).map((f) => f.family));
  const incoming = Array.isArray(list) ? list : [];
  const keepBuiltin = importedFontList.filter((f) => f.builtin);
  const next = incoming.some((item) => item?.builtin) ? incoming : [...keepBuiltin, ...incoming];
  registerImportedFonts(next);
  for (const family of prev) {
    if (!importedFontList.some((f) => f.family === family)) unloadFont(family);
  }
}

async function refreshFontCatalog(list) {
  if (list) applyFontCatalog(list);
  else {
    const res = await apiGet("/api/fonts");
    const data = await res.json();
    applyFontCatalog(data.fonts || []);
  }
  renderFontLibrary();
}

function fontSearchQuery() {
  return String(ui.fontSearch?.value || "").trim().toLowerCase();
}

function fontMatchesQuery(font, group, q) {
  if (!q) return true;
  return [font.label, font.family, font.file, group, font.weightLabel, fontDisplayLabel(font)]
    .some((part) => String(part || "").toLowerCase().includes(q));
}

function observeFontPreview(el, family, weight) {
  if (!fontPreviewObserver) {
    fontPreviewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fam = entry.target.dataset.family;
        if (!fam) continue;
        ensureFontLoaded(fam, entry.target.dataset.weight).then(() => {
          entry.target.style.fontFamily = `"${fam}"`;
          if (entry.target.dataset.weight) entry.target.style.fontWeight = entry.target.dataset.weight;
        });
        fontPreviewObserver.unobserve(entry.target);
      }
    }, { root: ui.fontDrop || null, rootMargin: "120px" });
  }
  el.dataset.family = family;
  if (weight) el.dataset.weight = String(weight);
  fontPreviewObserver.observe(el);
}

function appendFontRow(parent, font, { locked } = {}) {
  const row = document.createElement("div");
  row.className = "font-row" + (locked ? " is-builtin" : "");
  row.dataset.file = font.file;
  const preview = document.createElement("div");
  preview.className = "font-preview";
  preview.textContent = t("font.sample");
  observeFontPreview(preview, font.family, font.weight);
  const meta = document.createElement("div");
  meta.className = "font-meta";
  if (locked) {
    const name = document.createElement("div");
    name.className = "font-name-lock";
    const faces = importedFontList.filter((item) => item.family === font.family);
    name.textContent = faces.length > 1 ? (font.weightLabel || fontDisplayLabel(font)) : fontDisplayLabel(font);
    const mark = document.createElement("span");
    mark.className = "font-file";
    mark.textContent = t("font.builtin");
    meta.append(name, mark);
    const spacer = document.createElement("button");
    spacer.type = "button";
    spacer.className = "ghost compact font-row-action";
    spacer.textContent = t("ui.glossaryDel");
    spacer.tabIndex = -1;
    spacer.disabled = true;
    spacer.setAttribute("aria-hidden", "true");
    row.append(preview, meta, spacer);
  } else {
    const name = document.createElement("input");
    name.type = "text";
    name.className = "font-name";
    name.value = font.label && font.label !== font.family ? font.label : fontDisplayLabel(font);
    name.maxLength = 40;
    name.spellcheck = false;
    name.addEventListener("change", () => renameImportedFont(font.file, name.value));
    const file = document.createElement("span");
    file.className = "font-file";
    file.textContent = font.file;
    meta.append(name, file);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost compact danger font-row-action";
    del.textContent = t("ui.glossaryDel");
    del.addEventListener("click", () => deleteImportedFont(font));
    row.append(preview, meta, del);
  }
  parent.appendChild(row);
}

function filteredGroups(list, q) {
  return groupedImportedFonts()
    .map(([group, fonts]) => [
      group,
      fonts.filter((font) => list.includes(font) && fontMatchesQuery(font, group, q)),
    ])
    .filter(([, fonts]) => fonts.length);
}

function renderFontLibrary() {
  const list = ui.fontList;
  if (!list) return;
  if (fontPreviewObserver) fontPreviewObserver.disconnect();
  fontPreviewObserver = null;
  list.replaceChildren();
  const q = fontSearchQuery();
  const builtin = importedFontList.filter((f) => f.builtin);
  const custom = importedFontList.filter((f) => !f.builtin);
  const builtinGroups = filteredGroups(builtin, q);
  const customGroups = filteredGroups(custom, q);
  if (ui.fontCount) {
    const n = uniqueFontFamilies(importedFontList).length;
    ui.fontCount.textContent = n ? String(n) : "";
  }
  if (!builtin.length && !custom.length) {
    const empty = document.createElement("div");
    empty.className = "font-empty";
    empty.textContent = t("font.empty");
    list.appendChild(empty);
    return;
  }
  if (!builtinGroups.length && !customGroups.length) {
    const empty = document.createElement("div");
    empty.className = "font-empty";
    empty.textContent = t("font.noMatch");
    list.appendChild(empty);
    return;
  }
  const renderGroups = (groups, locked) => {
    for (const [group, fonts] of groups) {
      const box = document.createElement("section");
      box.className = "font-group";
      if (fonts.length > 1 || fontGroupOf(fonts[0]).weight) {
        const head = document.createElement("div");
        head.className = "font-group-head";
        head.textContent = group;
        box.appendChild(head);
      }
      for (const font of fonts) appendFontRow(box, font, { locked });
      list.appendChild(box);
    }
  };
  renderGroups(builtinGroups, true);
  renderGroups(customGroups, false);
}

async function importFontFiles(files) {
  const picked = [...files].filter((file) => /\.(ttf|otf|woff2?|ttc)$/i.test(file.name));
  if (!picked.length) {
    toastT("fontNone");
    return;
  }
  const imported = [];
  let fonts = null;
  try {
    for (const file of picked) {
      const res = await fetch("/api/fonts", {
        method: "POST",
        headers: { "X-Filename": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || file.name);
      imported.push(data.font || { file: data.name || file.name, family: familyOfFontFile(data.name || file.name) });
      if (data.fonts) fonts = data.fonts;
    }
    await refreshFontCatalog(fonts);
    toastT(imported.length === 1 ? "fontOk" : "fontOkMany", { n: imported.length, name: imported[0]?.label || imported[0]?.family });
  } catch (err) {
    toastT("fontFail", { msg: err.message || err });
    await refreshFontCatalog();
  }
}

async function renameImportedFont(file, label) {
  const next = String(label || "").trim();
  const current = importedFontList.find((f) => f.file === file);
  if (!current || current.builtin || !next || next === current.label || next === fontDisplayLabel(current)) {
    renderFontLibrary();
    return;
  }
  try {
    const res = await fetch("/api/fonts/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, label: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || file);
    applyFontCatalog(data.fonts || []);
    renderFontLibrary();
    toastT("fontRenamed", { name: next });
  } catch (err) {
    toastT("fontFail", { msg: err.message || err });
    renderFontLibrary();
  }
}

async function deleteImportedFont(font) {
  if (font.builtin) return;
  if (!confirmT("confirm.deleteFont", { name: font.label || fontDisplayLabel(font) })) return;
  try {
    const res = await fetch("/api/fonts/" + encodeURIComponent(font.file), { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || font.file);
    await refreshFontCatalog(data.fonts || []);
    toastT("fontDeleted", { name: font.label || fontDisplayLabel(font) });
  } catch (err) {
    toastT("deleteFail", { msg: err.message || err });
  }
}

function openFontModal() {
  if (!ui.fontModal) return;
  ui.fontModal.hidden = false;
  if (ui.fontSearch) ui.fontSearch.value = "";
  renderFontLibrary();
}

function bindFontLibrary() {
  $("#btn-fonts")?.addEventListener("click", openFontModal);
  $("#btn-fonts-panel")?.addEventListener("click", openFontModal);
  $("#btn-fonts-close")?.addEventListener("click", () => {
    if (ui.fontModal) ui.fontModal.hidden = true;
  });
  $("#btn-fonts-import")?.addEventListener("click", () => ui.fontFile?.click());
  ui.fontSearch?.addEventListener("input", renderFontLibrary);
  ui.fontFile?.addEventListener("change", async () => {
    const files = [...(ui.fontFile.files || [])];
    ui.fontFile.value = "";
    if (files.length) await importFontFiles(files);
  });
  const drop = ui.fontDrop;
  if (!drop) return;
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("on");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("on"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("on");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) await importFontFiles(files);
  });
}

export {
  applyFontCatalog,
  refreshFontCatalog,
  renderFontLibrary,
  openFontModal,
  bindFontLibrary,
};
