function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    return numberValue(value.text ?? value.value ?? value.stock ?? value.quantity);
  }
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .toUpperCase();
}

function normalizePackhaiDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const isoLike = text.includes("T") ? text : text.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoLike) ? isoLike : `${isoLike}+07:00`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function movementType(row) {
  const addQuantity = numberValue(row.addQuantity);
  const removeQuantity = numberValue(row.removeQuantity);
  if (addQuantity > 0 && removeQuantity > 0) return "เข้า/ออก";
  if (addQuantity > 0) return "นำเข้า";
  if (removeQuantity > 0) return "นำออก";
  return "ปรับยอด";
}

function movementDateValue(row) {
  const date = new Date(row?.createdAt || row?.latestStockMovementAt || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function mapStockMovementRow(row) {
  const stockShopId = numberValue(row.stockID ?? row.stockShopID ?? row.stockShopId);
  const createdAt = normalizePackhaiDateTime(row.created ?? row.createdDatetime);
  const addQuantity = numberValue(row.addQuantity);
  const removeQuantity = numberValue(row.removeQuantity);
  const referenceNo = String(row.referenceNo || "").trim();
  const platformOrderNo = String(row.referenceNo2 || "").trim();
  const channelName = String(row.channelName || "").trim();
  return {
    stockShopId,
    sku: normalizeSku(row.sku || row.productCode || row.productSKU || row.productMasterSku),
    productName: String(row.name || row.productName || row.productMasterName || "").trim(),
    createdAt,
    type: movementType(row),
    description: String(row.description || "").trim(),
    referenceNo,
    platformOrderNo,
    channelName,
    addQuantity,
    removeQuantity,
    totalQuantity: numberValue(row.totalQuantity),
    isSaleOut: removeQuantity > 0 && Boolean(platformOrderNo || referenceNo),
  };
}

function latestMovementFields(row) {
  return {
    latestStockMovementAt: row.createdAt,
    latestStockMovementType: row.type,
    latestStockMovementDescription: row.description,
    latestStockMovementReferenceNo: row.referenceNo,
    latestStockMovementReferenceNo2: row.platformOrderNo,
    latestStockMovementChannelName: row.channelName,
    latestStockMovementAddQuantity: row.addQuantity,
    latestStockMovementRemoveQuantity: row.removeQuantity,
    latestStockMovementTotalQuantity: row.totalQuantity,
  };
}

function buildStockMovementSnapshot(items, options = {}) {
  const rows = (items || [])
    .map(mapStockMovementRow)
    .filter((row) => row.stockShopId && row.createdAt)
    .sort((a, b) => movementDateValue(b) - movementDateValue(a));
  const latestByStockShopId = new Map();
  const rowsByStockShopId = new Map();

  for (const row of rows) {
    if (!rowsByStockShopId.has(row.stockShopId)) rowsByStockShopId.set(row.stockShopId, []);
    rowsByStockShopId.get(row.stockShopId).push(row);
    if (!latestByStockShopId.has(row.stockShopId)) {
      latestByStockShopId.set(row.stockShopId, latestMovementFields(row));
    }
  }

  return {
    startDate: options.startDate || "",
    endDate: options.endDate || "",
    rowCount: rows.length,
    stockShopCount: rowsByStockShopId.size,
    latestByStockShopId,
    rowsByStockShopId,
    rows,
  };
}

function stockSummaryRowsFromMovementSnapshot(snapshot) {
  const rowsByStockShopId = snapshot?.rowsByStockShopId;
  if (!(rowsByStockShopId instanceof Map)) return [];

  return [...rowsByStockShopId.entries()]
    .map(([stockShopId, movements]) => {
      const latest = (movements || [])[0];
      const sku = normalizeSku(latest?.sku);
      if (!stockShopId || !sku) return null;
      const quantity = numberValue(latest.totalQuantity);
      return {
        stockShopID: numberValue(stockShopId),
        sku,
        name: String(latest.productName || sku).trim(),
        quantityRemain: quantity,
        quantityAvailable: quantity,
        quantityOrder: 0,
        quantityImport: 0,
        quantityExport: 0,
        warehouseName: "",
        isNoMovement: false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.stockShopID - b.stockShopID);
}

module.exports = {
  buildStockMovementSnapshot,
  latestMovementFields,
  mapStockMovementRow,
  movementType,
  normalizePackhaiDateTime,
  normalizeSku,
  numberValue,
  stockSummaryRowsFromMovementSnapshot,
};
