import { strict as assert } from "node:assert";
import { dialogueVisible, parseBulk, parsePageMark } from "../static/js/dialogue-util.js";

function used(...ids) {
  return new Set(ids);
}

{
  const d = { id: "a" };
  assert.equal(dialogueVisible(d, used(), "all"), true);
  assert.equal(dialogueVisible(d, used(), "used"), false);
  assert.equal(dialogueVisible(d, used(), "unused"), true);
  assert.equal(dialogueVisible(d, used("a"), "used"), true);
  assert.equal(dialogueVisible(d, used("a"), "unused"), false);
}

{
  assert.deepEqual(parsePageMark("你好"), { pageNum: null, rest: "你好" });
  assert.deepEqual(parsePageMark("【3】"), { pageNum: "3", rest: "" });
  assert.deepEqual(parsePageMark("【 12 】\n第一句"), { pageNum: "12", rest: "第一句" });
}

{
  const pages = { 1: "001.png", 2: "002.png" };
  const rows = parseBulk("【1】\nこんにちは\n\n【2】\nこんばんは", true, false, {
    uid: () => "d1",
    resolvePage: (n) => pages[n] || "",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "こんにちは");
  assert.equal(rows[0].pageName, "001.png");
  assert.equal(rows[1].text, "こんばんは");
  assert.equal(rows[1].pageName, "002.png");
}

{
  const rows = parseBulk("原文 | 譯文\nfoo\tbar", false, true, { uid: () => "x" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].src, "原文");
  assert.equal(rows[0].text, "譯文");
  assert.equal(rows[1].src, "foo");
  assert.equal(rows[1].text, "bar");
}

{
  assert.deepEqual(parseBulk("   ", true, false), []);
}

console.log("dialogue-util ok");
