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
  const css = readRepoFile("src/styles.css");
  const build = readRepoFile("scripts/build-dashboard.cjs");

  assert.match(template, /href="#alibaba-orders"/);
  assert.match(template, /href="#alibaba-order-table"/);
  assert.match(template, /id="alibaba-orders"/);
  assert.match(template, /id="alibaba-order-table"/);
  assert.match(app, /function\s+renderAlibabaPurchaseOrders/);
  assert.match(app, /function\s+isAlibabaOrderTableRoute/);
  assert.match(app, /body\.classList\.toggle\("alibaba-order-table-route", alibabaOrderTableRoute\)/);
  assert.match(app, /const activeRouteHash = alibabaOrderTableRoute \? "#alibaba-order-table"/);
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
  assert.match(css, /body\.alibaba-order-table-route \.report-header/);
  assert.match(css, /body\.alibaba-order-table-route main > section:not\(#alibaba-orders\)/);
  assert.match(css, /body\.alibaba-order-table-route #alibaba-orders \.alibaba-kpis/);
  assert.match(css, /body\.alibaba-order-table-route #alibaba-orders \.alibaba-orders-table-wrap/);
  assert.match(css, /body\.alibaba-order-table-route #alibaba-orders \.alibaba-orders-table-wrap\s*\{[\s\S]*?max-height:\s*none;/);
  assert.match(build, /alibabaPurchaseOrders/);
});

test("dashboard exposes an Alibaba receiving workflow for landed cost and stock-in prep", () => {
  const app = readRepoFile("src/app.js");
  const css = readRepoFile("src/styles.css");

  assert.match(app, /alibabaReceivingStorageKey/);
  assert.match(app, /function\s+renderAlibabaReceivingWorkbench/);
  assert.match(app, /function\s+calculateAlibabaReceivingRows/);
  assert.match(app, /data-alibaba-order-shipping-cost/);
  assert.match(app, /data-alibaba-exchange-rate/);
  assert.match(app, /data-alibaba-sku-input/);
  assert.match(app, /data-alibaba-warehouse-select/);
  assert.match(app, /data-alibaba-create-sku/);
  assert.match(app, /data-alibaba-stock-in-qty/);
  assert.match(app, /data-alibaba-receiving-save/);
  assert.match(app, /คลัง สุขสวัสดิ์/);
  assert.match(app, /คลัง ซ\.เจริญกิจ/);
  assert.match(app, /คลัง Packhai/);
  assert.match(app, /On Order/);
  assert.match(app, /กำไรต่อชิ้น/);
  assert.match(css, /\.alibaba-receiving-workbench/);
  assert.match(css, /\.alibaba-receiving-grid/);
  assert.match(css, /\.alibaba-receiving-card/);
  assert.match(css, /\.alibaba-cost-metric/);
});

test("Alibaba receiving shipping cost is entered per order, not across all orders", () => {
  const app = readRepoFile("src/app.js");

  assert.match(app, /orders:\s*parsed\.orders/);
  assert.match(app, /function\s+alibabaReceivingOrderKey/);
  assert.match(app, /function\s+alibabaReceivingOrderDraft/);
  assert.match(app, /data-alibaba-order-shipping-cost/);
  assert.match(app, /orderShippingCost/);
  assert.match(app, /orderQuantity/);
  assert.match(app, /root\.addEventListener\(\s*"focusout"/);
  assert.match(app, /shippingCostPerPiece\s*=\s*moneyValue\(orderShippingCost \/ Math\.max\(1,\s*orderQuantity\)\)/);
  assert.doesNotMatch(app, /shippingCostPerPiece\s*=\s*moneyValue\(lotShippingCost \/ lotQuantity\)/);
});

test("Alibaba receiving can post stock-in transactions to Website Stock only", () => {
  const app = readRepoFile("src/app.js");

  assert.match(app, /async function\s+postAlibabaReceivingStock/);
  assert.match(app, /saveWebsiteStockAdjustment/);
  assert.match(app, /operation:\s*"add"/);
  assert.match(app, /actor:\s*"Alibaba Receiving UI"/);
  assert.match(app, /คลัง Packhai รับเข้าผ่าน Packhai/);
  assert.match(app, /บันทึกสถานะ On Order/);
  assert.match(app, /รับเข้า stock/);
});

test("Alibaba receiving SKU search shows product image results while typing", () => {
  const app = readRepoFile("src/app.js");
  const css = readRepoFile("src/styles.css");

  assert.match(app, /function\s+filterAlibabaSkuOptions/);
  assert.match(app, /function\s+renderAlibabaSkuSearchResults/);
  assert.match(app, /data-alibaba-sku-results/);
  assert.match(app, /data-alibaba-sku-option/);
  assert.match(app, /class="alibaba-sku-result-thumb/);
  assert.match(app, /renderAlibabaSkuSuggestionsForInput\(target\)/);
  assert.match(css, /\.alibaba-sku-picker/);
  assert.match(css, /\.alibaba-sku-results/);
  assert.match(css, /\.alibaba-sku-result-thumb/);
});

test("Alibaba order rows render compact by default with expandable details", () => {
  const app = readRepoFile("src/app.js");
  const css = readRepoFile("src/styles.css");

  assert.match(app, /expandedOrderKeys:\s*new Set\(\)/);
  assert.match(app, /function\s+renderAlibabaReceivingSummary/);
  assert.match(app, /data-alibaba-order-toggle/);
  assert.match(app, /aria-expanded="\$\{expanded \? "true" : "false"\}"/);
  assert.match(app, /class="alibaba-order-toggle-row\$\{expanded \? " expanded" : ""\}"/);
  assert.match(app, /class="alibaba-row-toggle-edge"/);
  assert.match(app, /if \(!\(target instanceof Element\)\) return;/);
  assert.match(app, /class="alibaba-order-detail-row"/);
  assert.match(app, /renderAlibabaOrderDetails/);
  assert.match(css, /\.alibaba-order-main-row/);
  assert.match(css, /\.alibaba-order-toggle-row td\s*\{[\s\S]*?height:\s*0;/);
  assert.match(css, /\.payment-orders-table \.alibaba-order-toggle-row td\s*\{[\s\S]*?height:\s*0\s*!important;/);
  assert.match(css, /\.alibaba-row-toggle-edge\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(css, /\.alibaba-row-toggle-edge svg\s*\{[\s\S]*?transition:/);
  assert.match(css, /\.alibaba-order-detail-panel/);
});

test("Alibaba order table fits the page with consolidated columns", () => {
  const app = readRepoFile("src/app.js");
  const css = readRepoFile("src/styles.css");

  assert.match(app, /function\s+renderAlibabaOrderIdentity/);
  assert.match(app, /function\s+renderAlibabaSupplierStatus/);
  assert.match(app, /function\s+renderAlibabaTimelineSummary/);
  assert.match(app, /function\s+renderAlibabaMoneySummary/);
  assert.match(app, /colspan="6"/);
  assert.match(css, /\.alibaba-orders-table\s*\{[\s\S]*?table-layout:\s*fixed;/);
  assert.match(css, /\.alibaba-orders-table\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.alibaba-order-detail-panel \.alibaba-product-list\s*\{[\s\S]*?min-width:\s*0;/);
  assert.doesNotMatch(css, /\.alibaba-orders-table\s*\{[\s\S]*?min-width:\s*2140px;/);
});

test("Alibaba table route uses readable page-scrolled sizing", () => {
  const css = readRepoFile("src/styles.css");

  assert.match(css, /body\.alibaba-order-table-route #alibaba-orders \.alibaba-orders-table-wrap\s*\{[\s\S]*?max-height:\s*none;/);
  assert.match(css, /body\.alibaba-order-table-route #alibaba-orders \.alibaba-orders-table-wrap\s*\{[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(css, /body\.alibaba-order-table-route \.payment-orders-table\.alibaba-orders-table th\s*\{[\s\S]*?font-size:\s*13px;/);
  assert.match(css, /body\.alibaba-order-table-route \.payment-orders-table\.alibaba-orders-table td\s*\{[\s\S]*?font-size:\s*14px;/);
  assert.match(css, /body\.alibaba-order-table-route \.alibaba-orders-table tr\.alibaba-order-main-row td\s*\{[\s\S]*?height:\s*86px;/);
  assert.match(css, /body\.alibaba-order-table-route \.alibaba-product-list\.compact \.alibaba-product-line strong/);
});
