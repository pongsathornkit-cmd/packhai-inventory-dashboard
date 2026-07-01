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

test("product list keeps the cost, shipping, and profit columns near the visible left side", () => {
  const css = readRepoFile("src/plain-design.css");

  assert.match(css, /\.product-table\s*\{\s*min-width:\s*920px;/);
  assert.match(css, /\.product-table th,\s*\.po-table th\s*\{[\s\S]*?padding:\s*0 6px;/);
  assert.match(css, /\.product-table td,\s*\.po-table td\s*\{[\s\S]*?padding:\s*7px 6px;/);
  assert.match(css, /\.product-table th:nth-child\(3\),\s*\.product-table td:nth-child\(3\)\s*\{\s*width:\s*150px;/);
  assert.match(css, /\.table-product-name\s*\{[\s\S]*?max-width:\s*145px;/);
  assert.match(css, /\.table-cost-input\s*\{[\s\S]*?width:\s*72px;/);
});

test("product list supports bulk redesign status updates from selected rows", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const headerBlock = functionBlock(source, "renderProductTableHead", "trackerCostInputValue");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="bulkStatusBar"/);
  assert.match(source, /bulkStatusSelectedSkus:\s*new Set\(\)/);
  assert.match(headerBlock, /data-bulk-status-toggle-all/);
  assert.match(tableBlock, /data-bulk-status-row=/);
  assert.match(source, /function renderBulkStatusBar/);
  assert.match(source, /data-bulk-status-select/);
  assert.match(source, /data-bulk-status-apply/);
  assert.match(source, /function applyBulkRedesignStatus/);
  assert.match(source, /Promise\.all\(\s*skus\.map/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*sku,\s*status/);
  assert.match(eventsBlock, /data-bulk-status-row/);
  assert.match(eventsBlock, /data-bulk-status-toggle-all/);
  assert.match(eventsBlock, /data-bulk-status-apply/);
});

test("product list can switch cover images between KTW Mode and Plain Mode", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="productImageModeToggle"/);
  assert.match(template, /data-product-image-mode="ktw"/);
  assert.match(template, /data-product-image-mode="plain"/);
  assert.match(source, /productImageMode:\s*localStorage\.getItem\("plainProductImageMode"\)\s*\|\|\s*"ktw"/);
  assert.match(source, /function tableCoverImageFor/);
  assert.match(source, /assetsFor\(product,\s*"product_images"\)\[0\]/);
  assert.match(source, /plainProductImageMode/);
  assert.match(tableBlock, /const coverImage\s*=\s*tableCoverImageFor\(product\)/);
  assert.match(tableBlock, /src="\$\{escapeHtml\(coverImage\.src\)\}"/);
  assert.match(tableBlock, /data-image-mode="\$\{escapeHtml\(coverImage\.mode\)\}"/);
  assert.match(eventsBlock, /data-product-image-mode/);
  assert.match(eventsBlock, /renderProductImageModeToggle/);
  assert.match(eventsBlock, /renderTrackerTable\(\)/);
});
