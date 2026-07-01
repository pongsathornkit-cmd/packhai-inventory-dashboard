const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function blockUntil(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return source.slice(start, end);
}

test("purchase order USD cost column is editable and wired to product saving", () => {
  const source = readRepoFile("src/plain-design.js");

  assert.match(source, /data-po-usd=/);
  assert.match(source, /class="po-usd-input"/);
  assert.match(source, /updateLocalProduct\(\w+\.dataset\.poUsd/);
  assert.match(source, /queueProductCommercialSave\(\w+\.dataset\.poUsd/);
  assert.match(source, /updateProduct\(\w+\.dataset\.poUsd/);
});

test("purchase order system can delete a bill and keep another bill active", () => {
  const source = readRepoFile("src/plain-design.js");
  const renderBlock = blockUntil(source, "function renderPoPanel() {", "function bindPoEvents");
  const eventsBlock = blockUntil(source, "function bindPoEvents", "async function applyBulkRedesignStatus");

  assert.match(source, /function deletePurchaseOrder/);
  assert.match(source, /state\.purchaseOrders\.filter\(\(order\) => order\.id !== id\)/);
  assert.match(source, /activePurchaseOrder\(\)\s*\|\|\s*state\.purchaseOrders\[0\]/);
  assert.match(source, /persistPurchaseOrders\(\)/);
  assert.match(renderBlock, /id="deletePurchaseOrder"/);
  assert.match(renderBlock, /data-delete-purchase-order=/);
  assert.match(eventsBlock, /deletePurchaseOrder\(/);
});
