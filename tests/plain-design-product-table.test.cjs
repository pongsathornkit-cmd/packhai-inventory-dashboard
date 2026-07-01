const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function functionBlock(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
  assert.ok(start >= 0, `${functionName} was not found`);
  assert.ok(end > start, `${nextFunctionName} was not found after ${functionName}`);
  return source.slice(start, end);
}

function blockUntil(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return source.slice(start, end);
}

test("product list places SKU under the product name instead of a separate SKU column", () => {
  const source = readRepoFile("src/plain-design.js");
  const headerBlock = functionBlock(source, "renderProductTableHead", "filteredProducts");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");

  assert.doesNotMatch(headerBlock, /<th>SKU<\/th>/);
  assert.match(tableBlock, /class="table-product-sku"/);
  assert.match(tableBlock, /SKU\s+\$\{escapeHtml\(product\.sku\)\}/);
  assert.doesNotMatch(tableBlock, /<td><strong class="sku-code">/);
  assert.match(tableBlock, /colspan="12"/);
});

test("product list shows editable product cost, shipping cost, and profit columns", () => {
  const source = readRepoFile("src/plain-design.js");
  const headerBlock = functionBlock(source, "renderProductTableHead", "filteredProducts");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(headerBlock, />ต้นทุนสินค้า</);
  assert.match(headerBlock, />ต้นทุนขนส่ง</);
  assert.match(headerBlock, />กำไร</);
  assert.match(tableBlock, /class="table-cost-input"/);
  assert.match(tableBlock, /data-table-usd=/);
  assert.match(tableBlock, /data-table-cell="shippingUnit"/);
  assert.match(tableBlock, /data-table-cell="profitUnit"/);
  assert.match(tableBlock, /colspan="12"/);
  assert.match(eventsBlock, /event\.target\.closest\("\[data-table-usd\]"\)/);
  assert.match(eventsBlock, /queueProductCommercialSave\(.*\.dataset\.tableUsd/);
});
