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

function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .replace(/^[\[\(\{]+/, "")
    .replace(/[\]\)\}]+$/, "")
    .trim()
    .toUpperCase();
}

function compactSku(value) {
  return normalizeSku(value).replace(/[\s\-_/.[\](){}]+/g, "");
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

function normalizePaymentItem(item) {
  const skuText = firstText(
    item.sku,
    item.skuText,
    item.sellerSku,
    item.shopSku,
    item.itemSku,
    item.modelSku,
    item.productCode
  );
  const quantity = firstPositive(item.quantity, item.amount, item.qty, item.itemQuantity) || 1;
  const unitPrice = firstPositive(
    item.unitPrice,
    item.price,
    item.itemPrice,
    item.paidPrice,
    item.actualPrice,
    item.sellingPrice,
    item.discountedPrice,
    item.modelDiscountedPrice
  );
  const lineAmount =
    firstPositive(
      item.lineAmount,
      item.itemAmount,
      item.totalLineAmount,
      item.totalAmount,
      item.totalPrice,
      item.totalPaidPrice,
      item.paidAmount,
      item.actualAmount,
      item.subtotal
    ) || (unitPrice > 0 ? unitPrice * quantity : 0);
  return {
    skuText,
    sku: normalizeSku(skuText),
    compactSku: compactSku(skuText),
    name: String(item.name || item.productName || item.title || "").trim(),
    quantity: roundMoney(quantity),
    unitPrice: roundMoney(unitPrice),
    lineAmount: roundMoney(lineAmount),
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizePaymentItems(record) {
  const rawItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.orderItems)
    ? record.orderItems
    : Array.isArray(record.lines)
    ? record.lines
    : [];
  return rawItems.map(normalizePaymentItem).filter((item) => item.sku || item.name || item.quantity || item.lineAmount);
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
    items: normalizePaymentItems(record),
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

function paymentItemGroups(payment) {
  const groups = new Map();
  for (const item of payment?.items || []) {
    const key = item.compactSku || compactSku(item.sku);
    if (!key) continue;
    const current = groups.get(key) || {
      sku: item.sku,
      compactSku: key,
      quantity: 0,
      lineAmount: 0,
      names: new Set(),
    };
    current.quantity += numberValue(item.quantity);
    current.lineAmount += numberValue(item.lineAmount);
    if (item.name) current.names.add(item.name);
    groups.set(key, current);
  }
  return [...groups.values()].map((item) => ({
    ...item,
    quantity: roundMoney(item.quantity),
    lineAmount: roundMoney(item.lineAmount),
    names: [...item.names],
  }));
}

function allocatePaymentToMovement(payment, movement) {
  const orderAmount = roundMoney(payment?.collectedAmount || 0);
  const movementSku = compactSku(movement.sku || movement.productCode || movement.productSKU || movement.productName);
  const quantity = firstPositive(movement.removeQuantity, movement.quantity, 1) || 1;
  const groups = paymentItemGroups(payment);
  const totalLineAmount = groups.reduce((sum, item) => sum + numberValue(item.lineAmount), 0);
  const matched = groups.find((item) => item.compactSku && item.compactSku === movementSku);

  if (!groups.length) {
    return {
      amount: orderAmount,
      orderAmount,
      status: "matched",
      method: "order-total-no-item-lines",
      itemSku: "",
    };
  }
  if (!matched) {
    return {
      amount: 0,
      orderAmount,
      status: "matched-item-not-found",
      method: "no-matching-sku-line",
      itemSku: "",
    };
  }

  const uniqueSkuCount = new Set(groups.map((item) => item.compactSku).filter(Boolean)).size;
  const itemQuantity = Math.max(1, numberValue(matched.quantity));
  if (numberValue(matched.lineAmount) > 0 && totalLineAmount > 0) {
    const itemOrderShare = orderAmount > 0 ? orderAmount * (numberValue(matched.lineAmount) / totalLineAmount) : matched.lineAmount;
    return {
      amount: roundMoney(itemOrderShare * (quantity / itemQuantity)),
      orderAmount,
      status: "matched",
      method: "sku-line-amount",
      itemSku: matched.sku,
    };
  }
  if (uniqueSkuCount === 1) {
    return {
      amount: roundMoney(orderAmount * (quantity / itemQuantity)),
      orderAmount,
      status: "matched",
      method: "single-sku-order-total",
      itemSku: matched.sku,
    };
  }
  return {
    amount: 0,
    orderAmount,
    status: "matched-item-amount-missing",
    method: "multi-sku-line-amount-missing",
    itemSku: matched.sku,
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
    platformPaymentOrderAmount: 0,
    platformPaymentSource: "",
    platformPaymentCapturedAt: "",
    platformPaymentOrderStatus: "",
    platformPaymentStatus: isSaleOut ? "missing-seller-data" : "not-sale-out",
    platformPaymentAllocationMethod: "",
    platformPaymentMatchedSku: "",
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
  const allocation = allocatePaymentToMovement(payment, movement);
  return {
    ...base,
    platformPaymentAmount: allocation.amount,
    platformPaymentOrderAmount: allocation.orderAmount,
    platformPaymentCurrency: payment.currency || "THB",
    platformPaymentSource: payment.source || platformSource(platform),
    platformPaymentCapturedAt: payment.capturedAt || "",
    platformPaymentOrderStatus: payment.status || "",
    platformPaymentStatus: allocation.status,
    platformPaymentAllocationMethod: allocation.method,
    platformPaymentMatchedSku: allocation.itemSku,
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

    if (movement.platformPaymentStatus === "matched" || numberValue(movement.platformPaymentOrderAmount) > 0) {
      row.paymentStatus = "matched";
      row.collectedAmount = Math.max(
        row.collectedAmount,
        roundMoney(movement.platformPaymentOrderAmount || movement.platformPaymentAmount)
      );
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

function buildInventoryValueIndex(inventoryRows = []) {
  const byStockShopId = new Map();
  const bySku = new Map();
  const byCompactSku = new Map();

  for (const row of inventoryRows || []) {
    const sku = normalizeSku(row?.sku || row?.productCode || row?.productSKU || row?.productName);
    const compact = compactSku(sku);
    const price = roundMoney(numberValue(row?.price || row?.salePrice || row?.unitPrice || row?.sellingPrice));
    const entry = {
      sku,
      compactSku: compact,
      productName: String(row?.name || row?.productName || row?.sourceTitle || "").trim(),
      price,
      priceSource: row?.priceSource || row?.sourceName || "",
      imageUrl: row?.imageUrl || "",
    };
    const stockShopId = String(row?.stockShopId || row?.stockShopID || row?.stock_shop_id || "").trim();
    if (stockShopId && (price > 0 || !byStockShopId.has(stockShopId))) byStockShopId.set(stockShopId, entry);
    if (sku && (price > 0 || !bySku.has(sku))) bySku.set(sku, entry);
    if (compact && (price > 0 || !byCompactSku.has(compact))) byCompactSku.set(compact, entry);
  }

  return { byStockShopId, bySku, byCompactSku };
}

function movementValueCandidate(movement, inventoryIndex) {
  const stockShopId = String(movement?.stockShopId || movement?.stockShopID || movement?.stock_shop_id || "").trim();
  const sku = normalizeSku(movement?.sku || movement?.productCode || movement?.productSKU || movement?.productName);
  const compact = compactSku(sku);
  const byStockShopId = stockShopId ? inventoryIndex.byStockShopId.get(stockShopId) : null;
  const bySku = sku ? inventoryIndex.bySku.get(sku) : null;
  const byCompact = compact ? inventoryIndex.byCompactSku.get(compact) : null;
  const fallbackPrice = roundMoney(numberValue(movement?.price || movement?.salePrice || movement?.unitPrice || movement?.sellingPrice));
  const fallback = {
    sku,
    compactSku: compact,
    productName: String(movement?.productName || movement?.name || "").trim(),
    price: fallbackPrice,
    priceSource: "",
    imageUrl: "",
  };
  return [byStockShopId, bySku, byCompact, fallback].find((item) => item && numberValue(item.price) > 0) || byStockShopId || bySku || byCompact || fallback;
}

function uncollectedReason(movement) {
  if (Number(movement?.removeQuantity || 0) <= 0) return "";
  const platform = movementPlatform(movement);
  if (!["Shopee", "Lazada"].includes(platform)) return "";
  const status = String(movement?.platformPaymentStatus || "").trim();
  if (status === "matched" && numberValue(movement?.platformPaymentAmount) > 0) return "";
  if (status === "matched") return "matched-zero-amount";
  if (
    [
      "missing-seller-data",
      "missing-platform-order-no",
      "matched-item-amount-missing",
      "matched-item-not-found",
    ].includes(status)
  ) {
    return status;
  }
  return status || "missing-seller-data";
}

function emptyUncollectedBucket(key = "") {
  return {
    key,
    rowCount: 0,
    orderCount: 0,
    totalQuantity: 0,
    estimatedAmount: 0,
    latestStockOutAt: "",
  };
}

function updateUncollectedBucket(bucket, row, orderKeys) {
  bucket.rowCount += 1;
  bucket.totalQuantity += numberValue(row.quantity);
  bucket.estimatedAmount += numberValue(row.estimatedAmount);
  if (!bucket.latestStockOutAt || movementDateValue(row.stockOutAt) > movementDateValue(bucket.latestStockOutAt)) {
    bucket.latestStockOutAt = row.stockOutAt || "";
  }
  orderKeys.add(row.orderKey);
}

function finalizeUncollectedBucket(bucket, orderKeys) {
  bucket.orderCount = orderKeys.size;
  bucket.totalQuantity = roundMoney(bucket.totalQuantity);
  bucket.estimatedAmount = roundMoney(bucket.estimatedAmount);
  return bucket;
}

function buildUncollectedStockDeductionReport(movements = [], inventoryRows = []) {
  const inventoryIndex = buildInventoryValueIndex(inventoryRows);
  const rows = [];
  const summary = emptyUncollectedBucket("All");
  const summaryOrderKeys = new Set();
  const byPlatform = {
    Shopee: emptyUncollectedBucket("Shopee"),
    Lazada: emptyUncollectedBucket("Lazada"),
  };
  const platformOrderKeys = {
    Shopee: new Set(),
    Lazada: new Set(),
  };
  const byReason = {};
  const reasonOrderKeys = {};

  for (const movement of movements || []) {
    const reason = uncollectedReason(movement);
    if (!reason) continue;
    const platform = movementPlatform(movement);
    const platformOrderNo = movementOrderNo(movement);
    const quantity = roundMoney(numberValue(movement?.removeQuantity));
    const valueCandidate = movementValueCandidate(movement, inventoryIndex);
    const price = roundMoney(numberValue(valueCandidate.price));
    const stockOutAt = movement?.createdAt || movement?.created || "";
    const fallbackKey = [
      movement?.stockShopId || "",
      stockOutAt,
      movement?.referenceNo || "",
      movement?.sku || "",
      quantity,
    ].join("|");
    const orderKey = platformOrderNo ? `${platform}|${platformOrderNo}` : `${platform}|missing|${fallbackKey}`;
    const row = {
      key: `${orderKey}|${movement?.stockShopId || ""}|${movement?.referenceNo || ""}|${stockOutAt}|${movement?.sku || ""}`,
      orderKey,
      stockShopId: movement?.stockShopId || movement?.stockShopID || "",
      sku: normalizeSku(movement?.sku || movement?.productCode || valueCandidate.sku),
      productName: String(movement?.productName || movement?.name || valueCandidate.productName || "").trim(),
      platform,
      platformOrderNo,
      packhaiOrderNo: movement?.referenceNo || "",
      stockOutAt,
      quantity,
      price,
      priceSource: valueCandidate.priceSource || "",
      estimatedAmount: roundMoney(quantity * price),
      sellerOrderAmount: roundMoney(numberValue(movement?.platformPaymentOrderAmount)),
      paymentStatus: movement?.platformPaymentStatus || "",
      reason,
      allocationMethod: movement?.platformPaymentAllocationMethod || "",
      matchedSku: movement?.platformPaymentMatchedSku || "",
      imageUrl: valueCandidate.imageUrl || "",
    };
    rows.push(row);

    updateUncollectedBucket(summary, row, summaryOrderKeys);
    if (byPlatform[platform]) updateUncollectedBucket(byPlatform[platform], row, platformOrderKeys[platform]);
    if (!byReason[reason]) {
      byReason[reason] = emptyUncollectedBucket(reason);
      reasonOrderKeys[reason] = new Set();
    }
    updateUncollectedBucket(byReason[reason], row, reasonOrderKeys[reason]);
  }

  finalizeUncollectedBucket(summary, summaryOrderKeys);
  Object.keys(byPlatform).forEach((platform) => finalizeUncollectedBucket(byPlatform[platform], platformOrderKeys[platform]));
  Object.keys(byReason).forEach((reason) => finalizeUncollectedBucket(byReason[reason], reasonOrderKeys[reason]));

  rows.sort(
    (a, b) =>
      numberValue(b.estimatedAmount) - numberValue(a.estimatedAmount) ||
      movementDateValue(b.stockOutAt) - movementDateValue(a.stockOutAt) ||
      `${a.platform}|${a.platformOrderNo}|${a.sku}`.localeCompare(`${b.platform}|${b.platformOrderNo}|${b.sku}`)
  );

  return {
    summary: {
      ...summary,
      byPlatform,
      byReason,
    },
    rows,
  };
}

module.exports = {
  buildUncollectedStockDeductionReport,
  buildPlatformPaymentOrders,
  buildPlatformPaymentSummary,
  buildSellerPaymentIndex,
  enrichMovementWithSellerPayment,
  normalizeOrderNo,
  normalizePaymentRecord,
  normalizePlatform,
  numberValue,
};
