const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPlatformSalesDashboard } = require("../scripts/platform-sales-core.cjs");

test("builds realtime platform sales metrics from matched seller payment orders only", () => {
  const dashboard = buildPlatformSalesDashboard(
    [
      {
        platform: "Shopee",
        orderNo: "SP-1",
        paymentStatus: "matched",
        collectedAmount: 1000,
        latestSaleAt: "2026-06-30T02:30:00.000Z",
        paymentCapturedAt: "2026-06-30T03:00:00.000Z",
        totalQuantity: 2,
        skuSummary: "AAA",
      },
      {
        platform: "Lazada",
        orderNo: "LZ-1",
        paymentStatus: "matched",
        collectedAmount: 500,
        latestSaleAt: "2026-06-29T07:00:00.000Z",
        totalQuantity: 1,
        skuSummary: "BBB",
      },
      {
        platform: "Shopee",
        orderNo: "SP-MISSING",
        paymentStatus: "missing-seller-data",
        collectedAmount: 9000,
        latestSaleAt: "2026-06-30T04:00:00.000Z",
      },
      {
        platform: "Manual",
        orderNo: "M-1",
        paymentStatus: "matched",
        collectedAmount: 120,
        latestSaleAt: "2026-06-30T01:00:00.000Z",
      },
    ],
    {
      now: "2026-06-30T12:00:00.000Z",
      dailyWindowDays: 3,
      recentLimit: 2,
      generatedAt: "2026-06-30T12:00:00.000Z",
    }
  );

  assert.equal(dashboard.summary.orderCount, 2);
  assert.equal(dashboard.summary.totalSalesAmount, 1500);
  assert.equal(dashboard.summary.averageOrderValue, 750);
  assert.equal(dashboard.summary.todaySalesAmount, 1000);
  assert.equal(dashboard.summary.last7SalesAmount, 1500);
  assert.equal(dashboard.byPlatform.Shopee.orderCount, 1);
  assert.equal(dashboard.byPlatform.Shopee.salesAmount, 1000);
  assert.equal(dashboard.byPlatform.Shopee.salesShare, 2 / 3);
  assert.equal(dashboard.byPlatform.Lazada.orderCount, 1);
  assert.equal(dashboard.byPlatform.Lazada.salesAmount, 500);
  assert.deepEqual(
    dashboard.dailySeries.map((item) => [item.date, item.Shopee, item.Lazada, item.total]),
    [
      ["2026-06-28", 0, 0, 0],
      ["2026-06-29", 0, 500, 500],
      ["2026-06-30", 1000, 0, 1000],
    ]
  );
  assert.deepEqual(
    dashboard.recentOrders.map((item) => item.orderNo),
    ["SP-1", "LZ-1"]
  );
});

test("dashboard source exposes realtime platform sales UI hooks", () => {
  const fs = require("fs");
  const path = require("path");
  const projectRoot = path.resolve(__dirname, "..");
  const template = fs.readFileSync(path.join(projectRoot, "src", "index.template.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");

  assert.match(template, /href="#platform-sales"/);
  assert.match(template, /id="platformSalesDashboard"/);
  assert.match(app, /PLATFORM_SALES_REFRESH_MS/);
  assert.match(app, /function\s+renderPlatformSalesDashboard/);
  assert.match(app, /function\s+startPlatformSalesRealtimeRefresh/);
  assert.match(app, /loadSupabaseDashboardState\(false\)/);
});
