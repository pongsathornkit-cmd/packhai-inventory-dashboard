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

function normalizeOrderNo(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizePlatform(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("shopee")) return "Shopee";
  if (text.includes("lazada")) return "Lazada";
  return "";
}

function platformSource(platform) {
  if (platform === "Shopee") return "Shopee Seller Center";
  if (platform === "Lazada") return "Lazada Seller Center";
  return "";
}

function shopeeMinorMoney(value) {
  const parsed = numberValue(value);
  if (parsed > 100000) return roundMoney(parsed / 100000);
  return roundMoney(parsed);
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function normalizePaymentRecord(record) {
  const platform = normalizePlatform(record.platform || record.source || record.channelName || record.marketplace);
  const orderNo = normalizeOrderNo(
    record.orderNo || record.orderSn || record.orderSN || record.order_id || record.orderId || record.platformOrderNo
  );
  if (!platform || !orderNo) return null;

  const rawPayment = record.payment_info || record.paymentInfo || {};
  const shopeeTotal = rawPayment.total_price ? shopeeMinorMoney(rawPayment.total_price) : 0;
  const amount = firstPositive(
    record.collectedAmount,
    record.collected,
    record.netAmount,
    record.payoutAmount,
    record.totalAmount,
    record.amount,
    shopeeTotal
  );

  return {
    platform,
    orderNo,
    collectedAmount: roundMoney(amount),
    currency: record.currency || rawPayment.currency || "THB",
    status: String(record.status || record.statusString || record.paymentStatus || "").trim(),
    capturedAt: record.capturedAt || record.exportedAt || record.updatedAt || "",
    source: record.source || platformSource(platform),
    rawId: record.id || record.orderId || "",
  };
}

function paymentRecordsFromData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.payments)) return data.payments;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function buildSellerPaymentIndex(data) {
  const byPlatformOrderNo = new Map();
  const records = paymentRecordsFromData(data)
    .map(normalizePaymentRecord)
    .filter(Boolean);

  for (const record of records) {
    const key = `${record.platform}|${record.orderNo}`;
    const current = byPlatformOrderNo.get(key);
    if (!current || record.collectedAmount > current.collectedAmount) byPlatformOrderNo.set(key, record);
  }

  return {
    exportedAt: data?.exportedAt || "",
    rowCount: records.length,
    byPlatformOrderNo,
  };
}

function enrichMovementWithSellerPayment(movement, paymentIndex) {
  const platform = normalizePlatform(movement.channelName || movement.platform);
  const platformOrderNo = normalizeOrderNo(movement.platformOrderNo || movement.referenceNo2);
  const isSaleOut = Number(movement.removeQuantity || 0) > 0;
  const base = {
    ...movement,
    platform,
    platformOrderNo,
    platformPaymentAmount: 0,
    platformPaymentCurrency: "THB",
    platformPaymentSource: "",
    platformPaymentCapturedAt: "",
    platformPaymentOrderStatus: "",
    platformPaymentStatus: isSaleOut ? "missing-seller-data" : "not-sale-out",
  };

  if (!isSaleOut) return base;
  if (!platform || !["Shopee", "Lazada"].includes(platform)) {
    return { ...base, platformPaymentStatus: "non-platform" };
  }
  if (!platformOrderNo) {
    return { ...base, platformPaymentStatus: "missing-platform-order-no" };
  }

  const payment = paymentIndex?.byPlatformOrderNo?.get(`${platform}|${platformOrderNo}`);
  if (!payment) return base;
  return {
    ...base,
    platformPaymentAmount: payment.collectedAmount,
    platformPaymentCurrency: payment.currency || "THB",
    platformPaymentSource: payment.source || platformSource(platform),
    platformPaymentCapturedAt: payment.capturedAt || "",
    platformPaymentOrderStatus: payment.status || "",
    platformPaymentStatus: "matched",
  };
}

module.exports = {
  buildSellerPaymentIndex,
  enrichMovementWithSellerPayment,
  normalizeOrderNo,
  normalizePaymentRecord,
  normalizePlatform,
  numberValue,
};
