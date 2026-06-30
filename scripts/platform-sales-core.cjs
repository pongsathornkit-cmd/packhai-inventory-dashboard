const PLATFORM_NAMES = ["Shopee", "Lazada"];
const DEFAULT_TIME_ZONE = "Asia/Bangkok";

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    return numberValue(value.amount ?? value.value ?? value.text ?? value.total);
  }
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB|฿/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlatform(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("shopee")) return "Shopee";
  if (text.includes("lazada")) return "Lazada";
  return "";
}

function dateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dateKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDaysKey(key, days) {
  const [year, month, day] = String(key || "")
    .split("-")
    .map((item) => Number(item));
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startKey, endKey) {
  const parse = (key) => {
    const [year, month, day] = String(key || "")
      .split("-")
      .map((item) => Number(item));
    if (!year || !month || !day) return NaN;
    return Date.UTC(year, month - 1, day);
  };
  const start = parse(startKey);
  const end = parse(endKey);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return Math.round((end - start) / 86400000);
}

function saleDate(order) {
  return (
    order?.latestSaleAt ||
    order?.firstSaleAt ||
    order?.saleAt ||
    order?.paymentCapturedAt ||
    order?.capturedAt ||
    order?.createdAt ||
    ""
  );
}

function emptyPlatformSales(platform) {
  return {
    platform,
    orderCount: 0,
    salesAmount: 0,
    quantity: 0,
    averageOrderValue: 0,
    salesShare: 0,
    latestSaleAt: "",
  };
}

function normalizeSalesOrder(order, timeZone) {
  const platform = normalizePlatform(order?.platform || order?.source || order?.paymentSource);
  if (!PLATFORM_NAMES.includes(platform)) return null;
  const amount = roundMoney(numberValue(order?.collectedAmount));
  if (String(order?.paymentStatus || "").trim() !== "matched" || amount <= 0) return null;
  const soldAt = saleDate(order);
  const soldAtKey = dateKey(soldAt, timeZone);
  if (!soldAtKey) return null;
  return {
    platform,
    orderNo: String(order?.orderNo || order?.platformOrderNo || "").trim(),
    packhaiOrderSummary: String(order?.packhaiOrderSummary || "").trim(),
    skuSummary: String(order?.skuSummary || "").trim(),
    productSummary: String(order?.productSummary || "").trim(),
    totalQuantity: roundMoney(numberValue(order?.totalQuantity)),
    collectedAmount: amount,
    currency: order?.currency || "THB",
    latestSaleAt: soldAt,
    saleDate: soldAtKey,
    paymentCapturedAt: order?.paymentCapturedAt || "",
    orderStatus: order?.orderStatus || "",
  };
}

function buildPlatformSalesDashboard(orders = [], options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const now = options.now || new Date();
  const nowKey = dateKey(now, timeZone);
  const dailyWindowDays = Math.max(1, Math.floor(Number(options.dailyWindowDays || 14)));
  const recentLimit = Math.max(1, Math.floor(Number(options.recentLimit || 12)));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const byPlatform = {
    Shopee: emptyPlatformSales("Shopee"),
    Lazada: emptyPlatformSales("Lazada"),
  };
  const dailyMap = new Map();
  const normalizedOrders = (orders || [])
    .map((order) => normalizeSalesOrder(order, timeZone))
    .filter(Boolean);

  for (let offset = dailyWindowDays - 1; offset >= 0; offset -= 1) {
    const key = addDaysKey(nowKey, -offset);
    dailyMap.set(key, {
      date: key,
      Shopee: 0,
      Lazada: 0,
      total: 0,
      orderCount: 0,
    });
  }

  const summary = {
    orderCount: 0,
    totalSalesAmount: 0,
    averageOrderValue: 0,
    todaySalesAmount: 0,
    last7SalesAmount: 0,
    last30SalesAmount: 0,
    latestSaleAt: "",
    liveSource: "Seller platform payments",
  };

  normalizedOrders.forEach((order) => {
    const amount = numberValue(order.collectedAmount);
    summary.orderCount += 1;
    summary.totalSalesAmount += amount;
    if (!summary.latestSaleAt || dateValue(order.latestSaleAt) > dateValue(summary.latestSaleAt)) {
      summary.latestSaleAt = order.latestSaleAt || "";
    }

    const platform = byPlatform[order.platform];
    platform.orderCount += 1;
    platform.salesAmount += amount;
    platform.quantity += numberValue(order.totalQuantity);
    if (!platform.latestSaleAt || dateValue(order.latestSaleAt) > dateValue(platform.latestSaleAt)) {
      platform.latestSaleAt = order.latestSaleAt || "";
    }

    const diffDays = daysBetween(order.saleDate, nowKey);
    if (diffDays === 0) summary.todaySalesAmount += amount;
    if (diffDays >= 0 && diffDays < 7) summary.last7SalesAmount += amount;
    if (diffDays >= 0 && diffDays < 30) summary.last30SalesAmount += amount;

    const daily = dailyMap.get(order.saleDate);
    if (daily) {
      daily[order.platform] = roundMoney(numberValue(daily[order.platform]) + amount);
      daily.total = roundMoney(numberValue(daily.total) + amount);
      daily.orderCount += 1;
    }
  });

  summary.totalSalesAmount = roundMoney(summary.totalSalesAmount);
  summary.todaySalesAmount = roundMoney(summary.todaySalesAmount);
  summary.last7SalesAmount = roundMoney(summary.last7SalesAmount);
  summary.last30SalesAmount = roundMoney(summary.last30SalesAmount);
  summary.averageOrderValue = summary.orderCount ? roundMoney(summary.totalSalesAmount / summary.orderCount) : 0;

  PLATFORM_NAMES.forEach((platformName) => {
    const item = byPlatform[platformName];
    item.salesAmount = roundMoney(item.salesAmount);
    item.quantity = roundMoney(item.quantity);
    item.averageOrderValue = item.orderCount ? roundMoney(item.salesAmount / item.orderCount) : 0;
    item.salesShare = summary.totalSalesAmount ? item.salesAmount / summary.totalSalesAmount : 0;
  });

  const dailySeries = [...dailyMap.values()].map((item) => ({
    ...item,
    Shopee: roundMoney(item.Shopee),
    Lazada: roundMoney(item.Lazada),
    total: roundMoney(item.total),
  }));

  const recentOrders = [...normalizedOrders]
    .sort((a, b) => dateValue(b.latestSaleAt) - dateValue(a.latestSaleAt) || b.collectedAmount - a.collectedAmount)
    .slice(0, recentLimit);

  return {
    generatedAt,
    timeZone,
    nowKey,
    windowDays: dailyWindowDays,
    summary,
    byPlatform,
    platformRanking: PLATFORM_NAMES.map((platform) => byPlatform[platform]).sort(
      (a, b) => b.salesAmount - a.salesAmount || b.orderCount - a.orderCount
    ),
    dailySeries,
    recentOrders,
  };
}

module.exports = {
  buildPlatformSalesDashboard,
};
