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

function emptyPlatformSummary(platform = "") {
  return {
    platform,
    targetOrderCount: 0,
    matchedOrderCount: 0,
    missingOrderCount: 0,
    collectedAmount: 0,
    coverage: 0,
  };
}

function movementPlatform(movement) {
  return normalizePlatform(movement?.platform || movement?.channelName);
}

function movementOrderNo(movement) {
  return normalizeOrderNo(movement?.platformOrderNo || movement?.referenceNo2 || movement?.orderNo);
}

function movementDateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildPlatformPaymentOrders(movements) {
  const byOrder = new Map();

  for (const movement of movements || []) {
    if (Number(movement?.removeQuantity || 0) <= 0) continue;
    const platform = movementPlatform(movement);
    if (!["Shopee", "Lazada"].includes(platform)) continue;

    const orderNo = movementOrderNo(movement);
    const fallbackKey = [
      movement.stockShopId || "",
      movement.createdAt || "",
      movement.referenceNo || "",
      movement.sku || "",
      movement.removeQuantity || 0,
    ].join("|");
    const key = orderNo ? `${platform}|${orderNo}` : `${platform}|missing|${fallbackKey}`;
    const createdAt = movement.createdAt || "";

    if (!byOrder.has(key)) {
      byOrder.set(key, {
        key,
        platform,
        orderNo,
        platformOrderNo: orderNo,
        packhaiOrderNos: new Set(),
        skus: new Set(),
        productNames: new Set(),
        firstSaleAt: createdAt,
        latestSaleAt: createdAt,
        movementCount: 0,
        totalQuantity: 0,
        collectedAmount: 0,
        currency: "THB",
        paymentSource: "",
        paymentCapturedAt: "",
        orderStatus: "",
        paymentStatus: orderNo ? "missing-seller-data" : "missing-platform-order-no",
      });
    }

    const row = byOrder.get(key);
    row.movementCount += 1;
    row.totalQuantity += Number(movement.removeQuantity || 0);
    if (movement.referenceNo) row.packhaiOrderNos.add(String(movement.referenceNo));
    if (movement.sku) row.skus.add(String(movement.sku).trim().toUpperCase());
    if (movement.productName) row.productNames.add(String(movement.productName).trim());
    if (movementDateValue(createdAt) < movementDateValue(row.firstSaleAt)) row.firstSaleAt = createdAt;
    if (movementDateValue(createdAt) > movementDateValue(row.latestSaleAt)) row.latestSaleAt = createdAt;

    if (movement.platformPaymentStatus === "matched") {
      row.paymentStatus = "matched";
      row.collectedAmount = roundMoney(movement.platformPaymentAmount);
      row.currency = movement.platformPaymentCurrency || "THB";
      row.paymentSource = movement.platformPaymentSource || platformSource(platform);
      row.paymentCapturedAt = movement.platformPaymentCapturedAt || "";
      row.orderStatus = movement.platformPaymentOrderStatus || "";
    }
  }

  return [...byOrder.values()]
    .map((row) => {
      const skus = [...row.skus].filter(Boolean);
      const productNames = [...row.productNames].filter(Boolean);
      const packhaiOrderNos = [...row.packhaiOrderNos].filter(Boolean);
      return {
        ...row,
        packhaiOrderNos,
        skus,
        productNames,
        skuSummary: skus.slice(0, 4).join(", ") + (skus.length > 4 ? ` +${skus.length - 4}` : ""),
        productSummary: productNames.slice(0, 2).join(" / ") + (productNames.length > 2 ? ` +${productNames.length - 2}` : ""),
        packhaiOrderSummary:
          packhaiOrderNos.slice(0, 3).join(", ") + (packhaiOrderNos.length > 3 ? ` +${packhaiOrderNos.length - 3}` : ""),
        totalQuantity: roundMoney(row.totalQuantity),
      };
    })
    .sort(
      (a, b) =>
        movementDateValue(b.latestSaleAt) - movementDateValue(a.latestSaleAt) ||
        `${a.platform}|${a.orderNo}`.localeCompare(`${b.platform}|${b.orderNo}`)
    );
}

function finalizePlatformSummary(summary) {
  summary.missingOrderCount = Math.max(0, summary.targetOrderCount - summary.matchedOrderCount);
  summary.collectedAmount = roundMoney(summary.collectedAmount);
  summary.coverage = summary.targetOrderCount ? summary.matchedOrderCount / summary.targetOrderCount : 0;
  return summary;
}

function buildPlatformPaymentSummary(movements) {
  const summary = emptyPlatformSummary("All");
  const byPlatform = {
    Shopee: emptyPlatformSummary("Shopee"),
    Lazada: emptyPlatformSummary("Lazada"),
  };

  for (const order of buildPlatformPaymentOrders(movements)) {
    if (!order.orderNo) continue;
    const target = byPlatform[order.platform];
    if (!target) continue;
    summary.targetOrderCount += 1;
    target.targetOrderCount += 1;

    if (order.paymentStatus === "matched") {
      const amount = roundMoney(order.collectedAmount);
      summary.matchedOrderCount += 1;
      target.matchedOrderCount += 1;
      summary.collectedAmount += amount;
      target.collectedAmount += amount;
    }
  }

  finalizePlatformSummary(summary);
  Object.values(byPlatform).forEach(finalizePlatformSummary);
  return { ...summary, byPlatform };
}

module.exports = {
  buildPlatformPaymentOrders,
  buildPlatformPaymentSummary,
  buildSellerPaymentIndex,
  enrichMovementWithSellerPayment,
  normalizeOrderNo,
  normalizePaymentRecord,
  normalizePlatform,
  numberValue,
};
