const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const outputFile = path.join(workspaceRoot, "flowaccount_stock_selected_warehouses.json");

const FLOW_PROFILE =
  process.env.FLOW_PROFILE || path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada");
const CHROME_EXE =
  process.env.CHROME_EXE || "C:/Users/ASUS/AppData/Local/Google/Chrome/Application/chrome.exe";
const FLOW_URL = "https://advance.flowaccount.com/N8387296/business/reports/inventory";
const REPORT_BASE = process.env.FLOW_REPORT_BASE || "https://report-canary.flowaccount.com/api/th";
const REPORT_NAME = process.env.FLOW_REPORT_NAME || "groupStockReport";
const WAREHOUSES = [
  { id: 491661, name: "คลัง ซ.เจริญกิจ", apiName: "คลังซ.เจริญกิจ" },
  { id: 491662, name: "คลัง สุขสวัสดิ์", apiName: "คลังสุขสวัสดิ์" },
];

function runtimeRequire() {
  const candidates = [
    "C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/node_modules/",
    "C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/",
  ];
  for (const candidate of candidates) {
    try {
      return createRequire(candidate);
    } catch {}
  }
  return require;
}

const { chromium } = runtimeRequire()("playwright-core");

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    return numberValue(value.text ?? value.value ?? value.stock ?? value.quantity ?? value.remaining);
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

function makeHeaders(cookies, contentType = "application/json") {
  const headers = {
    accept: "application/json, text/plain, */*",
    authorization: `Bearer ${cookies.u1}`,
    devicetype: "Web",
    deviceuuid: cookies.DeviceUUID || "",
    origin: "https://advance.flowaccount.com",
    referer: FLOW_URL,
  };
  if (contentType) headers["content-type"] = contentType;
  return headers;
}

function cookieArrayToObject(cookies) {
  return Object.fromEntries((cookies || []).map((cookie) => [cookie.name, cookie.value]));
}

async function launchAndGetCookies() {
  const ctx = await chromium.launchPersistentContext(FLOW_PROFILE, {
    headless: false,
    executablePath: CHROME_EXE,
    args: ["--no-first-run", "--no-default-browser-check", "--window-position=-32000,-32000"],
    viewport: null,
  });
  try {
    const profileCookies = cookieArrayToObject(await ctx.cookies(["https://advance.flowaccount.com"]));
    if (profileCookies.u1) {
      return {
        url: FLOW_URL,
        title: "FlowAccount",
        cookies: profileCookies,
      };
    }

    const page = ctx.pages()[0] || (await ctx.newPage());
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await page.waitForTimeout(1500 * attempt);
      }
    }
    if (lastError) throw lastError;
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      cookies: Object.fromEntries(
        document.cookie
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const i = s.indexOf("=");
            return [s.slice(0, i), s.slice(i + 1)];
          })
      ),
    }));
    if (!state.cookies.u1) throw new Error(`FlowAccount session has no u1 token at ${state.url}`);
    return state;
  } finally {
    await ctx.close();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.ok || json.status === false) {
    throw new Error(`${url} failed ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

async function fetchWarehousePage(cookies, warehouse, currentPage, date) {
  const payload = {
    currentPage,
    pageSize: 100,
    filter: [],
    sortBy: [],
    customDocumentModel: [],
    range: 1,
    filterColumnValue: {},
    startDate: date,
    endDate: date,
    totalRecords: 0,
    searchString: "",
    year: 0,
    month: 0,
    advanceFilter: [
      { columnName: "warehouseId", columnValue: String(warehouse.id), columnPredicateOperator: "And" },
    ],
    filterStatus: 0,
    grandTotalRecords: 0,
    mongoSortBy: [{ name: "ProductName", sortDirection: 1 }],
  };
  return fetchJson(`${REPORT_BASE}/${REPORT_NAME}/report`, {
    method: "POST",
    headers: makeHeaders(cookies),
    body: JSON.stringify(payload),
  });
}

async function fetchWarehouseRows(cookies, warehouse, date) {
  const rows = [];
  let currentPage = 1;
  let total = null;
  let pages = 1;

  while (currentPage <= pages) {
    const json = await fetchWarehousePage(cookies, warehouse, currentPage, date);
    const data = json.data || {};
    const pageRows = Array.isArray(data.list) ? data.list : [];
    rows.push(...pageRows);
    total = numberValue(data.totalRecords || data.total || data.grandTotalRecords || json.total || rows.length);
    pages = Math.max(1, Math.ceil(total / 100));
    if (!pageRows.length && currentPage >= pages) break;
    currentPage += 1;
  }

  return {
    warehouse,
    total: total ?? rows.length,
    rows,
  };
}

function mapReportRow(row, warehouse) {
  const sku = normalizeSku(row.productCode || row.code || row.sku);
  const quantity = numberValue(row.remaining ?? row.remainingStock ?? row.quantity);
  return {
    sku,
    name: String(row.productName || row.name || sku).trim(),
    barcode: String(row.barCode || row.barcode || row.productBarcode || "").trim(),
    prop: "",
    quantity,
    waiting: 0,
    waitImport: 0,
    available: quantity,
    stockSource: "FlowAccount",
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    source: `FlowAccount ${warehouse.name}`,
    productId: row.productId || "",
    productMasterId: row.productMasterId || "",
  };
}

function aggregateRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = `${row.warehouseId}|${row.sku}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...row });
      continue;
    }
    const current = byKey.get(key);
    current.quantity += row.quantity;
    current.available += row.available;
    current.waiting += row.waiting;
  }
  return [...byKey.values()];
}

async function main() {
  const date = process.env.FLOWACCOUNT_SYNC_DATE || todayBangkok();
  const session = await launchAndGetCookies();
  const cookies = session.cookies;

  const warehouseResults = [];
  for (const warehouse of WAREHOUSES) {
    warehouseResults.push(await fetchWarehouseRows(cookies, warehouse, date));
  }

  const rows = aggregateRows(
    warehouseResults.flatMap((result) => result.rows.map((row) => mapReportRow(row, result.warehouse)))
  );
  const skuCounts = new Map();
  for (const row of rows) skuCounts.set(row.sku, (skuCounts.get(row.sku) || 0) + 1);
  const duplicateSkus = [...skuCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sku, count]) => ({ sku, count }));

  const output = {
    exportedAt: new Date().toISOString(),
    source: "https://advance.flowaccount.com/N8387296/business/reports/inventory",
    syncDate: date,
    rowCount: rows.length,
    uniqueSkuCount: skuCounts.size,
    duplicateSkus,
    warehouses: warehouseResults.map((result) => ({
      id: result.warehouse.id,
      name: result.warehouse.name,
      apiName: result.warehouse.apiName,
      reportedTotal: result.total,
      rowCount: result.rows.length,
    })),
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
        warehouses: output.warehouses,
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
