const fs = require("fs");
const path = require("path");
const { openAuthContext } = require("./browser-auth-state.cjs");
const { boolEnv } = require("./playwright-runtime.cjs");
const { buildFlowaccountStockOutput, numberValue } = require("./flowaccount-stock-transform.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const dataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : path.join(projectRoot, "data");
const outputFile = process.env.FLOWACCOUNT_STOCK_OUTPUT
  ? path.resolve(process.env.FLOWACCOUNT_STOCK_OUTPUT)
  : path.join(dataDir, "flowaccount_stock_selected_warehouses.json");

const legacyFlowProfile = path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada");
const FLOW_PROFILE =
  process.env.FLOW_PROFILE ||
  (fs.existsSync(legacyFlowProfile) ? legacyFlowProfile : path.join(projectRoot, "browser-profiles", "flowaccount"));
const FLOW_URL = "https://advance.flowaccount.com/N8387296/business/reports/inventory";
const REPORT_BASE = process.env.FLOW_REPORT_BASE || "https://report-canary.flowaccount.com/api/th";
const REPORT_NAME = process.env.FLOW_REPORT_NAME || "groupStockReport";
const headless = boolEnv("SELLER_HEADLESS", false);
const WAREHOUSES = [
  { id: 491661, name: "คลัง ซ.เจริญกิจ", apiName: "คลังซ.เจริญกิจ" },
  { id: 491662, name: "คลัง สุขสวัสดิ์", apiName: "คลังสุขสวัสดิ์" },
];

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
  const session = await openAuthContext({
    kind: "flowaccount",
    persistentDir: FLOW_PROFILE,
    headless,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      ...(headless ? [] : ["--window-position=-32000,-32000"]),
    ],
    viewport: headless ? { width: 1365, height: 900 } : null,
  });
  const ctx = session.context;
  try {
    const profileCookies = cookieArrayToObject(await ctx.cookies(["https://advance.flowaccount.com"]));
    if (profileCookies.u1) {
      return {
        url: FLOW_URL,
        title: "FlowAccount",
        cookies: profileCookies,
      };
    }

    const page = session.page;
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
    await session.close();
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

async function main() {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const date = process.env.FLOWACCOUNT_SYNC_DATE || todayBangkok();
  const session = await launchAndGetCookies();
  const cookies = session.cookies;

  const warehouseResults = [];
  for (const warehouse of WAREHOUSES) {
    warehouseResults.push(await fetchWarehouseRows(cookies, warehouse, date));
  }

  const output = buildFlowaccountStockOutput({
    exportedAt: new Date().toISOString(),
    source: FLOW_URL,
    syncDate: date,
    warehouseResults,
  });

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputFile,
        date,
        rows: output.rowCount,
        rawRows: output.rawRowCount,
        uniqueSkuCount: output.uniqueSkuCount,
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
