const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStockMovementSnapshot,
  stockSummaryRowsFromMovementSnapshot,
} = require("../scripts/packhai-stock-movement-core.cjs");
const {
  buildUncollectedStockDeductionReport,
  buildPlatformPaymentOrders,
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

test("Packhai stock movement snapshot can be used as stock summary fallback", () => {
  const snapshot = buildStockMovementSnapshot(
    [
      {
        stockID: 10,
        sku: " a-1 ",
        name: "Old movement name",
        created: "2026-06-25 10:00:00",
        addQuantity: 5,
        removeQuantity: 0,
        totalQuantity: 15,
      },
      {
        stockID: 10,
        sku: "A-1",
        productName: "Product A",
        created: "2026-06-26 12:00:00",
        addQuantity: 0,
        removeQuantity: 1,
        totalQuantity: 14,
      },
      {
        stockID: 11,
        productCode: "b-2",
        productName: "Product B",
        created: "2026-06-24 09:30:00",
        addQuantity: 20,
        removeQuantity: 0,
        totalQuantity: 20,
      },
    ],
    { startDate: "2026-06-01", endDate: "2026-06-27" }
  );

  const rows = stockSummaryRowsFromMovementSnapshot(snapshot);

  assert.deepEqual(rows, [
    {
      stockShopID: 10,
      sku: "A-1",
      name: "Product A",
      quantityRemain: 14,
      quantityAvailable: 14,
      quantityOrder: 0,
      quantityImport: 0,
      quantityExport: 0,
      warehouseName: "",
      isNoMovement: false,
    },
    {
      stockShopID: 11,
      sku: "B-2",
      name: "Product B",
      quantityRemain: 20,
      quantityAvailable: 20,
      quantityOrder: 0,
      quantityImport: 0,
      quantityExport: 0,
      warehouseName: "",
      isNoMovement: false,
    },
  ]);
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

test("seller platform payment is allocated by matched SKU line, not copied from the whole order", () => {
  const paymentIndex = buildSellerPaymentIndex({
    orders: [
      {
        platform: "Shopee",
        orderNo: "SP-MULTI",
        collectedAmount: 386,
        status: "paid",
        items: [
          { skuText: "[47143 ]", amount: 1, lineAmount: 100 },
          { skuText: "[H161-PC2B-1 ]", amount: 1, lineAmount: 286 },
        ],
      },
    ],
  });

  const handle = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-MULTI", sku: "47143", removeQuantity: 1 },
    paymentIndex
  );
  const pressureSwitch = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-MULTI", sku: "H161-PC2B-1", removeQuantity: 1 },
    paymentIndex
  );

  assert.equal(handle.platformPaymentStatus, "matched");
  assert.equal(handle.platformPaymentAmount, 100);
  assert.equal(handle.platformPaymentOrderAmount, 386);
  assert.equal(handle.platformPaymentAllocationMethod, "sku-line-amount");
  assert.equal(pressureSwitch.platformPaymentStatus, "matched");
  assert.equal(pressureSwitch.platformPaymentAmount, 286);

  const [order] = buildPlatformPaymentOrders([handle, pressureSwitch]);
  assert.equal(order.collectedAmount, 386);
});

test("Shopee payment uses order income after fees for single SKU orders", () => {
  const paymentIndex = buildSellerPaymentIndex({
    orders: [
      {
        platform: "Shopee",
        orderNo: "SP-INCOME-ONE",
        totalAmount: 1699,
        orderIncomeAmount: 1225,
        paymentBreakdown: {
          merchandiseSubtotal: 1699,
          feesAndCharges: -474,
          escrowAmount: 1225,
        },
        items: [{ skuText: "F131-5161", amount: 1, netSalesAmount: 1699 }],
      },
    ],
  });

  const movement = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-INCOME-ONE", sku: "F131-5161", removeQuantity: 1 },
    paymentIndex
  );

  assert.equal(movement.platformPaymentStatus, "matched");
  assert.equal(movement.platformPaymentAmount, 1225);
  assert.equal(movement.platformPaymentOrderAmount, 1225);
  assert.equal(movement.platformPaymentAllocationMethod, "sku-line-amount");
});

test("Shopee payment allocates order income by each SKU net sales amount", () => {
  const paymentIndex = buildSellerPaymentIndex({
    orders: [
      {
        platform: "Shopee",
        orderNo: "SP-INCOME-MULTI",
        totalAmount: 2000,
        orderIncomeAmount: 1225,
        items: [
          { skuText: "SKU-A", amount: 1, netSalesAmount: 1699 },
          { skuText: "SKU-B", amount: 1, netSalesAmount: 301 },
        ],
      },
    ],
  });

  const skuA = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-INCOME-MULTI", sku: "SKU-A", removeQuantity: 1 },
    paymentIndex
  );
  const skuB = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-INCOME-MULTI", sku: "SKU-B", removeQuantity: 1 },
    paymentIndex
  );

  assert.equal(skuA.platformPaymentStatus, "matched");
  assert.equal(skuA.platformPaymentAmount, 1040.64);
  assert.equal(skuA.platformPaymentOrderAmount, 1225);
  assert.equal(skuB.platformPaymentStatus, "matched");
  assert.equal(skuB.platformPaymentAmount, 184.36);
  assert.equal(skuB.platformPaymentOrderAmount, 1225);
});

test("seller platform payment is not assigned to a SKU when multi-item order has no item amounts", () => {
  const paymentIndex = buildSellerPaymentIndex({
    orders: [
      {
        platform: "Shopee",
        orderNo: "SP-NO-LINES",
        collectedAmount: 386,
        items: [
          { skuText: "[47143 ]", amount: 1 },
          { skuText: "[H161-PC2B-1 ]", amount: 1 },
        ],
      },
    ],
  });

  const movement = enrichMovementWithSellerPayment(
    { channelName: "Shopee", platformOrderNo: "SP-NO-LINES", sku: "47143", removeQuantity: 1 },
    paymentIndex
  );

  assert.equal(movement.platformPaymentStatus, "matched-item-amount-missing");
  assert.equal(movement.platformPaymentAmount, 0);
  assert.equal(movement.platformPaymentOrderAmount, 386);
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

test("uncollected stock deduction report uses SKU value and excludes collected orders", () => {
  const movements = [
    {
      stockShopId: 1,
      sku: "A-1",
      productName: "Product A",
      createdAt: "2026-06-28T10:00:00.000Z",
      channelName: "Shopee",
      platformOrderNo: "SP-MISSING",
      referenceNo: "PA1",
      removeQuantity: 2,
      platformPaymentStatus: "missing-seller-data",
    },
    {
      stockShopId: 2,
      sku: "B-2",
      productName: "Product B",
      createdAt: "2026-06-28T09:00:00.000Z",
      channelName: "Shopee",
      platformOrderNo: "SP-MULTI",
      referenceNo: "PA2",
      removeQuantity: 1,
      platformPaymentStatus: "matched-item-amount-missing",
      platformPaymentOrderAmount: 900,
    },
    {
      stockShopId: 3,
      sku: "C-3",
      productName: "Product C",
      createdAt: "2026-06-28T08:00:00.000Z",
      channelName: "Lazada",
      platformOrderNo: "LZ-SKU-MISMATCH",
      referenceNo: "PA3",
      removeQuantity: 1,
      platformPaymentStatus: "matched-item-not-found",
      platformPaymentOrderAmount: 400,
    },
    {
      stockShopId: 4,
      sku: "D-4",
      productName: "Product D",
      createdAt: "2026-06-28T07:00:00.000Z",
      channelName: "Shopee",
      platformOrderNo: "SP-PAID",
      referenceNo: "PA4",
      removeQuantity: 1,
      platformPaymentStatus: "matched",
      platformPaymentAmount: 220,
    },
    {
      stockShopId: 5,
      sku: "E-5",
      productName: "Manual Sale",
      createdAt: "2026-06-28T06:00:00.000Z",
      channelName: "Manual",
      platformOrderNo: "M-1",
      referenceNo: "PA5",
      removeQuantity: 1,
      platformPaymentStatus: "non-platform",
    },
  ];
  const report = buildUncollectedStockDeductionReport(movements, [
    { stockShopId: 1, sku: "A-1", price: 100, priceSource: "Shopee" },
    { stockShopId: 2, sku: "B-2", price: 150, priceSource: "Shopee" },
    { stockShopId: 3, sku: "C-3", price: 50, priceSource: "Lazada" },
    { stockShopId: 4, sku: "D-4", price: 220, priceSource: "Shopee" },
  ]);

  assert.equal(report.summary.rowCount, 3);
  assert.equal(report.summary.orderCount, 3);
  assert.equal(report.summary.totalQuantity, 4);
  assert.equal(report.summary.estimatedAmount, 400);
  assert.equal(report.summary.byPlatform.Shopee.rowCount, 2);
  assert.equal(report.summary.byPlatform.Lazada.rowCount, 1);
  assert.equal(report.summary.byReason["missing-seller-data"].rowCount, 1);
  assert.equal(report.summary.byReason["matched-item-amount-missing"].rowCount, 1);
  assert.equal(report.summary.byReason["matched-item-not-found"].rowCount, 1);

  const multiSku = report.rows.find((row) => row.platformOrderNo === "SP-MULTI");
  assert.equal(multiSku.estimatedAmount, 150);
  assert.equal(multiSku.sellerOrderAmount, 900);
  assert.equal(multiSku.reason, "matched-item-amount-missing");
  assert.ok(!report.rows.some((row) => row.platformOrderNo === "SP-PAID"));
});
