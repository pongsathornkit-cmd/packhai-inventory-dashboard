const crypto = require("crypto");

const { loadStorageState } = require("./browser-auth-state.cjs");

const SHOPEE_HOST = "seller.shopee.co.th";
const LAZADA_API_HOST = "acs-m.lazada.co.th";
const LAZADA_SELLER_HOST = "sellercenter.lazada.co.th";
const LAZADA_PRODUCT_API = "mtop.lazada.merchant.product.manager.simple.render.list";

function lazadaMtopEndpoint(api, version = "1.0") {
  return `/h5/${api}/${version}/`;
}

const LAZADA_PRODUCT_ENDPOINT = lazadaMtopEndpoint(LAZADA_PRODUCT_API);

function normalizeCookieDomain(domain) {
  return String(domain || "").trim().replace(/^\./, "").toLowerCase();
}

function domainMatches(cookieDomain, host) {
  const normalizedDomain = normalizeCookieDomain(cookieDomain);
  const normalizedHost = String(host || "").trim().toLowerCase();
  return Boolean(normalizedDomain && (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)));
}

function cookieAppliesToPath(cookiePath, requestPath) {
  const normalizedCookiePath = String(cookiePath || "/");
  const normalizedRequestPath = String(requestPath || "/");
  return normalizedRequestPath.startsWith(normalizedCookiePath);
}

function cookieHeaderForHost(state, host, requestPath = "/") {
  return (state?.cookies || [])
    .filter((cookie) => domainMatches(cookie.domain, host) && cookieAppliesToPath(cookie.path, requestPath))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function cookieHeaderForHosts(state, hosts, requestPath = "/") {
  return hosts
    .map((host) => cookieHeaderForHost(state, host, requestPath))
    .filter(Boolean)
    .join("; ");
}

function cookieValueForHost(state, name, host) {
  const exact = (state?.cookies || []).find((cookie) => cookie.name === name && domainMatches(cookie.domain, host));
  if (exact) return exact.value || "";
  const fallback = (state?.cookies || []).find((cookie) => cookie.name === name);
  return fallback?.value || "";
}

function requireStorageState(kind) {
  const loaded = loadStorageState(kind);
  if (!loaded.state) {
    throw new Error(`${kind} storage state is not configured.`);
  }
  return loaded.state;
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON status ${response.status}: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSellerError(error) {
  return /ErrorCode:10000|code["']?:10000|spex client error|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    error?.message || String(error)
  );
}

function createShopeeUrl(endpoint, params, spcToken) {
  const url = new URL(endpoint, `https://${SHOPEE_HOST}`);
  for (const [key, value] of Object.entries({ SPC_CDS: spcToken, SPC_CDS_VER: "2", ...params })) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchShopeeSellerData(options = {}) {
  const state = options.state || requireStorageState("shopee");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Global fetch is not available.");
  const spcToken = cookieValueForHost(state, "SPC_CDS", SHOPEE_HOST);
  if (!spcToken) throw new Error("Missing Shopee SPC_CDS cookie; refresh Seller Center session.");

  async function fetchJson(endpoint, params) {
    const url = createShopeeUrl(endpoint, params, spcToken);
    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const json = await parseJsonResponse(
          await fetchImpl(url, {
            headers: {
              accept: "application/json",
              "accept-language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
              cookie: cookieHeaderForHost(state, SHOPEE_HOST, endpoint),
              referer: "https://seller.shopee.co.th/portal/product/list/live/all?operationSortBy=recommend_v2",
              "user-agent": "Mozilla/5.0",
              "x-requested-with": "XMLHttpRequest",
            },
          }),
          endpoint
        );
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
      } catch (error) {
        lastError = error;
        if (attempt >= 4 || !isRetryableSellerError(error)) break;
        await sleep(750 * attempt);
      }
    }
    throw lastError;
  }

  async function fetchCursorList(listType) {
    const products = [];
    let cursor = "";
    let total = null;

    try {
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
        if (!next || next === cursor || !list.length || products.length >= Number(total || Infinity)) break;
        cursor = next;
      }
      return { listType, total, products, complete: true };
    } catch (error) {
      return { listType, total, products, complete: false, error: `${listType}: ${error.message || error}` };
    }
  }

  async function fetchDraft() {
    const products = [];
    let total = null;

    try {
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
      return { listType: "draft", total, products, complete: true };
    } catch (error) {
      return { listType: "draft", total, products, complete: false, error: `draft: ${error.message || error}` };
    }
  }

  async function fetchSimple(endpoint, params = {}) {
    try {
      const pageData = await fetchJson(endpoint, { page_size: "48", ...params });
      return {
        endpoint,
        total: pageData.page_info?.total,
        products: pageData.products || [],
        complete: true,
      };
    } catch (error) {
      return { endpoint, total: null, products: [], complete: false, error: `${endpoint}: ${error.message || error}` };
    }
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
}

function createLazadaMtopUrl(options) {
  const api = String(options.api || LAZADA_PRODUCT_API);
  const version = String(options.version || options.v || "1.0");
  const endpoint = String(options.endpoint || lazadaMtopEndpoint(api, version));
  const token = String(options.token || "").split("_")[0];
  const timestamp = String(options.timestamp || Date.now());
  const appKey = String(options.appKey || process.env.LAZADA_MTOP_APP_KEY || "12574478");
  const data = String(options.data || "{}");
  const sign = crypto.createHash("md5").update(`${token}&${timestamp}&${appKey}&${data}`).digest("hex");
  const url = new URL(`https://${LAZADA_API_HOST}${endpoint}`);
  const params = {
    jsv: "2.7.2",
    appKey,
    t: timestamp,
    sign,
    api,
    v: version,
    type: "originaljson",
    dataType: "json",
    H5Request: "true",
    AntiCreep: "true",
    timeout: "30000",
    data,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url, sign, appKey, timestamp };
}

async function fetchLazadaSellerData(options = {}) {
  const state = options.state || requireStorageState("lazada");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Global fetch is not available.");
  const tokenCookie =
    cookieValueForHost(state, "_m_h5_tk", LAZADA_API_HOST) ||
    cookieValueForHost(state, "_m_h5_tk", LAZADA_SELLER_HOST) ||
    cookieValueForHost(state, "_m_h5_tk", "lazada.co.th");
  if (!tokenCookie) throw new Error("Missing Lazada _m_h5_tk cookie; refresh Seller Center session.");

  async function callMtop(dataPayload) {
    const data = JSON.stringify(dataPayload);
    const { url } = createLazadaMtopUrl({
      token: tokenCookie,
      data,
      timestamp: String(Date.now()),
    });
    const json = await parseJsonResponse(
      await fetchImpl(url, {
        headers: {
          accept: "application/json",
          cookie: cookieHeaderForHosts(state, [LAZADA_API_HOST, LAZADA_SELLER_HOST], LAZADA_PRODUCT_ENDPOINT),
          origin: `https://${LAZADA_SELLER_HOST}`,
          referer: `https://${LAZADA_SELLER_HOST}/apps/product/list?tab=online_product`,
          "user-agent": "Mozilla/5.0",
        },
      }),
      LAZADA_PRODUCT_API
    );
    if (!json.data?.data) {
      throw new Error(`${LAZADA_PRODUCT_API} returned no product data: ${JSON.stringify(json.ret || json).slice(0, 240)}`);
    }
    return {
      rows: json.data.data.table?.dataSource || [],
      pagination: json.data.data.pagination || {},
      responseMeta: { api: json.api, ret: json.ret, v: json.v },
    };
  }

  async function fetchPage(current, pageSize) {
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
    return {
      current,
      ...(await callMtop({
        jsonBody: JSON.stringify(jsonBody),
        bizParam: JSON.stringify(bizParam),
      })),
    };
  }

  const pageSize = Number(options.pageSize || 50);
  const first = await fetchPage(1, pageSize);
  const total = Number(first.pagination?.total || first.rows.length || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages = [first];

  for (let current = 2; current <= totalPages; current += 1) {
    pages.push(await fetchPage(current, pageSize));
  }

  return {
    exportedAt: new Date().toISOString(),
    api: LAZADA_PRODUCT_API,
    tab: "online_product",
    pageSize,
    total,
    totalPages,
    pages,
    sessionMode: "storage-state:direct-api",
  };
}

module.exports = {
  cookieHeaderForHost,
  cookieHeaderForHosts,
  cookieValueForHost,
  createLazadaMtopUrl,
  fetchLazadaSellerData,
  fetchShopeeSellerData,
  lazadaMtopEndpoint,
};
