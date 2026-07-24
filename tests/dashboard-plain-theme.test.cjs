const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const cssSource = fs.readFileSync(path.join(projectRoot, "src", "styles.css"), "utf8");

test("main dashboard uses the Plain Design warm theme palette", () => {
  assert.match(cssSource, /--bg:\s*#fbfaf8;/);
  assert.match(cssSource, /--surface-2:\s*#fffdfb;/);
  assert.match(cssSource, /--ink:\s*#2d2925;/);
  assert.match(cssSource, /--muted:\s*#746d65;/);
  assert.match(cssSource, /--border:\s*#e7dfd5;/);
  assert.match(cssSource, /--teal:\s*#a8896f;/);
  assert.match(cssSource, /--pink:\s*#9b7655;/);
});

test("main dashboard no longer carries the old navy and pink theme tokens", () => {
  assert.doesNotMatch(cssSource, /#232c65|#1b224f|#121735|#e91e76|#c21868|#ffdfed|#eef1ff|#edf0fb|#f6f8ff|#f8f9ff|#fff0f6/);
  assert.doesNotMatch(cssSource, /35,\s*44,\s*101|233,\s*30,\s*118|236,\s*32,\s*117|94,\s*110,\s*199|102,\s*118,\s*184/);
});

test("sidebar and table headers follow the Plain Design surface treatment", () => {
  assert.match(cssSource, /\.sidebar\s*\{[\s\S]*?color:\s*var\(--ink\);[\s\S]*?border-right:\s*1px solid var\(--border\);/);
  assert.match(cssSource, /\.sidebar-nav a\.active,\s*[\s\S]*?\.sidebar-nav a:hover\s*\{[\s\S]*?background:\s*#eee7df;/);
  assert.match(cssSource, /thead th\s*\{[\s\S]*?background:\s*var\(--blue-soft\);[\s\S]*?color:\s*var\(--ink-2\);/);
  assert.match(cssSource, /\.payment-orders-table th\s*\{[\s\S]*?background:\s*var\(--blue-soft\);[\s\S]*?color:\s*var\(--ink-2\);/);
  assert.match(cssSource, /\.movement-history-table th\s*\{[\s\S]*?background:\s*var\(--blue-soft\);[\s\S]*?color:\s*var\(--ink-2\);/);
});
