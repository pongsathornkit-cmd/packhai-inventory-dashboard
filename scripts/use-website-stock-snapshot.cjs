const fs = require("fs");
const path = require("path");
const { WAREHOUSES } = require("./github-stock-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : path.join(projectRoot, "data");
const snapshotFile = path.join(dataDir, "flowaccount_stock_selected_warehouses.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function main() {
  if (!fs.existsSync(snapshotFile)) {
    throw new Error(`Website stock snapshot was not found: ${snapshotFile}`);
  }

  const snapshot = readJson(snapshotFile);
  const allowedWarehouseIds = new Set(WAREHOUSES.map((item) => String(item.id)));
  const rows = (snapshot.rows || []).filter((row) => allowedWarehouseIds.has(String(row.warehouseId)));
  const positiveRows = rows.filter((row) => numberValue(row.quantity) > 0);
  const warehouseSummary = WAREHOUSES.map((warehouse) => {
    const warehouseRows = rows.filter((row) => String(row.warehouseId) === String(warehouse.id));
    return {
      id: warehouse.id,
      name: warehouse.name,
      rowCount: warehouseRows.length,
      positiveRows: warehouseRows.filter((row) => numberValue(row.quantity) > 0).length,
      quantity: warehouseRows.reduce((sum, row) => sum + Math.max(0, numberValue(row.quantity)), 0),
    };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: "Website Stock",
        storage: "website-stock",
        file: path.relative(projectRoot, snapshotFile).replace(/\\/g, "/"),
        exportedAt: snapshot.exportedAt || "",
        rowCount: rows.length,
        positiveRows: positiveRows.length,
        uniqueSkuCount: new Set(rows.map((row) => normalizeSku(row.sku)).filter(Boolean)).size,
        warehouses: warehouseSummary,
      },
      null,
      2
    )
  );
}

main();
