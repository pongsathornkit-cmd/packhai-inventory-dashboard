const fs = require("fs");
const path = require("path");
const {
  buildStockMovementSnapshot,
  normalizeSku,
  numberValue,
  stockSummaryRowsFromMovementSnapshot,
} = require("./packhai-stock-movement-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const dataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : path.join(projectRoot, "data");
const outputFile = process.env.PACKHAI_STOCK_OUTPUT
  ? path.resolve(process.env.PACKHAI_STOCK_OUTPUT)
  : path.join(dataDir, "packhai_stock.json");
const localTokenFile = path.join(projectRoot, ".packhai-token.local");

function readToken() {
  const envToken = String(process.env.PACKHAI_AUTH_TOKEN || "").trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(localTokenFile, "utf8").trim();
  } catch {
    return "";
  }
}

const token = readToken();
if (!token) {
  throw new Error("PACKHAI_AUTH_TOKEN or .packhai-token.local is required to sync Packhai stock.");
}

const config = {
  shopId: Number(process.env.PACKHAI_SHOP_ID || 466),
  warehouseId: Number(process.env.PACKHAI_WAREHOUSE_ID || 1),
};
const includeStockMovements = process.env.PACKHAI_INCLUDE_STOCK_MOVEMENTS !== "0";
const movementStartDate = process.env.PACKHAI_STOCK_MOVEMENT_START_DATE || "2020-01-01";
const movementPageSize = Math.max(100, Number(process.env.PACKHAI_STOCK_MOVEMENT_PAGE_SIZE || 1000));

function todayBangkok() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function postStock(pathname, body, attempt = 1) {
  let response;
  try {
    response = await fetch(`https://stock.packhai-api-88.com/${pathname}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return postStock(pathname, body, attempt + 1);
    }
    throw error;
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} returned non-JSON ${response.status}: ${text.slice(0, 240)}`);
  }

  if (!response.ok || data.status === "error") {
    if (attempt < 3 && (response.status >= 500 || data.status === "error")) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return postStock(pathname, body, attempt + 1);
    }
    throw new Error(`${pathname} failed ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

async function fetchStockSummary(date, options = {}) {
  const take = 500;
  const rows = [];
  let skip = 0;
  let total = null;
  const includeNonMovementStock = options.includeNonMovementStock !== false;

  while (total == null || skip < total) {
    const data = await postStock("Stock/get-summarize-stock-balance-by-date-v2", {
      brand: null,
      shopID: [config.shopId],
      warehouseID: config.warehouseId,
      startDate: date,
      endDate: date,
      isIncludeNonMovementStock: includeNonMovementStock,
      skip,
      take,
    });
    total = numberValue(data.totalResult);
    rows.push(...(data.data || []));
    skip += take;
  }

  return rows;
}

async function fetchStockSummaryWithFallback(date, movement) {
  const attempts = [
    { includeNonMovementStock: true, label: "include non-movement stock" },
    { includeNonMovementStock: false, label: "movement stock only" },
  ];
  const errors = [];

  for (const attempt of attempts) {
    try {
      return {
        rows: await fetchStockSummary(date, attempt),
        fallback: null,
      };
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message || String(error)}`);
    }
  }

  const fallbackRows = stockSummaryRowsFromMovementSnapshot(movement);
  if (!fallbackRows.length) {
    throw new Error(`Packhai stock summary failed and movement fallback is empty. ${errors.join(" | ")}`);
  }

  return {
    rows: fallbackRows,
    fallback: {
      type: "stock-movement-latest-total",
      reason: "Stock summary API failed; used latest stock movement totalQuantity by stockShopID.",
      errors,
      rowCount: fallbackRows.length,
    },
  };
}

async function fetchStockMovements(startDate, endDate) {
  const movementItems = [];
  let skip = 0;
  let total = null;

  while (total == null || skip < total) {
    const data = await postStock("Stock/get-all-stock-statement-balance", {
      brand: null,
      shopID: config.shopId,
      warehouseID: config.warehouseId,
      startDate,
      endDate,
      skip,
      take: movementPageSize,
      isNeedResultCount: true,
    });
    const items = data.items || [];
    total = numberValue(data.resultCount ?? data.totalResult ?? total ?? items.length);
    movementItems.push(...items);

    if (!items.length) break;
    skip += items.length;
  }

  return buildStockMovementSnapshot(movementItems, { startDate, endDate });
}

function mapStockRow(row, latestMovement) {
  const sku = normalizeSku(row.sku || row.productCode || row.productSKU || row.productMasterSku);
  const quantity = numberValue(row.quantityRemain ?? row.quantity ?? row.stock);
  const waiting = numberValue(row.quantityOrder ?? row.waiting ?? row.orderQuantity);
  const waitImport = numberValue(row.quantityImport ?? row.waitImport ?? row.waitingImport);
  const available = row.quantityAvailable != null ? numberValue(row.quantityAvailable) : quantity - waiting;
  const stockShopId = numberValue(row.stockShopID ?? row.stockShopId);

  return {
    stockShopId,
    sku,
    name: String(row.name || row.productName || row.productMasterName || sku).trim(),
    barcode: String(row.barcode || row.productBarcode || "").trim(),
    prop: String(
      row.prop ||
        row.optionName ||
        row.productOption ||
        [row.prop1_description, row.prop2_description, row.prop1Description, row.prop2Description].filter(Boolean).join(" / ")
    ).trim(),
    warehouseName: String(row.warehouseName || "").trim(),
    photoLink: String(row.photoLink || "").trim(),
    isNoMovement: Boolean(row.isNoMovement),
    quantity,
    waiting,
    waitImport,
    available,
    quantityStart: numberValue(row.quantityStart),
    quantityReturn: numberValue(row.quantityReturn),
    quantityImport: numberValue(row.quantityImport),
    quantityExport: numberValue(row.quantityExport),
    ...(latestMovement || {}),
  };
}

async function main() {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const date = process.env.PACKHAI_SYNC_DATE || todayBangkok();
  const movement = includeStockMovements ? await fetchStockMovements(movementStartDate, date) : null;
  const summary = await fetchStockSummaryWithFallback(date, movement);
  if (summary.fallback) {
    console.warn(`Packhai stock summary fallback used: ${summary.fallback.reason}`);
  }
  const rows = summary.rows
    .map((row) => mapStockRow(row, movement?.latestByStockShopId.get(numberValue(row.stockShopID ?? row.stockShopId))))
    .filter((row) => row.sku);
  const skuCounts = new Map();
  for (const row of rows) skuCounts.set(row.sku, (skuCounts.get(row.sku) || 0) + 1);
  const duplicateSkus = [...skuCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sku, count]) => ({ sku, count }));

  const output = {
    exportedAt: new Date().toISOString(),
    source: "https://shop.packhai.com/my-stock",
    rowCount: rows.length,
    uniqueSkuCount: skuCounts.size,
    duplicateSkus,
    stockMovement: movement
      ? {
          source: "https://shop.packhai.com/stock-history",
          endpoint: "Stock/get-all-stock-statement-balance",
          startDate: movement.startDate,
          endDate: movement.endDate,
          rowCount: movement.rowCount,
          stockShopCount: movement.stockShopCount,
          rows: movement.rows,
        }
      : {
          skipped: true,
          reason: "PACKHAI_INCLUDE_STOCK_MOVEMENTS=0",
        },
    stockSummaryFallback: summary.fallback,
    rows,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputFile,
        date,
        rows: rows.length,
        uniqueSkuCount: skuCounts.size,
        movementRows: movement?.rowCount || 0,
        movementStockShopCount: movement?.stockShopCount || 0,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
