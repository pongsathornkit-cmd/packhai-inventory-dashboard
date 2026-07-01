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
