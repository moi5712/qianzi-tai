// --- 匯出 ---
import { state, ui, pageEntry, pageMediaUrl } from "./store.js";
import { ensureFontsForTexts } from "./fontload.js";
import { colorWithAlpha } from "./color.js";
import { layoutGlyphs } from "./boxgeom.js";

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

function drawGlyphs(ctx, t, glyphs) {
  if (!glyphs.length) return;
  ctx.save();
  ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
  ctx.rotate(((t.rotation || 0) * Math.PI) / 180);
  ctx.translate(-(t.x + t.w / 2), -(t.y + t.h / 2));
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(t.x + g.x, t.y + g.y);
    drawStyledText(ctx, { ...t, ...g.style }, g.text, g.sideways, g.w, g.h);
    ctx.restore();
  }
  ctx.restore();
}

function drawTexts(ctx, texts) {
  for (const t of texts || []) {
    if (!t?.text) continue;
    drawGlyphs(ctx, t, layoutGlyphs(t));
  }
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
  drawTexts(ctx, texts);
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

export { exportPage };
