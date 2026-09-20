// --- 匯出 ---
import { state, ui, pageEntry, pageMediaUrl } from "./store.js";
import { ensureFontsForTexts } from "./pages.js";
import { paintTextEl } from "./text.js";

const SIDEWAYS_IN_VERTICAL = new Set([
  0x002d, 0x007e, 0x00ad, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
  0x2025, 0x2026, 0x2027, 0x22ee, 0x22ef, 0x2500, 0x2501, 0x2574, 0x2576,
  0x2578, 0x257a, 0x30a0, 0x30fc, 0x301c, 0x3030, 0xfe31, 0xfe32, 0xfe58,
  0xfe63, 0xff0d, 0xff5e, 0xff70,
]);
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function makeMeasureBox(t) {
  const el = document.createElement("div");
  el.className = "text-box";
  el.innerHTML = `<div class="inner"></div>`;
  paintTextEl(el, { ...t, rotation: 0 });
  return el;
}

function isSidewaysInVertical(ch) {
  const cp = ch.codePointAt(0);
  if (SIDEWAYS_IN_VERTICAL.has(cp)) return true;
  if (cp >= 0x41 && cp <= 0x5a) return true;
  if (cp >= 0x61 && cp <= 0x7a) return true;
  if (cp >= 0x21 && cp <= 0x2f) return true;
  if (cp >= 0x3a && cp <= 0x40) return true;
  if (cp >= 0x5b && cp <= 0x60) return true;
  if (cp >= 0x7b && cp <= 0x7e) return true;
  return false;
}

function drawGlyphsFromBox(ctx, t, el, origin, scaleX, scaleY) {
  const inner = el.querySelector(".inner");
  const node = inner?.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE || !t.text) return;
  ctx.save();
  ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.translate(-(t.x + t.w / 2), -(t.y + t.h / 2));
  ctx.font = `${t.fontWeight} ${t.fontSize}px "${t.font}"`;
  ctx.fillStyle = t.color;
  ctx.strokeStyle = t.strokeColor;
  ctx.lineWidth = Math.max(0.01, t.strokeWidth * 2);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  let offset = 0;
  for (const ch of t.text) {
    const start = offset;
    offset += ch.length;
    if (ch === "\n" || ch === "\r") continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, offset);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    const x = (r.left - origin.left + r.width / 2) * scaleX;
    const y = (r.top - origin.top + r.height / 2) * scaleY;
    const sideways = t.vertical && isSidewaysInVertical(ch);
    ctx.save();
    ctx.translate(x, y);
    if (sideways) ctx.rotate(Math.PI / 2);
    if (t.strokeWidth > 0) ctx.strokeText(ch, 0, 0);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

async function drawTextsFromDom(ctx, texts, imgW, imgH) {
  if (!texts.length) return;
  const layer = document.createElement("div");
  layer.style.cssText = `position:fixed;left:${-(imgW + 80)}px;top:0;width:${imgW}px;height:${imgH}px;overflow:visible;pointer-events:none;`;
  const boxes = texts.map((t) => {
    const el = makeMeasureBox(t);
    layer.appendChild(el);
    return { t, el };
  });
  document.body.appendChild(layer);
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();
  const origin = layer.getBoundingClientRect();
  const scaleX = origin.width ? imgW / origin.width : 1;
  const scaleY = origin.height ? imgH / origin.height : 1;
  for (const { t, el } of boxes) drawGlyphsFromBox(ctx, t, el, origin, scaleX, scaleY);
  layer.remove();
}

async function rasterize(pageName) {
  const img = new Image();
  img.src = pageMediaUrl(pageName);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  if (pageName === state.pageName) ctx.drawImage(ui.paint, 0, 0);
  else {
    try {
      const erase = new Image();
      const stem = pageName.replace(/\.[^.]+$/, "");
      erase.src = "/api/erase/" + encodeURIComponent(stem) + ".png?t=" + Date.now();
      await erase.decode();
      ctx.drawImage(erase, 0, 0);
    } catch {
      /* none */
    }
  }
  const texts = pageEntry(pageName).texts;
  await ensureFontsForTexts(texts);
  await document.fonts.ready;
  await drawTextsFromDom(ctx, texts, canvas.width, canvas.height);
  return canvas;
}

async function exportPage(pageName) {
  const canvas = await rasterize(pageName);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(pageName);
  const stem = pageName.replace(/\.[^.]+$/, "");
  const res = await fetch("/api/export/" + encodeURIComponent(stem + ".png"), { method: "POST", body: blob });
  if (!res.ok) throw new Error(pageName);
}

export {
  makeMeasureBox,
  exportPage,
};
