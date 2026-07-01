const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("purchase order USD cost column is editable and wired to product saving", () => {
  const source = readRepoFile("src/plain-design.js");

  assert.match(source, /data-po-usd=/);
  assert.match(source, /class="po-usd-input"/);
  assert.match(source, /updateLocalProduct\(\w+\.dataset\.poUsd/);
  assert.match(source, /queueProductCommercialSave\(\w+\.dataset\.poUsd/);
  assert.match(source, /updateProduct\(\w+\.dataset\.poUsd/);
});
