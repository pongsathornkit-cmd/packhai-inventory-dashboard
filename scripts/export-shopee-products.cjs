const fs = require("fs");
const path = require("path");
const { openAuthContext } = require("./browser-auth-state.cjs");
const { boolEnv } = require("./playwright-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const legacySessionDir = path.join(workspaceRoot, ".codex-seller-browser-session");
const sessionDir = process.env.SHOPEE_SESSION_DIR
  ? path.resolve(process.env.SHOPEE_SESSION_DIR)
  : fs.existsSync(legacySessionDir)
  ? legacySessionDir
  : path.join(projectRoot, "browser-profiles", "shopee");
const outputDir = process.env.SELLER_COMPARE_DIR
  ? path.resolve(process.env.SELLER_COMPARE_DIR)
  : path.join(projectRoot, "data", "seller_compare");
const headless = boolEnv("SELLER_HEADLESS", false);

function normSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.0$/, "")
    .replace(/^'+/, "")
    .toUpperCase();
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const session = await openAuthContext({
    kind: "shopee",
    persistentDir: sessionDir,
    headless,
    viewport: { width: 1365, height: 900 },
    locale: "th-TH",
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(headless ? [] : ["--start-maximized"])],
  });
  const { context, page } = session;

  let spc = null;
  page.on("response", (response) => {
    const match = response.url().match(/[?&]SPC_CDS=([^&]+)/);
    if (match) spc = decodeURIComponent(match[1]);
  });

  await page
    .goto("https://seller.shopee.co.th/portal/product/list/live/all?operationSortBy=recommend_v2", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await page.waitForTimeout(8000);

  const data = await page.evaluate(async (spcToken) => {
    if (!spcToken) throw new Error("Missing Shopee SPC_CDS token; is Seller Centre logged in?");

    async function fetchJson(endpoint, params) {
      const qs = new URLSearchParams({
        SPC_CDS: spcToken,
        SPC_CDS_VER: "2",
        ...params,
      });
      const response = await fetch(`${endpoint}?${qs.toString()}`, { credentials: "include" });
      const json = await response.json();
      if (json.code !== 0) {
        throw new Error(
          `${endpoint} ${JSON.stringify({
            code: json.code,
            message: json.message,
            user_message: json.user_message,
          })}`
        );
      }
      return json.data || {};
    }

    async function fetchCursorList(listType) {
      const products = [];
      let cursor = "";
      let total = null;

      for (let pageNo = 1; pageNo <= 200; pageNo += 1) {
        const params = {
          page_size: "48",
          list_type: listType,
          request_attribute: "",
          operation_sort_by: "recommend_v4",
          need_ads: "false",
        };
        if (cursor) params.cursor = cursor;

        const pageData = await fetchJson("/api/v3/opt/mpsku/list/v2/search_product_list", params);
        const list = pageData.products || [];
        total = pageData.page_info?.total ?? total;
        products.push(...list);

        const next = pageData.page_info?.cursor || "";
        if (!next || next === cursor || !list.length || products.length >= Number(total || Infinity)) {
          break;
        }
        cursor = next;
      }

      return { listType, total, products };
    }

    async function fetchDraft() {
      const products = [];
      let total = null;

      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const pageData = await fetchJson("/api/v3/mpsku/list/v2/get_draft_product_list", {
          page_number: String(pageNumber),
          page_size: "48",
        });
        const list = pageData.products || [];
        total = pageData.page_info?.total ?? total;
        products.push(...list);

        if (!list.length || products.length >= Number(total || Infinity)) break;
      }

      return { listType: "draft", total, products };
    }

    async function fetchSimple(endpoint, params = {}) {
      const pageData = await fetchJson(endpoint, { page_size: "48", ...params });
      return {
        endpoint,
        total: pageData.page_info?.total,
        products: pageData.products || [],
      };
    }

    return {
      exportedAt: new Date().toISOString(),
      all: await fetchCursorList("all"),
      liveAll: await fetchCursorList("live_all"),
      delisted: await fetchCursorList("delisted"),
      draft: await fetchDraft(),
      deboosted: await fetchSimple("/api/v3/mpsku/list/v2/search_deboosted_product_list"),
      reviewing: await fetchCursorList("reviewing"),
    };
  }, spc);

  const combined = [];
  for (const group of ["all", "liveAll", "delisted", "draft", "deboosted", "reviewing"]) {
    for (const product of data[group].products || []) {
      combined.push({
        source_group: group,
        id: product.id,
        name: product.name,
        parent_sku: product.parent_sku || "",
        normalized_parent_sku: normSku(product.parent_sku),
        status: product.status,
        state: product.state,
        stock:
          product.stock_detail?.total_available_stock ??
          product.stock_detail?.total_seller_stock ??
          null,
        raw: product,
      });
    }
  }

  const parentSkus = [...new Set(combined.map((product) => product.normalized_parent_sku).filter(Boolean))].sort();
  const output = {
    exportedAt: data.exportedAt,
    counts: {
      all: data.all.products.length,
      allTotal: data.all.total,
      liveAll: data.liveAll.products.length,
      liveAllTotal: data.liveAll.total,
      delisted: data.delisted.products.length,
      delistedTotal: data.delisted.total,
      draft: data.draft.products.length,
      draftTotal: data.draft.total,
      deboosted: data.deboosted.products.length,
      deboostedTotal: data.deboosted.total,
      reviewing: data.reviewing.products.length,
      reviewingTotal: data.reviewing.total,
      combined: combined.length,
      uniqueParentSku: parentSkus.length,
    },
    products: combined,
    parentSkus,
  };

  const outputFile = path.join(outputDir, "shopee_products_export.json");
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, counts: output.counts, outputFile }, null, 2));

  await session.close();
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
