const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
const buildSource = fs.readFileSync(path.join(projectRoot, "scripts", "build-dashboard.cjs"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "product_name_overrides.json"), "utf8"));

test("dashboard build applies SKU product-name overrides before publishing rows", () => {
  assert.match(buildSource, /product_name_overrides\.json/);
  assert.match(buildSource, /buildProductNameOverrideMap/);
  assert.match(buildSource, /buildStockProductNameCandidates/);
  assert.match(buildSource, /productDisplayNameForRow\(item, selected, nameCandidatesBySku\)/);
  assert.match(buildSource, /productNameOverrides: Object\.fromEntries\(productNameOverrides\)/);
});

test("frontend uses source-aware product names for Website Stock and grouped SKU rows", () => {
  assert.match(appSource, /function bestProductNameForRows/);
  assert.match(appSource, /row\.name = bestProductNameForRows/);
  assert.match(appSource, /name: bestProductNameForRows\(warehouseRows/);
  assert.match(appSource, /productNameCandidateScore\(b, b\?\.name, "name"\)/);
  assert.match(appSource, /productNameOverrideForSku/);
});

test("known mismatched SKUs have explicit corrected names", () => {
  assert.match(overrides["HAITUN-PC10"].name, /^Haitun/);
  assert.match(overrides["15901_BLUE"].name, /^Haitun/);
  assert.match(overrides["P231-0070"].name, /^POLO SHT-30/);
  assert.match(overrides["P231-0075"].name, /^POLO SHT-40/);
});
