const { WAREHOUSES, sanitizeStockUpdatePayload } = require("./github-stock-core.cjs");

const WEBSITE_STOCK_SOURCE = "Website Stock";

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/^'+/, "").replace(/\.0$/, "").toUpperCase();
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

function sqlTimestamp(value) {
  const text = String(value || "").trim();
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function duplicateSkus(rows) {
  const counts = new Map();
  for (const row of rows) {
    const sku = normalizeSku(row.sku);
    if (!sku) continue;
    counts.set(sku, (counts.get(sku) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sku, count]) => ({ sku, count }));
}

function warehouseForId(id, fallbackName = "") {
  const warehouse = WAREHOUSES.find((item) => String(item.id) === String(id));
  if (warehouse) return warehouse;
  return {
    id: Number(id),
    name: String(fallbackName || `Warehouse ${id}`),
    apiName: String(fallbackName || `Warehouse ${id}`).replace(/\s+/g, ""),
    label: String(fallbackName || `Warehouse ${id}`).replace(/^คลัง\s*/, ""),
  };
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const sku = normalizeSku(row.sku);
      const warehouseId = Number(row.warehouseId ?? row.warehouse_id ?? 0);
      if (!sku || !warehouseId) return null;
      const warehouse = warehouseForId(warehouseId, row.warehouseName || row.warehouse_name || "");
      return {
        sku,
        name: String(row.name || sku).trim(),
        barcode: String(row.barcode || "").trim(),
        prop: String(row.prop || "").trim(),
        productId: String(row.productId ?? row.product_id ?? "").trim(),
        productMasterId: String(row.productMasterId ?? row.product_master_id ?? "").trim(),
        quantity: numberValue(row.quantity),
        waiting: numberValue(row.waiting),
        waitImport: numberValue(row.waitImport ?? row.wait_import),
        available: numberValue(row.available ?? row.quantity),
        warehouseId,
        warehouseName: row.warehouseName || row.warehouse_name || warehouse.name,
        source: row.source || `${WEBSITE_STOCK_SOURCE} ${row.warehouseName || row.warehouse_name || warehouse.name}`,
      };
    })
    .filter(Boolean);
}

function buildWarehousesSql(snapshot) {
  const seen = new Set();
  const rows = [...WAREHOUSES, ...(Array.isArray(snapshot.warehouses) ? snapshot.warehouses : [])]
    .map((item) => warehouseForId(item.id, item.name))
    .filter((item) => {
      if (!item.id || seen.has(String(item.id))) return false;
      seen.add(String(item.id));
      return true;
    });
  const values = rows
    .map(
      (warehouse) =>
        `(${sqlNumber(warehouse.id)}, ${sqlString(warehouse.name)}, ${sqlString(
          warehouse.apiName || warehouse.api_name || warehouse.name.replace(/\s+/g, "")
        )}, ${sqlString(warehouse.label || warehouse.name.replace(/^คลัง\s*/, ""))}, 'website')`
    )
    .join(",\n  ");
  return `insert into public.warehouses (id, name, api_name, label, source)\nvalues\n  ${values}\non conflict (id) do update\nset name = excluded.name,\n    api_name = excluded.api_name,\n    label = excluded.label,\n    updated_at = now();`;
}

function buildProductsSql(rows) {
  if (!rows.length) return "";
  const bySku = new Map();
  for (const row of rows) {
    if (!bySku.has(row.sku)) bySku.set(row.sku, row);
  }
  const values = [...bySku.values()]
    .map(
      (row) =>
        `(${sqlString(row.sku)}, ${sqlString(row.name)}, ${sqlString(row.barcode)}, ${sqlString(row.prop)}, ${sqlString(
          row.productId
        )}, ${sqlString(row.productMasterId)})`
    )
    .join(",\n  ");
  return `insert into public.products (sku, name, barcode, prop, product_id, product_master_id)\nvalues\n  ${values}\non conflict (sku) do update\nset name = excluded.name,\n    barcode = excluded.barcode,\n    prop = excluded.prop,\n    product_id = excluded.product_id,\n    product_master_id = excluded.product_master_id,\n    updated_at = now();`;
}

function buildBalancesSql(rows, exportedAt) {
  if (!rows.length) return "";
  const values = rows
    .map(
      (row) =>
        `(${sqlString(row.sku)}, ${sqlNumber(row.warehouseId)}, ${sqlNumber(row.quantity)}, ${sqlNumber(
          row.waiting
        )}, ${sqlNumber(row.waitImport)}, ${sqlNumber(row.available)}, ${sqlString(WEBSITE_STOCK_SOURCE)}, ${sqlString(
          row.source
        )}, ${sqlTimestamp(exportedAt)})`
    )
    .join(",\n  ");
  return `insert into public.stock_balances (sku, warehouse_id, quantity, waiting, wait_import, available, source, source_ref, updated_at)\nvalues\n  ${values}\non conflict (sku, warehouse_id) do update\nset quantity = excluded.quantity,\n    waiting = excluded.waiting,\n    wait_import = excluded.wait_import,\n    available = excluded.available,\n    source = excluded.source,\n    source_ref = excluded.source_ref,\n    updated_at = excluded.updated_at;`;
}

function normalizeTransactions(transactions) {
  return (Array.isArray(transactions) ? transactions : [])
    .map((item) => {
      const sku = normalizeSku(item.sku);
      const warehouseId = Number(item.warehouseId ?? item.warehouse_id ?? 0);
      if (!item.id || !sku || !warehouseId) return null;
      return {
        id: String(item.id),
        createdAt: item.createdAt || item.created_at || "",
        sku,
        warehouseId,
        operation: ["add", "set", "subtract"].includes(item.operation) ? item.operation : "set",
        beforeQuantity: numberValue(item.beforeQuantity ?? item.before_quantity),
        inputQuantity: numberValue(item.inputQuantity ?? item.input_quantity),
        afterQuantity: numberValue(item.afterQuantity ?? item.after_quantity),
        deltaQuantity: numberValue(item.deltaQuantity ?? item.delta_quantity),
        actor: String(item.actor || "Website").slice(0, 80),
        note: String(item.note || "").slice(0, 500),
        sourceText: String(item.sourceText || item.source_text || "").slice(0, 500),
        source: String(item.source || WEBSITE_STOCK_SOURCE),
      };
    })
    .filter(Boolean);
}

function buildTransactionsSql(transactions) {
  const rows = normalizeTransactions(transactions);
  if (!rows.length) return "";
  const values = rows
    .map(
      (item) =>
        `(${sqlString(item.id)}, ${sqlTimestamp(item.createdAt)}, ${sqlString(item.sku)}, ${sqlNumber(
          item.warehouseId
        )}, ${sqlString(item.operation)}, ${sqlNumber(item.beforeQuantity)}, ${sqlNumber(item.inputQuantity)}, ${sqlNumber(
          item.afterQuantity
        )}, ${sqlNumber(item.deltaQuantity)}, ${sqlString(item.actor)}, ${sqlString(item.note)}, ${sqlString(
          item.sourceText
        )}, ${sqlString(item.source)})`
    )
    .join(",\n  ");
  return `insert into public.stock_transactions (id, created_at, sku, warehouse_id, operation, before_quantity, input_quantity, after_quantity, delta_quantity, actor, note, source_text, source)\nvalues\n  ${values}\non conflict (id) do nothing;`;
}

function buildInventorySeedSql(snapshot = {}) {
  const rows = normalizeRows(snapshot.rows);
  return [
    "-- Generated by scripts/supabase-stock-core.cjs",
    "begin;",
    buildWarehousesSql(snapshot),
    buildProductsSql(rows),
    buildBalancesSql(rows, snapshot.exportedAt),
    buildTransactionsSql(snapshot.stockTransactions),
    "commit;",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildStockAdjustmentSql(payload = {}, options = {}) {
  const update = sanitizeStockUpdatePayload(payload);
  const body = {
    sku: update.sku,
    operation: update.operation,
    actor: update.actor,
    note: update.note,
    sourceText: update.sourceText,
    createdAt: options.now || payload.createdAt || new Date().toISOString(),
    allocations: update.allocations.map((item) => ({
      warehouseId: item.warehouseId,
      warehouseName: item.warehouseName,
      quantity: item.quantity,
    })),
  };
  return `select public.adjust_website_stock(${sqlString(JSON.stringify(body))}::jsonb);`;
}

function mapSupabaseWebsiteSnapshot(balanceRows = [], transactionRows = [], options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const rows = normalizeRows(
    balanceRows.map((item) => ({
      sku: item.sku,
      name: item.name,
      barcode: item.barcode,
      prop: item.prop,
      productId: item.product_id,
      productMasterId: item.product_master_id,
      quantity: item.quantity,
      waiting: item.waiting,
      waitImport: item.wait_import,
      available: item.available,
      warehouseId: item.warehouse_id,
      warehouseName: item.warehouse_name,
      source: item.source_ref || `${WEBSITE_STOCK_SOURCE} ${item.warehouse_name || ""}`.trim(),
    }))
  ).map((row) => ({
    ...row,
    stockSource: WEBSITE_STOCK_SOURCE,
  }));

  const warehouseStats = WAREHOUSES.map((warehouse) => {
    const warehouseRows = rows.filter((row) => String(row.warehouseId) === String(warehouse.id));
    return {
      id: warehouse.id,
      name: warehouse.name,
      apiName: warehouse.apiName,
      reportedTotal: warehouseRows.length,
      rawRowCount: warehouseRows.length,
      aggregatedRowCount: warehouseRows.length,
      rowCount: warehouseRows.filter((row) => row.quantity > 0).length,
      zeroRowCount: warehouseRows.filter((row) => row.quantity <= 0).length,
    };
  });

  const stockTransactions = normalizeTransactions(transactionRows).map((item) => {
    const warehouse = warehouseForId(item.warehouseId);
    return {
      id: item.id,
      createdAt: item.createdAt,
      sku: item.sku,
      warehouseId: item.warehouseId,
      warehouseName: warehouse.name,
      operation: item.operation,
      beforeQuantity: item.beforeQuantity,
      inputQuantity: item.inputQuantity,
      afterQuantity: item.afterQuantity,
      deltaQuantity: item.deltaQuantity,
      actor: item.actor,
      note: item.note,
      sourceText: item.sourceText,
      source: item.source,
    };
  });

  return {
    exportedAt,
    source: "Supabase Website Stock",
    syncDate: exportedAt.slice(0, 10),
    rowCount: rows.length,
    rawRowCount: rows.length,
    aggregatedRowCount: rows.length,
    uniqueSkuCount: new Set(rows.map((row) => row.sku)).size,
    duplicateSkus: duplicateSkus(rows),
    warehouses: warehouseStats,
    rows,
    stockTransactions,
    storage: "supabase",
  };
}

module.exports = {
  buildInventorySeedSql,
  buildStockAdjustmentSql,
  mapSupabaseWebsiteSnapshot,
  normalizeSku,
};
