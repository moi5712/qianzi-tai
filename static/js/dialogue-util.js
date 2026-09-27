// --- 對白純邏輯：可在 Node 測試 ---

export function dialogueVisible(d, used, filter) {
  const isUsed = used.has(d.id);
  if (filter === "used" && !isUsed) return false;
  if (filter === "unused" && isUsed) return false;
  return true;
}

export function parsePageMark(text) {
  const raw = String(text || "").trim();
  const mark = /^【\s*(\d+)\s*】$/;
  const full = raw.match(mark);
  if (full) return { pageNum: full[1], rest: "" };
  const lines = raw.split("\n");
  const first = (lines[0] || "").trim();
  const head = first.match(mark);
  if (!head) return { pageNum: null, rest: raw };
  return { pageNum: head[1], rest: lines.slice(1).join("\n").trim() };
}

export function parseBulk(raw, blank, bilingual, { uid, resolvePage } = {}) {
  const makeId = typeof uid === "function" ? uid : (() => "d0");
  const pageOf = typeof resolvePage === "function" ? resolvePage : () => "";
  const text = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];
  const chunks = blank
    ? text.split(/\n[ \t]*\n+/).map((s) => s.trim()).filter(Boolean)
    : text.split("\n").map((s) => s.trim()).filter(Boolean);
  let currentPage = "";
  const rows = [];
  for (const chunk of chunks) {
    const { pageNum, rest } = parsePageMark(chunk);
    if (pageNum !== null) currentPage = pageOf(pageNum) || "";
    if (!rest) continue;
    if (!bilingual) {
      rows.push({ id: makeId("d"), text: rest, src: "", pageName: currentPage });
      continue;
    }
    const parts = rest.split(/\t+| *\| */);
    rows.push({
      id: makeId("d"),
      src: (parts[0] || "").trim(),
      text: (parts[1] || parts[0] || "").trim(),
      pageName: currentPage,
    });
  }
  return rows;
}
