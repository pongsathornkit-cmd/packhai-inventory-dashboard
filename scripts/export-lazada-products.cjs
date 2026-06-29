const fs = require("fs");
const path = require("path");
const http = require("http");
const { fetchLazadaSellerData } = require("./seller-direct-api.cjs");
const { openAuthContext } = require("./browser-auth-state.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const dataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : path.join(projectRoot, "data");
const legacySessionDir = path.join(workspaceRoot, "chrome-lazada-cdp-profile");
const sessionDir = process.env.SELLER_SESSION_DIR
  ? path.resolve(process.env.SELLER_SESSION_DIR)
  : fs.existsSync(legacySessionDir)
  ? legacySessionDir
  : path.join(projectRoot, "browser-profiles", "lazada");
const outputDir = process.env.SELLER_COMPARE_DIR
  ? path.resolve(process.env.SELLER_COMPARE_DIR)
  : path.join(dataDir, "seller_compare");
const outputFile = path.join(outputDir, "lazada_products_export.json");
const headless = boolEnv("SELLER_HEADLESS", false);
const cdpEndpoint =
  process.env.LAZADA_CDP_ENDPOINT === "0"
    ? ""
    : process.env.LAZADA_CDP_ENDPOINT || process.env.CDP_ENDPOINT || "http://127.0.0.1:9223";

function normSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.0$/, "")
    .replace(/^'+/, "")
    .toUpperCase();
}

function numberValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function loadPlaywrightRuntime() {
  return require("./playwright-runtime.cjs");
}

function normalizeRow(row) {
  const skuRows = Array.isArray(row.subDataSource) ? row.subDataSource : [];
  const productPrice = row.price || {};
  return {
    productId: row.productId,
    draftId: row.draftId,
    catId: row.catId,
    title: row.itemDesc?.title || "",
    imageUrl: row.itemDesc?.imageUrl || "",
    pdpLink: row.itemDesc?.pdpLink || "",
    statusMark: row.statusMark || "",
    stock: numberValue(row.stock?.text),
    price: productPrice.priceEndValue ?? productPrice.priceStartValue ?? numberValue(productPrice.price),
    specialPrice: firstPositive(
      productPrice.specialPriceEndValue,
      productPrice.specialPriceStartValue,
      productPrice.specialPrice
    ),
    skuRows: skuRows.map((sku) => ({
      skuId: sku.skuId || sku.itemDesc?.skuId || sku.activeStatus?.skuId || "",
      sellerSku: sku.itemDesc?.sellerSku || sku.itemIndex?.copyText || sku.itemIndex?.text || "",
      normalizedSellerSku: normSku(sku.itemDesc?.sellerSku || sku.itemIndex?.copyText || sku.itemIndex?.text),
      stock: numberValue(sku.stock?.text),
      stockStatus: sku.stock?.status || "",
      price: sku.price?.priceEndValue ?? sku.price?.priceStartValue ?? numberValue(sku.price?.price),
      specialPrice: firstPositive(
        sku.price?.specialPriceEndValue,
        sku.price?.specialPriceStartValue,
        sku.price?.specialPrice
      ),
      imageUrl: sku.itemDesc?.skuImg || "",
      variation: sku.variation || "",
      active: sku.activeStatus?.active ?? null,
    })),
  };
}

function endpointJsonUrl(endpoint) {
  return `${String(endpoint || "").replace(/\/+$/, "")}/json/version`;
}

function getJson(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function openCdpSession() {
  if (!cdpEndpoint) return null;
  try {
    const { chromium } = loadPlaywrightRuntime();
    await getJson(endpointJsonUrl(cdpEndpoint));
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const context =
      browser.contexts()[0] ||
      (await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: "th-TH" }));
    const page = await context.newPage();
    return {
      mode: `cdp:${cdpEndpoint}`,
      page,
      close: async () => {
        await page.close().catch(() => {});
        if (typeof browser.disconnect === "function") browser.disconnect();
        else await browser.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

async function openPersistentSession() {
  return openAuthContext({
    kind: "lazada",
    persistentDir: sessionDir,
    headless,
    viewport: { width: 1365, height: 900 },
    locale: "th-TH",
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(headless ? [] : ["--start-maximized"])],
  });
}

async function openSellerSession() {
  return (await openCdpSession()) || (await openPersistentSession());
}

async function prepareProductList(page) {
  page.setDefaultTimeout(60000);
  await page
    .goto("https://sellercenter.lazada.co.th/apps/product/list?tab=online_product", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await page.waitForTimeout(10000);
}

async function isLoginPage(page) {
  const state = await page
    .evaluate(() => ({
      url: location.href,
      title: document.title,
      body: document.body?.innerText || "",
    }))
    .catch(() => ({ url: page.url(), title: "", body: "" }));
  return (
    /\/apps\/seller\/login|\/apps\/register/i.test(state.url) ||
    /login|sign up|password/i.test(`${state.title} ${state.body}`)
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  let exportData = null;
  let sessionMode = "storage-state:direct-api";

  if (process.env.SELLER_DIRECT_API !== "0") {
    try {
      exportData = await fetchLazadaSellerData();
      sessionMode = exportData.sessionMode || sessionMode;
    } catch (error) {
      if (!boolEnv("SELLER_BROWSER_FALLBACK", false)) throw error;
      console.warn(`Lazada direct API failed, falling back to browser: ${error.message}`);
    }
  }

  if (!exportData) {
    let session = await openSellerSession();
    const attempts = [];

    try {
      let page = session.page;
      await prepareProductList(page);

    if ((await isLoginPage(page)) && session.mode.startsWith("cdp:")) {
      attempts.push(`${session.mode} is not logged in`);
      await session.close();
      session = await openPersistentSession();
      page = session.page;
      await prepareProductList(page);
    }

    const loginLike = await page
      .locator("body")
      .innerText({ timeout: 15000 })
      .then((text) => /login|sign up|เข้าสู่ระบบ|สมัครเป็นผู้ขาย|รหัสผ่าน/i.test(text))
      .catch(() => true);
    if (loginLike) {
      throw new Error("Lazada Seller Center is not logged in. Please log in in the opened browser and rerun this script.");
    }

    sessionMode = session.mode;
    exportData = await page.evaluate(async () => {
      function simplify(value) {
        try {
          return JSON.parse(JSON.stringify(value));
        } catch (_) {
          return { string: String(value) };
        }
      }

      function callMtop(api, data) {
        return new Promise((resolve, reject) => {
          if (!window.lib?.mtop?.request) {
            reject(new Error("window.lib.mtop.request is unavailable"));
            return;
          }
          window.lib.mtop.request(
            {
              api,
              v: "1.0",
              type: "GET",
              dataType: "json",
              timeout: 30000,
              H5Request: true,
              data,
            },
            (res) => resolve(simplify(res)),
            (err) => reject(new Error(JSON.stringify(simplify(err))))
          );
        });
      }

      const api = "mtop.lazada.merchant.product.manager.simple.render.list";
      const pageSize = 50;

      async function fetchPage(current) {
        const jsonBody = {
          tab: "online_product",
          table: { sort: {} },
          filter: {},
          pagination: { current, pageSize },
        };
        const bizParam = {
          version: "simple",
          allFormData: { tab: "online_product" },
          type: "simple",
        };
        const response = await callMtop(api, {
          jsonBody: JSON.stringify(jsonBody),
          bizParam: JSON.stringify(bizParam),
        });
        const payload = response?.data?.data;
        const rows = payload?.table?.dataSource || [];
        const pagination = payload?.pagination || {};
        return { current, rows, pagination, responseMeta: { api: response?.api, ret: response?.ret, v: response?.v } };
      }

      const first = await fetchPage(1);
      const total = Number(first.pagination?.total || first.rows.length || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const pages = [first];

      for (let current = 2; current <= totalPages; current += 1) {
        const pageData = await fetchPage(current);
        pages.push(pageData);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return {
        exportedAt: new Date().toISOString(),
        api,
        tab: "online_product",
        pageSize,
        total,
        totalPages,
        pages,
      };
    });
    } finally {
      await session.close();
    }
  }

  const rawRows = exportData.pages.flatMap((pageData) => pageData.rows || []);
  const products = rawRows.map(normalizeRow);
  const skuRows = products.flatMap((product) =>
    product.skuRows.map((sku) => ({
      productId: product.productId,
      catId: product.catId,
      title: product.title,
      pdpLink: product.pdpLink,
      imageUrl: sku.imageUrl || product.imageUrl,
      statusMark: product.statusMark,
      ...sku,
    }))
  );

  const output = {
    exportedAt: exportData.exportedAt,
    source: "lazada_seller_center",
    api: exportData.api,
    tab: exportData.tab,
    counts: {
      reportedTotal: exportData.total,
      pages: exportData.totalPages,
      productRows: products.length,
      skuRows: skuRows.length,
      inStockSkuRows: skuRows.filter((sku) => sku.stock > 0).length,
    },
    sessionMode,
    products,
    skuRows,
    pageMeta: exportData.pages.map((pageData) => ({
      current: pageData.current,
      rowCount: pageData.rows.length,
      pagination: pageData.pagination,
      responseMeta: pageData.responseMeta,
    })),
  };

  fs.writeFileSync(outputFile, JSON.stringify(output), "utf8");
  console.log(JSON.stringify({ ok: true, counts: output.counts, sessionMode: output.sessionMode, outputFile }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
