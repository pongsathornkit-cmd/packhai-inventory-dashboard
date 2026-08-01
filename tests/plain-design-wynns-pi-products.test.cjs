const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { buildPlainDesignInitialState } = require("../scripts/plain-design-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const piSourcePath = path.join(projectRoot, "data", "wynns_pi_20260731.json");
const seedPath = path.join(projectRoot, "data", "plain_design_products.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function sum(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

test("Wynn's PI source reconciles all item and invoice totals", () => {
  assert.equal(fs.existsSync(piSourcePath), true, "PI source snapshot must exist");

  const pi = readJson(piSourcePath);
  assert.equal(pi.supplier, "Wynn's tools");
  assert.equal(pi.customer, "Pongsathorn CHAISANGUANJIRAKUL");
  assert.equal(pi.documentDate, "2026-07-31");
  assert.equal(pi.items.length, 97);
  assert.equal(new Set(pi.items.map((item) => item.sku)).size, 97);
  assert.equal(sum(pi.items, "quantity"), 6957);
  assert.equal(money(sum(pi.items, "amountRmb")), 83750.41);
  assert.equal(money(sum(pi.items, "amountUsd")), 12425.91);
  assert.equal(pi.shippingFeeRmb, null);
  assert.equal(pi.shippingFeeUsd, null);
});

test("Plain Design seed contains every Wynn's PI product without replacing P525 products", () => {
  const seed = readJson(seedPath);
  const imported = seed.products.filter((product) => product.sourceDocument === "PI 20260731");

  assert.equal(seed.products.filter((product) => product.sku.startsWith("P525-")).length, 23);
  assert.equal(imported.length, 97);
  assert.equal(new Set(imported.map((product) => product.sku)).size, 97);
  assert.deepEqual(
    seed.categoryOptions.find((category) => category.id === "wynns_tools"),
    { id: "wynns_tools", label: "Wynn's Tools" }
  );

  const w0586 = imported.find((product) => product.sku === "W0586");
  assert.equal(w0586.name, "Industrial grade high-grade Butter Gun 600CC");
  assert.equal(w0586.category, "wynns_tools");
  assert.equal(w0586.orderQuantity, 20);
  assert.equal(w0586.purchaseUnitCostUsd, 5.422);
  assert.equal(w0586.purchaseUnitCostRmb, 36.546);
  assert.equal(w0586.supplierAmountUsd, 108.44);
  assert.equal(w0586.supplierAmountRmb, 730.92);
  assert.equal(w0586.unitsPerCarton, 10);
});

test("Plain Design runtime preserves Wynn's supplier costing metadata", () => {
  const seed = readJson(seedPath);
  const state = buildPlainDesignInitialState({
    seed,
    dashboard: { rows: [] },
    ktwLogistics: { items: [] },
  });
  const product = state.products.find((item) => item.sku === "W0586");

  assert.ok(product, "W0586 must be loaded into runtime state");
  assert.equal(product.sourceDocument, "PI 20260731");
  assert.equal(product.unitsPerCarton, 10);
  assert.equal(product.purchaseUnitCostRmb, 36.546);
  assert.equal(product.supplierAmountRmb, 730.92);
  assert.equal(product.supplierAmountUsd, 108.44);
});
