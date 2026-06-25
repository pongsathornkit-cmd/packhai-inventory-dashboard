const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const outputFile = path.join(workspaceRoot, "packhai_stock_20260622.json");
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
    if (attempt < 3 && response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return postStock(pathname, body, attempt + 1);
    }
    throw new Error(`${pathname} failed ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

async function fetchStockSummary(date) {
  const take = 500;
  const rows = [];
  let skip = 0;
  let total = null;

  while (total == null || skip < total) {
    const data = await postStock("Stock/get-summarize-stock-balance-by-date-v2", {
      brand: null,
      shopID: [config.shopId],
      warehouseID: config.warehouseId,
      startDate: date,
      endDate: date,
      isIncludeNonMovementStock: true,
      skip,
      take,
    });
    total = numberValue(data.totalResult);
    rows.push(...(data.data || []));
    skip += take;
  }

  return rows;
}

function mapStockRow(row) {
  const sku = normalizeSku(row.sku || row.productCode || row.productSKU || row.productMasterSku);
  const quantity = numberValue(row.quantityRemain ?? row.quantity ?? row.stock);
  const waiting = numberValue(row.quantityOrder ?? row.waiting ?? row.orderQuantity);
  const waitImport = numberValue(row.quantityImport ?? row.waitImport ?? row.waitingImport);
  const available = row.quantityAvailable != null ? numberValue(row.quantityAvailable) : quantity - waiting;

  return {
    sku,
    name: String(row.name || row.productName || row.productMasterName || sku).trim(),
    barcode: String(row.barcode || row.productBarcode || "").trim(),
    prop: String(row.prop || row.optionName || row.productOption || "").trim(),
    quantity,
    waiting,
    waitImport,
    available,
  };
}

async function main() {
  const date = process.env.PACKHAI_SYNC_DATE || todayBangkok();
  const apiRows = await fetchStockSummary(date);
  const rows = apiRows.map(mapStockRow).filter((row) => row.sku);
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
    rows,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputFile, date, rows: rows.length, uniqueSkuCount: skuCounts.size }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
