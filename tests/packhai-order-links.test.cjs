const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(projectRoot, "src", "styles.css"), "utf8");

test("stock movement history renders Packhai order numbers as clickable order-detail links", () => {
  assert.match(appSource, /function packhaiOrderUrl\(referenceNo\)/);
  assert.match(appSource, /shop\.packhai\.com\/order\/order-detail\?id=/);
  assert.match(appSource, /function movementOrderRefs\(movement\)/);
  assert.match(appSource, /class="movement-order-link packhai-order-link"/);
  assert.match(appSource, /href="\$\{escapeHtml\(packhaiOrderUrl\(movement\.referenceNo\)\)\}"/);
  assert.match(appSource, /target="_blank" rel="noreferrer"/);
  assert.match(cssSource, /\.movement-history-table td a\.movement-order-link/);
});
