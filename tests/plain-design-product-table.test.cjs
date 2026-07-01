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

test("product list places SKU under the product name instead of a separate SKU column", () => {
  const source = readRepoFile("src/plain-design.js");
  const headerBlock = functionBlock(source, "renderProductTableHead", "filteredProducts");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");

  assert.doesNotMatch(headerBlock, /<th>SKU<\/th>/);
  assert.match(tableBlock, /class="table-product-sku"/);
  assert.match(tableBlock, /SKU\s+\$\{escapeHtml\(product\.sku\)\}/);
  assert.doesNotMatch(tableBlock, /<td><strong class="sku-code">/);
  assert.match(tableBlock, /colspan="9"/);
});
