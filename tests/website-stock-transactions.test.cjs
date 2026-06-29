const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { applyGithubStockUpdate, WAREHOUSES } = require("../scripts/github-stock-core.cjs");

function writeSnapshot(file) {
  const suksawat = WAREHOUSES.find((warehouse) => warehouse.id === 491662);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        exportedAt: "",
        source: "Website Stock snapshot",
        syncDate: "",
        rowCount: 1,
        uniqueSkuCount: 1,
        duplicateSkus: [],
        warehouses: WAREHOUSES.map((warehouse) => ({ id: warehouse.id, name: warehouse.name, rowCount: 0 })),
        rows: [
          {
            sku: "V80L-CHINA",
            name: "Foam Tank",
            quantity: 20,
            available: 20,
            stockSource: "Website Stock",
            warehouseId: suksawat.id,
            warehouseName: suksawat.name,
          },
        ],
        stockTransactions: [],
      },
      null,
      2
    ),
    "utf8"
  );
}

test("records website stock adjustment transactions with before and after quantities", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "website-stock-transactions-"));
  const file = path.join(tempDir, "stock.json");
  writeSnapshot(file);

  const result = applyGithubStockUpdate(
    file,
    {
      sku: "V80L-CHINA",
      operation: "set",
      sourceText: "manual row adjustment",
      actor: "Owner",
      note: "counted shelf",
      allocations: [{ warehouseId: 491662, quantity: 18 }],
    },
    { now: "2026-06-29T09:30:00.000Z" }
  );
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(result.transactions.length, 1);
  assert.equal(saved.stockTransactions.length, 1);
  assert.equal(saved.stockTransactions[0].sku, "V80L-CHINA");
  assert.equal(saved.stockTransactions[0].warehouseId, 491662);
  assert.equal(saved.stockTransactions[0].operation, "set");
  assert.equal(saved.stockTransactions[0].beforeQuantity, 20);
  assert.equal(saved.stockTransactions[0].afterQuantity, 18);
  assert.equal(saved.stockTransactions[0].deltaQuantity, -2);
  assert.equal(saved.stockTransactions[0].note, "counted shelf");
  assert.match(saved.stockTransactions[0].id, /^stock-tx-20260629T093000000Z-/);
  assert.equal(saved.rows[0].manualUpdateSource, "Website Stock Adjustment");
});

test("allows setting a website stock row to zero quantity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "website-stock-zero-"));
  const file = path.join(tempDir, "stock.json");
  writeSnapshot(file);

  const result = applyGithubStockUpdate(
    file,
    {
      sku: "V80L-CHINA",
      operation: "set",
      allocations: [{ warehouseId: 491662, quantity: 0 }],
    },
    { now: "2026-06-29T10:00:00.000Z" }
  );
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(result.allocations[0].afterQuantity, 0);
  assert.equal(result.transactions[0].afterQuantity, 0);
  assert.equal(saved.rows[0].quantity, 0);
  assert.equal(saved.rows[0].available, 0);
});

test("build dashboard includes website stock transaction history for the frontend", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-dashboard.cjs"), "utf8");

  assert.match(source, /stockTransactions/);
  assert.match(source, /websiteStockTransactions/);
  assert.match(source, /supabase_website_stock\.json/);
});

test("frontend exposes row stock adjustment controls and transaction history", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const templateSource = fs.readFileSync(path.join(__dirname, "..", "src", "index.template.html"), "utf8");

  assert.match(appSource, /data-stock-adjust-id/);
  assert.match(appSource, /openStockAdjustModal/);
  assert.match(appSource, /websiteStockTransactionTable/);
  assert.match(templateSource, /id="stockAdjustModal"/);
  assert.match(templateSource, /id="stockAdjustForm"/);
});

test("supabase website stock export script can generate dashboard-compatible snapshots", () => {
  const exportSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "export-supabase-website-stock.cjs"), "utf8");

  assert.match(exportSource, /mapSupabaseWebsiteSnapshot/);
  assert.match(exportSource, /stock_balances/);
  assert.match(exportSource, /stock_transactions/);
  assert.doesNotMatch(exportSource, /SUPABASE_SERVICE_ROLE_KEY=.*[A-Za-z0-9_\\-]{10,}/);
});
