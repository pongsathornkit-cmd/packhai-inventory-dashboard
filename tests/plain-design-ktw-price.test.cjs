const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { loadPlainDesignState } = require("../scripts/plain-design-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function loadSyncHelpers() {
  const file = path.join(projectRoot, "scripts", "sync-plain-design-ktw-logistics.cjs");
  const source = fs.readFileSync(file, "utf8").replace(/main\(\)\.catch\([\s\S]*?\);\s*$/, "");
  const sandbox = {
    require,
    __dirname: path.join(projectRoot, "scripts"),
    console,
    fetch,
    module: { exports: {} },
    process: { env: {}, exitCode: 0 },
  };
  vm.runInNewContext(`${source}\nmodule.exports = { parseKtwSourcePrice };`, sandbox, { filename: file });
  return sandbox.module.exports;
}

test("KTW price parser prefers the visible discounted website price", () => {
  const { parseKtwSourcePrice } = loadSyncHelpers();
  const html = `
    <script>
      dataLayer.push({
        ecommerce: { items: [{ "item_id": "P525-1310", "price": 203.36 }] }
      });
    </script>
    <aside>
      <p>ราคาตั้ง : 310.00 ลด 50.0%</p>
      <p>ราคา : <strong>155.00</strong> บาท</p>
      <p>ราคาปลีกแนะนำ : 248.00</p>
    </aside>
  `;

  assert.equal(parseKtwSourcePrice(html, "P525-1310"), 155);
});

test("KTW price parser can compute a discounted website price from list price and percent", () => {
  const { parseKtwSourcePrice } = loadSyncHelpers();
  const html = `
    <script>
      dataLayer.push({
        ecommerce: { items: [{ "item_id": "P525-1310", "price": 203.36 }] }
      });
    </script>
    <aside>
      <p>ราคาตั้ง : 310.00 ลด 50.0%</p>
      <p>ราคาปลีกแนะนำ : 248.00</p>
    </aside>
  `;

  assert.equal(parseKtwSourcePrice(html, "P525-1310"), 155);
});

test("KTW price parser can ignore public tracking price when a discounted price is required", () => {
  const { parseKtwSourcePrice } = loadSyncHelpers();
  const html = `
    <script>
      dataLayer.push({
        ecommerce: { items: [{ "item_id": "P525-1310", "price": 203.36 }] }
      });
    </script>
  `;

  assert.equal(parseKtwSourcePrice(html, "P525-1310"), 203.36);
  assert.equal(parseKtwSourcePrice(html, "P525-1310", { discountOnly: true }), 0);
});

test("stored default cost follows a corrected KTW website price", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-ktw-price-"));
  const files = {
    seedFile: path.join(dir, "seed.json"),
    dashboardFile: path.join(dir, "dashboard.json"),
    ktwLogisticsFile: path.join(dir, "ktw.json"),
    stateFile: path.join(dir, "state.json"),
  };
  fs.writeFileSync(
    files.seedFile,
    JSON.stringify({
      products: [{ sku: "P525-1310", name: "Blade", category: "metal", orderQuantity: 1000 }],
    }),
    "utf8"
  );
  fs.writeFileSync(files.dashboardFile, JSON.stringify({ rows: [] }), "utf8");
  fs.writeFileSync(
    files.ktwLogisticsFile,
    JSON.stringify({
      sourceLabel: "shop.ktw.co.th",
      items: [{ sku: "P525-1310", sourceLabel: "shop.ktw.co.th", sourceUrl: "https://shop.ktw.co.th/p/P525-1310", sourcePrice: 155 }],
    }),
    "utf8"
  );
  fs.writeFileSync(
    files.stateFile,
    JSON.stringify({
      products: [{ sku: "P525-1310", ktwPrice: 203.36, saleUnitPrice: 203.36, purchaseUnitCost: 203.36, status: "review" }],
    }),
    "utf8"
  );

  try {
    const state = loadPlainDesignState(files);
    const product = state.products[0];
    assert.equal(product.ktwPrice, 155);
    assert.equal(product.saleUnitPrice, 155);
    assert.equal(product.purchaseUnitCost, 155);
    assert.equal(product.status, "review");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stored edited cost is preserved when it differs from the old KTW website price", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-ktw-edited-cost-"));
  const files = {
    seedFile: path.join(dir, "seed.json"),
    dashboardFile: path.join(dir, "dashboard.json"),
    ktwLogisticsFile: path.join(dir, "ktw.json"),
    stateFile: path.join(dir, "state.json"),
  };
  fs.writeFileSync(files.seedFile, JSON.stringify({ products: [{ sku: "P525-1310", name: "Blade" }] }), "utf8");
  fs.writeFileSync(files.dashboardFile, JSON.stringify({ rows: [] }), "utf8");
  fs.writeFileSync(
    files.ktwLogisticsFile,
    JSON.stringify({
      sourceLabel: "shop.ktw.co.th",
      items: [{ sku: "P525-1310", sourceLabel: "shop.ktw.co.th", sourceUrl: "https://shop.ktw.co.th/p/P525-1310", sourcePrice: 155 }],
    }),
    "utf8"
  );
  fs.writeFileSync(
    files.stateFile,
    JSON.stringify({
      products: [{ sku: "P525-1310", ktwPrice: 203.36, saleUnitPrice: 203.36, purchaseUnitCost: 120 }],
    }),
    "utf8"
  );

  try {
    const state = loadPlainDesignState(files);
    assert.equal(state.products[0].purchaseUnitCost, 120);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
