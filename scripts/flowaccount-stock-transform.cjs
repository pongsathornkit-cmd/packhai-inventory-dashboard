function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    return numberValue(value.text ?? value.value ?? value.stock ?? value.quantity ?? value.remaining);
  }
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .toUpperCase();
}

function mapReportRow(row, warehouse) {
  const sku = normalizeSku(row.productCode || row.code || row.sku);
  const quantity = numberValue(row.remaining ?? row.remainingStock ?? row.quantity);
  return {
    sku,
    name: String(row.productName || row.name || sku).trim(),
    barcode: String(row.barCode || row.barcode || row.productBarcode || "").trim(),
    prop: "",
    quantity,
    waiting: 0,
    waitImport: 0,
    available: quantity,
    stockSource: "FlowAccount",
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    source: `FlowAccount ${warehouse.name}`,
    productId: row.productId || "",
    productMasterId: row.productMasterId || "",
  };
}

function aggregateRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = `${row.warehouseId}|${row.sku}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...row });
      continue;
    }
    const current = byKey.get(key);
    current.quantity += row.quantity;
    current.available += row.available;
    current.waiting += row.waiting;
  }
  return [...byKey.values()];
}

function hasPositiveStock(row) {
  return numberValue(row.quantity) > 0 || numberValue(row.available) > 0 || numberValue(row.waiting) > 0;
}

function countDuplicateSkus(rows) {
  const skuCounts = new Map();
  for (const row of rows) skuCounts.set(row.sku, (skuCounts.get(row.sku) || 0) + 1);
  return {
    uniqueSkuCount: skuCounts.size,
    duplicateSkus: [...skuCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([sku, count]) => ({ sku, count })),
  };
}

function buildFlowaccountStockOutput({ exportedAt, source, syncDate, warehouseResults }) {
  const warehouseSummaries = [];
  const positiveRows = [];
  let rawRowCount = 0;
  let aggregatedRowCount = 0;

  for (const result of warehouseResults || []) {
    const rawRows = Array.isArray(result.rows) ? result.rows : [];
    rawRowCount += rawRows.length;
    const aggregatedRows = aggregateRows(rawRows.map((row) => mapReportRow(row, result.warehouse)));
    const warehousePositiveRows = aggregatedRows.filter(hasPositiveStock);
    aggregatedRowCount += aggregatedRows.length;
    positiveRows.push(...warehousePositiveRows);
    warehouseSummaries.push({
      id: result.warehouse.id,
      name: result.warehouse.name,
      apiName: result.warehouse.apiName,
      reportedTotal: result.total,
      rawRowCount: rawRows.length,
      aggregatedRowCount: aggregatedRows.length,
      rowCount: warehousePositiveRows.length,
      zeroRowCount: aggregatedRows.length - warehousePositiveRows.length,
    });
  }

  const { uniqueSkuCount, duplicateSkus } = countDuplicateSkus(positiveRows);
  return {
    exportedAt,
    source,
    syncDate,
    rowCount: positiveRows.length,
    rawRowCount,
    aggregatedRowCount,
    uniqueSkuCount,
    duplicateSkus,
    warehouses: warehouseSummaries,
    rows: positiveRows,
  };
}

module.exports = {
  aggregateRows,
  buildFlowaccountStockOutput,
  hasPositiveStock,
  mapReportRow,
  normalizeSku,
  numberValue,
};
