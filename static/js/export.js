// --- 匯出 ---
import { state, ui, pageEntry, pageMediaUrl } from "./store.js";
import { ensureFontsForTexts } from "./pages.js";
import { paintTextEl } from "./text.js";
import { colorWithAlpha } from "./color.js";
import { tokenizeText, toTcyText, charStyleAt, rangeForOffsets } from "./glyphs.js";

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

function drawStyledText(ctx, style, text, sideways, boxW, boxH) {
  ctx.font = `${style.fontWeight} ${style.fontSize}px "${style.font}"`;
  ctx.fillStyle = colorWithAlpha(style.color, style.opacity);
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = Math.max(0.01, (style.strokeWidth || 0) * 2);
  const tw = ctx.measureText(text).width || 1;
  const fitW = boxW > 0 ? boxW / tw : 1;
  const fitH = boxH > 0 ? boxH / style.fontSize : 1;
  const fit = Math.min(1, fitW, fitH);
  ctx.save();
  if (sideways) ctx.rotate(Math.PI / 2);
  if (fit < 1) ctx.scale(fit, fit);
  if (style.strokeWidth > 0) ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawGlyphsFromBox(ctx, t, el, origin, scaleX, scaleY) {
  const inner = el.querySelector(".inner");
  if (!inner || !t.text) return;
  ctx.save();
  ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.translate(-(t.x + t.w / 2), -(t.y + t.h / 2));
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const tok of tokenizeText(t.text, t.vertical)) {
    if (tok.text === "\n" || tok.text === "\r") continue;
    let r;
    try {
      r = rangeForOffsets(inner, tok.start, tok.end).getBoundingClientRect();
    } catch {
      continue;
    }
    if (r.width <= 0 && r.height <= 0) continue;
    const x = (r.left - origin.left + r.width / 2) * scaleX;
    const y = (r.top - origin.top + r.height / 2) * scaleY;
    const style = charStyleAt(t, tok.start);
    const sideways = t.vertical && tok.sideways;
    ctx.save();
    ctx.translate(x, y);
    drawStyledText(ctx, style, tok.combine ? toTcyText(tok.text) : tok.text, sideways, r.width * scaleX, r.height * scaleY);
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
