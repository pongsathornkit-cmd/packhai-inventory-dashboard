const ALIBABA_PAID_ORDER_STATUSES = [
  "Waiting for remaining balance payment",
  "Waiting for supplier to ship",
  "Waiting for delivery confirmation",
  "Waiting for buyer to confirm modified order",
  "Insufficient balance payment",
  "Order completed",
  "Shipment Started",
  "Shipment partially dispatched",
];

const statusSet = new Set(ALIBABA_PAID_ORDER_STATUSES.map(normalizeStatus));

function normalizeStatus(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function statusLabel(value) {
  const normalized = normalizeStatus(value);
  return ALIBABA_PAID_ORDER_STATUSES.find((status) => normalizeStatus(status) === normalized) || String(value || "").trim();
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|USD|CNY|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function thaiDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function orderStatus(order) {
  return statusLabel(firstText(order.status, order.orderStatus, order.statusLabel, order.tradeStatus));
}

function normalizeProduct(product, index) {
  return {
    rowNo: index + 1,
    title: firstText(product.title, product.productTitle, product.productName, product.name, product.itemName),
    skuText: firstText(product.skuText, product.sku, product.variation, product.specification, product.optionText),
    quantity: numberValue(product.quantity ?? product.qty ?? product.itemCount),
    productUrl: firstText(product.productUrl, product.url, product.link),
    imageUrl: firstText(
      product.imageUrl,
      product.productImageUrl,
      product.thumbnailUrl,
      product.thumbUrl,
      product.image,
      product.imageSrc,
      product.picUrl,
      product.imgUrl
    ),
  };
}

function normalizeProducts(order) {
  const productLists = [
    order.detailProducts,
    order.productDetails,
    order.products,
    order.items,
    order.orderItems,
    order.productList,
  ].filter(Array.isArray);

  let bestProducts = [];
  for (const productList of productLists) {
    const normalized = productList
      .map(normalizeProduct)
      .filter((product) => product.title || product.skuText || product.productUrl || product.imageUrl);
    if (normalized.length > bestProducts.length) bestProducts = normalized;
  }
  return bestProducts;
}

function mergeAlibabaOrderDetailProducts(order = {}, detail = {}) {
  const currentProducts = normalizeProducts(order);
  const detailProducts = normalizeProducts(detail);
  const useDetailProducts = detailProducts.length > currentProducts.length;
  if (!useDetailProducts) {
    return {
      ...order,
      products: currentProducts,
    };
  }

  return {
    ...order,
    products: detailProducts,
    listPreviewProductCount: currentProducts.length,
    productDetailCapturedAt: firstText(detail.capturedAt, detail.productDetailCapturedAt, order.productDetailCapturedAt),
    productDetailCapturedUrl: firstText(
      detail.capturedUrl,
      detail.sourceUrl,
      detail.detailUrl,
      detail.url,
      order.productDetailCapturedUrl
    ),
    productDetailSource: "Alibaba order detail",
  };
}

function statusGroup(status) {
  const normalized = normalizeStatus(status);
  if (normalized.includes("remaining balance") || normalized.includes("insufficient balance")) return "balance";
  if (normalized.includes("supplier to ship")) return "supplier-ship";
  if (normalized.includes("shipment")) return "shipment";
  if (normalized.includes("delivery confirmation")) return "delivery";
  if (normalized.includes("confirm modified")) return "modified";
  if (normalized.includes("completed")) return "completed";
  return "other";
}

function normalizeOrder(order, index) {
  const status = orderStatus(order);
  const products = normalizeProducts(order);
  const productTitleSummary = products
    .map((product) => product.title)
    .filter(Boolean)
    .join(" / ");
  const orderAmount = numberValue(order.orderAmount ?? order.amount ?? order.totalAmount ?? order.total);
  const paidAmount = numberValue(order.paidAmount ?? order.paymentAmount ?? order.paid ?? order.orderPaidAmount);
  const balanceAmount = numberValue(order.balanceAmount ?? order.remainingBalance ?? order.balanceDue);
  const itemCount =
    numberValue(order.itemCount ?? order.productCount ?? order.quantity) ||
    products.reduce((sum, product) => sum + numberValue(product.quantity), 0);
  const orderDate = firstText(order.orderDate, order.createdAt, order.createTime, order.orderedAt);
  const expectedShipDate = firstText(order.expectedShipDate, order.shipBy, order.shipBefore, order.supplierShipDeadline);
  const updatedAt = firstText(order.updatedAt, order.modifiedAt, order.lastUpdatedAt, order.capturedAt, orderDate);
  const capturedAt = firstText(order.capturedAt, order.captureAt, order.snapshotAt);

  return {
    rowNo: index + 1,
    orderNo: firstText(order.orderNo, order.orderId, order.id, order.tradeId),
    supplierName: firstText(order.supplierName, order.supplier, order.sellerName, order.companyName),
    status,
    statusGroup: statusGroup(status),
    orderDate,
    orderDateLabel: thaiDateTime(orderDate),
    expectedShipDate,
    expectedShipDateLabel: thaiDateTime(expectedShipDate),
    updatedAt,
    updatedAtLabel: thaiDateTime(updatedAt),
    currency: firstText(order.currency, "USD"),
    orderAmount: roundMoney(orderAmount),
    paidAmount: roundMoney(paidAmount || orderAmount),
    balanceAmount: roundMoney(balanceAmount),
    itemCount,
    skuSummary: firstText(order.skuSummary, productTitleSummary, order.productName, order.productTitle, order.itemName),
    products,
    trackingNo: firstText(order.trackingNo, order.trackingNumber, order.shipmentNo),
    logisticsProvider: firstText(order.logisticsProvider, order.carrier, order.shippingProvider),
    buyerAccount: firstText(order.buyerAccount, order.buyer, order.account),
    orderUrl: firstText(order.orderUrl, order.url, order.link),
    captureUrl: firstText(order.captureUrl, order.captureImageUrl, order.screenshotUrl, order.orderScreenshotUrl, order.orderCaptureUrl),
    capturedAt,
    capturedAtLabel: thaiDateTime(capturedAt),
    productDetailCapturedAt: firstText(order.productDetailCapturedAt, order.detailCapturedAt),
    productDetailCapturedUrl: firstText(order.productDetailCapturedUrl, order.detailCapturedUrl),
    productDetailSource: firstText(order.productDetailSource, order.detailSource),
    capturedPage: numberValue(order.capturedPage ?? order.pageNo ?? order.page),
    capturedUrl: firstText(order.capturedUrl, order.sourceUrl),
    note: firstText(order.note, order.remark, order.memo),
  };
}

function emptyAlibabaPurchaseOrders(source = {}) {
  return {
    metadata: {
      source: source.source || "Alibaba purchase orders",
      exportedAt: source.exportedAt || "",
      exportedAtLabel: thaiDateTime(source.exportedAt),
      allowedStatuses: ALIBABA_PAID_ORDER_STATUSES,
    },
    summary: {
      totalOrders: 0,
      totalOrderAmount: 0,
      totalPaidAmount: 0,
      totalBalanceAmount: 0,
      waitingSupplierShip: 0,
      shipmentActive: 0,
      waitingBuyerAction: 0,
      completed: 0,
    },
    statusBreakdown: [],
    rows: [],
  };
}

function buildAlibabaPurchaseOrders(source = {}) {
  const orders = Array.isArray(source.orders) ? source.orders : Array.isArray(source.rows) ? source.rows : [];
  const rows = orders
    .map(normalizeOrder)
    .filter((row) => row.orderNo && statusSet.has(normalizeStatus(row.status)))
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.orderDate || 0).getTime() - new Date(a.updatedAt || a.orderDate || 0).getTime() ||
        a.orderNo.localeCompare(b.orderNo, "en")
    );

  const summary = emptyAlibabaPurchaseOrders(source).summary;
  const statusMap = new Map();
  for (const row of rows) {
    summary.totalOrders += 1;
    summary.totalOrderAmount += row.orderAmount;
    summary.totalPaidAmount += row.paidAmount;
    summary.totalBalanceAmount += row.balanceAmount;
    if (row.statusGroup === "supplier-ship") summary.waitingSupplierShip += 1;
    if (row.statusGroup === "shipment") summary.shipmentActive += 1;
    if (["balance", "delivery", "modified"].includes(row.statusGroup)) summary.waitingBuyerAction += 1;
    if (row.statusGroup === "completed") summary.completed += 1;
    const current = statusMap.get(row.status) || { status: row.status, count: 0, paidAmount: 0, balanceAmount: 0 };
    current.count += 1;
    current.paidAmount += row.paidAmount;
    current.balanceAmount += row.balanceAmount;
    statusMap.set(row.status, current);
  }

  summary.totalOrderAmount = roundMoney(summary.totalOrderAmount);
  summary.totalPaidAmount = roundMoney(summary.totalPaidAmount);
  summary.totalBalanceAmount = roundMoney(summary.totalBalanceAmount);

  const statusBreakdown = [...statusMap.values()]
    .map((item) => ({
      ...item,
      paidAmount: roundMoney(item.paidAmount),
      balanceAmount: roundMoney(item.balanceAmount),
    }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, "en"));

  return {
    metadata: {
      source: source.source || "Alibaba purchase orders",
      exportedAt: source.exportedAt || "",
      exportedAtLabel: thaiDateTime(source.exportedAt),
      allowedStatuses: ALIBABA_PAID_ORDER_STATUSES,
    },
    summary,
    statusBreakdown,
    rows,
  };
}

module.exports = {
  ALIBABA_PAID_ORDER_STATUSES,
  buildAlibabaPurchaseOrders,
  emptyAlibabaPurchaseOrders,
  mergeAlibabaOrderDetailProducts,
  normalizeStatus,
};
