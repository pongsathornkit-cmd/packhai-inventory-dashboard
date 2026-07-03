const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  ALIBABA_PAID_ORDER_STATUSES,
  buildAlibabaPurchaseOrders,
} = require("../scripts/alibaba-purchase-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Alibaba paid order statuses match the requested workflow list", () => {
  assert.deepEqual(ALIBABA_PAID_ORDER_STATUSES, [
    "Waiting for remaining balance payment",
    "Waiting for supplier to ship",
    "Waiting for delivery confirmation",
    "Waiting for buyer to confirm modified order",
    "Insufficient balance payment",
    "Order completed",
    "Shipment Started",
    "Shipment partially dispatched",
  ]);
});

test("Alibaba purchase order builder keeps only requested statuses and summarizes paid orders", () => {
  const result = buildAlibabaPurchaseOrders({
    exportedAt: "2026-07-03T04:00:00.000Z",
    source: "Alibaba paid orders export",
    orders: [
      {
        orderNo: "A-1003",
        supplierName: "Zhejiang Tools",
        status: "Waiting for supplier to ship",
        orderDate: "2026-07-02",
        amount: "1200.50",
        paidAmount: "1200.50",
        currency: "USD",
        itemCount: 4,
      },
      {
        orderNo: "A-1002",
        supplierName: "Ningbo Pump",
        orderStatus: "Shipment Started",
        orderDate: "2026-07-01",
        totalAmount: 880,
        paidAmount: 880,
        currency: "USD",
        trackingNo: "TRK-1",
      },
      {
        orderNo: "A-1001",
        supplierName: "Old Draft Supplier",
        status: "Awaiting initial payment",
        orderDate: "2026-06-29",
        amount: 500,
        paidAmount: 0,
      },
    ],
  });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.orderNo),
    ["A-1003", "A-1002"]
  );
  assert.equal(result.summary.totalOrders, 2);
  assert.equal(result.summary.totalPaidAmount, 2080.5);
  assert.equal(result.summary.waitingSupplierShip, 1);
  assert.equal(result.summary.shipmentActive, 1);
  assert.equal(result.statusBreakdown.find((item) => item.status === "Waiting for supplier to ship").count, 1);
  assert.equal(result.metadata.exportedAtLabel, "03 ก.ค. 2569 11:00");
});

test("Alibaba purchase order builder preserves product lines, thumbnails, and order captures", () => {
  const result = buildAlibabaPurchaseOrders({
    exportedAt: "2026-07-03T04:00:00.000Z",
    orders: [
      {
        orderNo: "A-2001",
        supplierName: "Ningbo Tools",
        status: "Waiting for delivery confirmation",
        orderDate: "2026-07-01T00:00:00.000Z",
        orderAmount: 640,
        paidAmount: 640,
        currency: "USD",
        captureUrl: "https://example.com/captures/A-2001.png",
        capturedAt: "2026-07-03T04:15:00.000Z",
        capturedPage: 2,
        products: [
          {
            title: "Portable pressure washer",
            skuText: "V80L x 10 items",
            quantity: 10,
            productUrl: "https://www.alibaba.com/product-detail/sample.html",
            imageUrl: "https://img.example.com/washer.jpg",
          },
        ],
      },
    ],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].captureUrl, "https://example.com/captures/A-2001.png");
  assert.equal(result.rows[0].capturedPage, 2);
  assert.equal(result.rows[0].capturedAtLabel, "03 ก.ค. 2569 11:15");
  assert.equal(result.rows[0].products.length, 1);
  assert.deepEqual(result.rows[0].products[0], {
    rowNo: 1,
    title: "Portable pressure washer",
    skuText: "V80L x 10 items",
    quantity: 10,
    productUrl: "https://www.alibaba.com/product-detail/sample.html",
    imageUrl: "https://img.example.com/washer.jpg",
  });
  assert.equal(result.rows[0].skuSummary, "Portable pressure washer");
});

test("dashboard exposes an Alibaba paid orders section and renderer", () => {
  const template = readRepoFile("src/index.template.html");
  const app = readRepoFile("src/app.js");
  const build = readRepoFile("scripts/build-dashboard.cjs");

  assert.match(template, /href="#alibaba-orders"/);
  assert.match(template, /id="alibaba-orders"/);
  assert.match(app, /function\s+renderAlibabaPurchaseOrders/);
  assert.match(app, /alibabaPurchaseOrders/);
  assert.match(app, /function\s+renderAlibabaOrderCapture/);
  assert.match(app, /function\s+renderAlibabaProducts/);
  assert.match(app, /function\s+renderAlibabaStatusTabs/);
  assert.match(app, /data-alibaba-status-tab/);
  assert.match(app, /function\s+shouldKeepCurrentAlibabaPurchaseOrders/);
  assert.match(app, /data\.alibabaPurchaseOrders\s*=\s*currentAlibabaPurchaseOrders/);
  assert.match(app, /class="alibaba-product-thumb/);
  assert.match(app, /class="alibaba-capture-card/);
  assert.match(app, /class="alibaba-status-tabs/);
  assert.match(build, /alibabaPurchaseOrders/);
});
