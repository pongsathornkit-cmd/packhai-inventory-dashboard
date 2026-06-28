const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStockMovementSnapshot } = require("../scripts/packhai-stock-movement-core.cjs");
const {
  buildPlatformPaymentSummary,
  buildSellerPaymentIndex,
  enrichMovementWithSellerPayment,
} = require("../scripts/seller-order-payment-core.cjs");

test("Packhai stock movement snapshot keeps every order row and picks latest by stock id", () => {
  const snapshot = buildStockMovementSnapshot(
    [
      {
        stockID: 10,
        sku: "A-1",
        created: "2026-06-25 10:00:00",
        description: "Use from order",
        referenceNo: "PA1",
        referenceNo2: "260625ABC",
        channelName: "Shopee",
        addQuantity: 0,
        removeQuantity: 2,
        totalQuantity: 15,
      },
      {
        stockID: 10,
        sku: "A-1",
        created: "2026-06-26 12:00:00",
        description: "Use from order",
        referenceNo: "PA2",
        referenceNo2: "260626XYZ",
        channelName: "Shopee",
        addQuantity: 0,
        removeQuantity: 1,
        totalQuantity: 14,
      },
      {
        stockID: 11,
        sku: "B-2",
        created: "2026-06-24 09:30:00",
        description: "Stock receive",
        referenceNo: "IN1",
        referenceNo2: "",
        channelName: "",
        addQuantity: 5,
        removeQuantity: 0,
        totalQuantity: 20,
      },
    ],
    { startDate: "2026-06-01", endDate: "2026-06-27" }
  );

  assert.equal(snapshot.rowCount, 3);
  assert.equal(snapshot.stockShopCount, 2);
  assert.equal(snapshot.rowsByStockShopId.get(10).length, 2);
  assert.equal(snapshot.latestByStockShopId.get(10).latestStockMovementReferenceNo, "PA2");
  assert.deepEqual(
    snapshot.rowsByStockShopId.get(10).map((row) => row.platformOrderNo),
    ["260626XYZ", "260625ABC"]
  );
});

test("seller platform payment is joined only from seller platform order data", () => {
  const paymentIndex = buildSellerPaymentIndex({
    exportedAt: "2026-06-27T08:00:00.000Z",
    orders: [
      {
        platform: "Shopee",
        orderNo: "260626XYZ",
        collectedAmount: 585,
        status: "paid",
        capturedAt: "2026-06-27T07:00:00.000Z",
      },
    ],
  });

  const matched = enrichMovementWithSellerPayment(
    {
      channelName: "Shopee",
      platformOrderNo: "260626XYZ",
      removeQuantity: 1,
      addQuantity: 0,
    },
    paymentIndex
  );
  assert.equal(matched.platformPaymentStatus, "matched");
  assert.equal(matched.platformPaymentAmount, 585);
  assert.equal(matched.platformPaymentSource, "Shopee Seller Center");

  const missing = enrichMovementWithSellerPayment(
    {
      channelName: "Shopee",
      platformOrderNo: "260626MISSING",
      removeQuantity: 1,
      addQuantity: 0,
    },
    paymentIndex
  );
  assert.equal(missing.platformPaymentStatus, "missing-seller-data");
  assert.equal(missing.platformPaymentAmount, 0);
  assert.equal(missing.platformPaymentSource, "");
});

test("platform payment summary counts unique platform sale orders and matched seller collections", () => {
  const paymentIndex = buildSellerPaymentIndex({
    orders: [
      { platform: "Shopee", orderNo: "SP-001", collectedAmount: 500 },
      { platform: "Lazada", orderNo: "LZ-001", collectedAmount: 300 },
    ],
  });
  const movements = [
    { channelName: "Shopee", platformOrderNo: "SP-001", removeQuantity: 1, addQuantity: 0 },
    { channelName: "Shopee", platformOrderNo: "SP-001", removeQuantity: 2, addQuantity: 0 },
    { channelName: "Shopee", platformOrderNo: "SP-002", removeQuantity: 1, addQuantity: 0 },
    { channelName: "Lazada", platformOrderNo: "LZ-001", removeQuantity: 1, addQuantity: 0 },
    { channelName: "Manual", platformOrderNo: "M-001", removeQuantity: 1, addQuantity: 0 },
    { channelName: "Shopee", platformOrderNo: "SP-003", removeQuantity: 0, addQuantity: 1 },
  ].map((movement) => enrichMovementWithSellerPayment(movement, paymentIndex));

  const summary = buildPlatformPaymentSummary(movements);

  assert.equal(summary.targetOrderCount, 3);
  assert.equal(summary.matchedOrderCount, 2);
  assert.equal(summary.missingOrderCount, 1);
  assert.equal(summary.collectedAmount, 800);
  assert.equal(summary.coverage, 2 / 3);
  assert.equal(summary.byPlatform.Shopee.targetOrderCount, 2);
  assert.equal(summary.byPlatform.Shopee.matchedOrderCount, 1);
  assert.equal(summary.byPlatform.Shopee.missingOrderCount, 1);
  assert.equal(summary.byPlatform.Shopee.collectedAmount, 500);
  assert.equal(summary.byPlatform.Lazada.targetOrderCount, 1);
  assert.equal(summary.byPlatform.Lazada.matchedOrderCount, 1);
  assert.equal(summary.byPlatform.Lazada.missingOrderCount, 0);
  assert.equal(summary.byPlatform.Lazada.collectedAmount, 300);
});
