const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInventorySeedSql,
  buildStockAdjustmentSql,
  mapSupabaseWebsiteSnapshot,
} = require("../scripts/supabase-stock-core.cjs");

const snapshot = {
  exportedAt: "2026-06-29T08:00:00.000Z",
  source: "Website Stock snapshot",
  syncDate: "2026-06-29",
  warehouses: [
    { id: 491661, name: "คลัง ซ.เจริญกิจ", apiName: "คลังซ.เจริญกิจ", rowCount: 1 },
    { id: 491662, name: "คลัง สุขสวัสดิ์", apiName: "คลังสุขสวัสดิ์", rowCount: 1 },
  ],
  rows: [
    {
      sku: "FD-S2000",
      name: "MARATHON รอกมือหมุน",
      barcode: "",
      prop: "",
      quantity: 160,
      waiting: 0,
      waitImport: 0,
      available: 160,
      stockSource: "Website Stock",
      warehouseId: 491661,
      warehouseName: "คลัง ซ.เจริญกิจ",
      source: "Website Stock คลัง ซ.เจริญกิจ",
      productId: 80340792,
      productMasterId: 74924516,
    },
  ],
  stockTransactions: [
    {
      id: "stock-tx-20260629T080000000Z-FD-S2000-491661-1",
      createdAt: "2026-06-29T08:00:00.000Z",
      sku: "FD-S2000",
      warehouseId: 491661,
      warehouseName: "คลัง ซ.เจริญกิจ",
      operation: "set",
      beforeQuantity: 0,
      inputQuantity: 160,
      afterQuantity: 160,
      deltaQuantity: 160,
      actor: "Website",
      note: "initial import",
      sourceText: "seed",
      source: "Website Stock",
    },
  ],
};

test("buildInventorySeedSql upserts selected warehouses, products, balances, and transactions", () => {
  const sql = buildInventorySeedSql(snapshot);

  assert.match(sql, /insert into public\.warehouses/i);
  assert.match(sql, /491661/);
  assert.match(sql, /คลัง ซ\.เจริญกิจ/);
  assert.match(sql, /insert into public\.products/i);
  assert.match(sql, /FD-S2000/);
  assert.match(sql, /insert into public\.stock_balances/i);
  assert.match(sql, /on conflict \(sku, warehouse_id\) do update/i);
  assert.match(sql, /insert into public\.stock_transactions/i);
  assert.match(sql, /on conflict \(id\) do nothing/i);
});

test("buildStockAdjustmentSql calls the stock adjustment RPC with the sanitized payload", () => {
  const sql = buildStockAdjustmentSql(
    {
      sku: "fd-s2000",
      operation: "set",
      actor: "Owner",
      note: "counted",
      allocations: [{ warehouseId: 491661, quantity: 155 }],
    },
    { now: "2026-06-29T09:00:00.000Z" }
  );

  assert.match(sql, /select public\.adjust_website_stock/i);
  assert.match(sql, /FD-S2000/);
  assert.match(sql, /"warehouseId":491661/);
  assert.match(sql, /"quantity":155/);
  assert.match(sql, /"operation":"set"/);
});

test("mapSupabaseWebsiteSnapshot returns the current dashboard-compatible stock shape", () => {
  const mapped = mapSupabaseWebsiteSnapshot(
    [
      {
        sku: "FD-S2000",
        name: "MARATHON รอกมือหมุน",
        barcode: "",
        prop: "",
        quantity: "155",
        waiting: "0",
        wait_import: "0",
        available: "155",
        warehouse_id: 491661,
        warehouse_name: "คลัง ซ.เจริญกิจ",
        product_id: "80340792",
        product_master_id: "74924516",
      },
    ],
    [
      {
        id: "stock-tx-1",
        created_at: "2026-06-29T09:00:00.000Z",
        sku: "FD-S2000",
        warehouse_id: 491661,
        warehouse_name: "คลัง ซ.เจริญกิจ",
        operation: "set",
        before_quantity: "160",
        input_quantity: "155",
        after_quantity: "155",
        delta_quantity: "-5",
        actor: "Owner",
        note: "counted",
        source_text: "",
        source: "Website Stock",
      },
    ],
    { exportedAt: "2026-06-29T09:01:00.000Z" }
  );

  assert.equal(mapped.source, "Supabase Website Stock");
  assert.equal(mapped.rowCount, 1);
  assert.equal(mapped.uniqueSkuCount, 1);
  assert.equal(mapped.rows[0].stockSource, "Website Stock");
  assert.equal(mapped.rows[0].warehouseName, "คลัง ซ.เจริญกิจ");
  assert.equal(mapped.rows[0].quantity, 155);
  assert.equal(mapped.stockTransactions[0].createdAt, "2026-06-29T09:00:00.000Z");
  assert.equal(mapped.stockTransactions[0].deltaQuantity, -5);
});
