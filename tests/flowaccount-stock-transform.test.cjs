const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFlowaccountStockOutput } = require("../scripts/flowaccount-stock-transform.cjs");

test("FlowAccount output keeps only positive stock rows and preserves raw report counts", () => {
  const output = buildFlowaccountStockOutput({
    exportedAt: "2026-06-27T08:00:00.000Z",
    source: "https://advance.flowaccount.com/N8387296/business/reports/inventory",
    syncDate: "2026-06-27",
    warehouseResults: [
      {
        warehouse: { id: 491661, name: "Warehouse A", apiName: "Warehouse A" },
        total: 3,
        rows: [
          { productCode: "A-1", productName: "Zero A", remaining: 0, productId: 1 },
          { productCode: "B-2", productName: "Positive B", remaining: 5, productId: 2 },
          { productCode: "B-2", productName: "Positive B", remaining: 2, productId: 2 },
        ],
      },
      {
        warehouse: { id: 491662, name: "Warehouse B", apiName: "Warehouse B" },
        total: 2,
        rows: [
          { productCode: "A-1", productName: "Zero A", remaining: 0, productId: 1 },
          { productCode: "B-2", productName: "Positive B", remaining: 1, productId: 2 },
        ],
      },
    ],
  });

  assert.equal(output.rowCount, 2);
  assert.equal(output.rawRowCount, 5);
  assert.equal(output.aggregatedRowCount, 4);
  assert.equal(output.uniqueSkuCount, 1);
  assert.deepEqual(output.duplicateSkus, [{ sku: "B-2", count: 2 }]);
  assert.deepEqual(
    output.rows.map((row) => ({ sku: row.sku, warehouseId: row.warehouseId, quantity: row.quantity })),
    [
      { sku: "B-2", warehouseId: 491661, quantity: 7 },
      { sku: "B-2", warehouseId: 491662, quantity: 1 },
    ]
  );
  assert.deepEqual(
    output.warehouses.map((warehouse) => ({
      id: warehouse.id,
      reportedTotal: warehouse.reportedTotal,
      rawRowCount: warehouse.rawRowCount,
      aggregatedRowCount: warehouse.aggregatedRowCount,
      rowCount: warehouse.rowCount,
      zeroRowCount: warehouse.zeroRowCount,
    })),
    [
      { id: 491661, reportedTotal: 3, rawRowCount: 3, aggregatedRowCount: 2, rowCount: 1, zeroRowCount: 1 },
      { id: 491662, reportedTotal: 2, rawRowCount: 2, aggregatedRowCount: 2, rowCount: 1, zeroRowCount: 1 },
    ]
  );
});
