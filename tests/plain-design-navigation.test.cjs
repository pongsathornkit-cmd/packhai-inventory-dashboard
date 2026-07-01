const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("purchase order panel is not shown on the default products page", () => {
  const template = readRepoFile("src/plain-design.template.html");
  const source = readRepoFile("src/plain-design.js");

  assert.match(template, /<section class="po-panel" id="purchase-order" hidden><\/section>/);
  assert.match(source, /function syncActiveView\(\)/);
  assert.match(source, /const isPurchaseOrderView = activeHash === "#purchase-order"/);
  assert.match(source, /\$\("purchase-order"\)\.hidden = !isPurchaseOrderView/);
  assert.match(source, /\$\("products"\)\.hidden = isPurchaseOrderView/);
  assert.match(source, /\$\("plainMainGrid"\)\.hidden = isPurchaseOrderView/);
});

test("left navigation only links to products and purchase orders", () => {
  const template = readRepoFile("src/plain-design.template.html");
  const source = readRepoFile("src/plain-design.js");
  const navStart = template.indexOf('<nav class="plain-nav">');
  const navEnd = template.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0, "plain navigation was not found");
  assert.ok(navEnd > navStart, "plain navigation closing tag was not found");
  const navBlock = template.slice(navStart, navEnd);

  assert.match(navBlock, /href="#products"/);
  assert.match(navBlock, /href="#purchase-order"/);
  assert.doesNotMatch(navBlock, /href="#design"/);
  assert.doesNotMatch(navBlock, /href="#factory"/);
  assert.doesNotMatch(navBlock, /href="#summary"/);
  assert.match(source, /const navLabels = \["รายการสินค้า", "ใบสั่งซื้อ"\]/);
  assert.match(source, /function activePlainHash\(\)/);
  assert.match(source, /return hash === "#purchase-order" \? "#purchase-order" : "#products"/);
});
