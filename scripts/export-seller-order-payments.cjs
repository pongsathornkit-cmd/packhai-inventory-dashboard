const fs = require("fs");
const path = require("path");
const http = require("http");
const { openAuthContext } = require("./browser-auth-state.cjs");
const { boolEnv, chromium, chromiumOptions } = require("./playwright-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const outputDir = process.env.SELLER_COMPARE_DIR
  ? path.resolve(process.env.SELLER_COMPARE_DIR)
  : path.join(projectRoot, "data", "seller_compare");
const outputFile = process.env.SELLER_ORDER_PAYMENTS_OUTPUT
  ? path.resolve(process.env.SELLER_ORDER_PAYMENTS_OUTPUT)
  : path.join(outputDir, "seller_order_payments.json");
const movementFile = process.env.STOCK_MOVEMENTS_FILE
  ? path.resolve(process.env.STOCK_MOVEMENTS_FILE)
  : path.join(projectRoot, "dist", "stock-movements.json");
const headless = boolEnv("SELLER_HEADLESS", false);
const maxNew = Math.max(0, Number(process.env.SELLER_ORDER_PAYMENT_MAX_NEW || 0));
const shopeeDelayMs = Math.max(0, Number(process.env.SHOPEE_ORDER_PAYMENT_DELAY_MS || 120));
const lazadaDelayMs = Math.max(0, Number(process.env.LAZADA_ORDER_PAYMENT_DELAY_MS || 120));

const shopeeLegacySessionDir = path.join(workspaceRoot, ".codex-seller-browser-session");
const shopeeSessionDir = process.env.SHOPEE_SESSION_DIR
  ? path.resolve(process.env.SHOPEE_SESSION_DIR)
  : fs.existsSync(shopeeLegacySessionDir)
  ? shopeeLegacySessionDir
  : path.join(projectRoot, "browser-profiles", "shopee");

const lazadaLegacySessionDir = path.join(workspaceRoot, "chrome-lazada-cdp-profile");
const lazadaSessionDir = process.env.SELLER_SESSION_DIR
  ? path.resolve(process.env.SELLER_SESSION_DIR)
  : fs.existsSync(lazadaLegacySessionDir)
  ? lazadaLegacySessionDir
  : path.join(projectRoot, "browser-profiles", "lazada");
const lazadaCdpEndpoint =
  process.env.LAZADA_CDP_ENDPOINT === "0"
    ? ""
    : process.env.LAZADA_CDP_ENDPOINT || process.env.CDP_ENDPOINT || "http://127.0.0.1:9223";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeOrderNo(value) {
  return String(value || "").trim();
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shopeeMoney(value) {
  const amount = numberValue(value);
  return amount > 100000 ? amount / 100000 : amount;
}

function mergeByOrder(records) {
  const map = new Map();
  for (const record of records || []) {
    const platform = record.platform === "Lazada" ? "Lazada" : record.platform === "Shopee" ? "Shopee" : "";
    const orderNo = normalizeOrderNo(record.orderNo || record.orderSn || record.orderId || record.platformOrderNo);
    if (!platform || !orderNo) continue;
    map.set(`${platform}|${orderNo}`, {
      ...record,
      platform,
      orderNo,
      collectedAmount: numberValue(
        record.collectedAmount ?? record.collected ?? record.netAmount ?? record.payoutAmount ?? record.totalAmount
      ),
    });
  }
  return map;
}

function collectTargets() {
  const explicit = String(process.env.SELLER_ORDER_PAYMENT_ORDER_NOS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (explicit.length) {
    return {
      Shopee: explicit.filter((item) => !/^\d{13,}$/.test(item)),
      Lazada: explicit.filter((item) => /^\d{13,}$/.test(item)),
    };
  }

  const movements = readJsonSafe(movementFile, { rows: [] });
  const targets = { Shopee: new Map(), Lazada: new Map() };
  for (const row of movements.rows || []) {
    if (!row?.isSaleOut) continue;
    const platform = row.platform === "Shopee" || row.channelName === "Shopee" ? "Shopee" : row.platform === "Lazada" || row.channelName === "Lazada" ? "Lazada" : "";
    const orderNo = normalizeOrderNo(row.platformOrderNo || row.orderNo || row.referenceNo2);
    if (!platform || !orderNo) continue;
    const createdAt = String(row.createdAt || row.latestStockMovementAt || "");
    const previous = targets[platform].get(orderNo);
    if (!previous || createdAt > previous.createdAt) {
      targets[platform].set(orderNo, { orderNo, createdAt });
    }
  }
  const newestFirst = (items) =>
    [...items.values()]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || a.orderNo.localeCompare(b.orderNo))
      .map((item) => item.orderNo);
  return {
    Shopee: newestFirst(targets.Shopee),
    Lazada: newestFirst(targets.Lazada),
  };
}

function cardFromShopeeList(cardList, orderSn) {
  for (const item of cardList || []) {
    const card = item.order_card || item.package_level_order_card || item;
    if (card?.card_header?.order_sn === orderSn) return card;
  }
  return null;
}

function paymentFromShopeeCard(card) {
  if (!card) return null;
  if (card.payment_info) return card.payment_info;
  const packages = Array.isArray(card.package_list) ? card.package_list : [];
  const payments = packages.map((item) => item.payment_info).filter(Boolean);
  if (!payments.length) return null;
  return {
    currency: payments[0].currency,
    payment_method: payments.map((item) => item.payment_method).filter(Boolean).join(" / "),
    total_price: payments.reduce((sum, item) => sum + numberValue(item.total_price), 0),
  };
}

function shopeeItemsFromCard(card) {
  const groups = [];
  if (card?.item_info_group) groups.push(card.item_info_group);
  for (const pkg of card?.package_list || []) {
    if (pkg.item_info_group) groups.push(pkg.item_info_group);
  }
  const items = [];
  for (const group of groups) {
    for (const info of group.item_info_list || []) {
      for (const item of info.item_list || []) {
        items.push({
          name: item.name || "",
          skuText: item.description || "",
          amount: numberValue(item.amount),
        });
      }
    }
  }
  return items;
}

async function openShopeePage() {
  const session = await openAuthContext({
    kind: "shopee",
    persistentDir: shopeeSessionDir,
    headless,
    viewport: { width: 1365, height: 900 },
    locale: "th-TH",
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(headless ? [] : ["--start-maximized"])],
  });
  const { page } = session;
  let spc = null;
  let shopId = Number(process.env.SHOPEE_SHOP_ID || 0);

  page.on("response", (response) => {
    const match = response.url().match(/[?&]SPC_CDS=([^&]+)/);
    if (match) spc = decodeURIComponent(match[1]);
  });
  page.on("request", (request) => {
    if (shopId || !request.url().includes("/api/v3/order/get_order_list_card_list")) return;
    try {
      const body = JSON.parse(request.postData() || "{}");
      const first = body.order_param_list?.[0];
      if (first?.shop_id) shopId = Number(first.shop_id);
    } catch {}
  });

  await page
    .goto("https://seller.shopee.co.th/portal/sale/order", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await page.waitForTimeout(9000);

  const loginLike = await page
    .locator("body")
    .innerText({ timeout: 15000 })
    .then((text) => /log in|login|password|sign up/i.test(text))
    .catch(() => true);
  if (!spc || loginLike) {
    await session.close();
    throw new Error("Shopee Seller Center is not logged in.");
  }
  if (!shopId) shopId = 18147317;

  return { context: session.context, page, spc, shopId, close: session.close, mode: session.mode };
}

async function fetchShopeePayment(page, spc, shopId, orderSn) {
  return page.evaluate(
    async ({ spcToken, shopIdValue, orderSnValue }) => {
      function money(value) {
        const amount = Number(value || 0);
        return amount > 100000 ? amount / 100000 : amount;
      }
      async function fetchJson(endpoint, params, options = {}) {
        const qs = new URLSearchParams({
          SPC_CDS: spcToken,
          SPC_CDS_VER: "2",
          ...params,
        });
        const response = await fetch(`${endpoint}?${qs.toString()}`, {
          credentials: "include",
          ...options,
        });
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`${endpoint} returned ${response.status}: ${text.slice(0, 200)}`);
        }
        if (json.code !== 0) {
          throw new Error(`${endpoint} ${JSON.stringify({ code: json.code, message: json.message, user_message: json.user_message })}`);
        }
        return json.data || {};
      }

      const search = await fetchJson("/api/v3/order/get_order_list_search_bar_hint", {
        keyword: orderSnValue,
        category: "1",
        order_list_tab: "100",
        entity_type: "1",
      });
      const order = search.order_sn_result?.list?.find((item) => item.order_sn === orderSnValue) || search.order_sn_result?.list?.[0];
      if (!order?.order_id) {
        return { platform: "Shopee", orderNo: orderSnValue, error: "Order not found in Shopee Seller Center" };
      }

      const cardData = await fetchJson(
        "/api/v3/order/get_order_list_card_list",
        {},
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            order_list_tab: 100,
            need_count_down_desc: true,
            order_param_list: [{ order_id: Number(order.order_id), shop_id: Number(shopIdValue), region_id: "TH" }],
          }),
        }
      );

      return { platform: "Shopee", orderNo: orderSnValue, rawCardList: cardData.card_list || [] };
    },
    { spcToken: spc, shopIdValue: shopId, orderSnValue: orderSn }
  );
}

async function exportShopeePayments(orderNos, existingMap, errors) {
  if (!orderNos.length) return [];
  const session = await openShopeePage();
  const records = [];
  try {
    for (const orderNo of orderNos) {
      try {
        const raw = await fetchShopeePayment(session.page, session.spc, session.shopId, orderNo);
        const card = cardFromShopeeList(raw.rawCardList, orderNo);
        const payment = paymentFromShopeeCard(card);
        if (!card || !payment) {
          errors.push(`Shopee ${orderNo}: payment not found`);
        } else {
          records.push({
            platform: "Shopee",
            orderNo,
            collectedAmount: shopeeMoney(payment.total_price),
            currency: "THB",
            paymentMethod: payment.payment_method || "",
            status: card.status_info?.status || "",
            source: "Shopee Seller Center",
            capturedAt: new Date().toISOString(),
            orderId: card.order_ext_info?.order_id || "",
            items: shopeeItemsFromCard(card),
          });
        }
      } catch (error) {
        errors.push(`Shopee ${orderNo}: ${error.message || error}`);
      }
      await sleep(shopeeDelayMs);
    }
  } finally {
    await session.close().catch(() => {});
  }
  return records;
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

async function openLazadaCdpSession() {
  if (!lazadaCdpEndpoint) return null;
  try {
    await getJson(endpointJsonUrl(lazadaCdpEndpoint));
    const browser = await chromium.connectOverCDP(lazadaCdpEndpoint);
    const context =
      browser.contexts()[0] ||
      (await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: "th-TH" }));
    const page = await context.newPage();
    return {
      mode: `cdp:${lazadaCdpEndpoint}`,
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

async function openLazadaPersistentSession() {
  return openAuthContext({
    kind: "lazada",
    persistentDir: lazadaSessionDir,
    headless,
    viewport: { width: 1365, height: 900 },
    locale: "th-TH",
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(headless ? [] : ["--start-maximized"])],
  });
}

async function openLazadaPage() {
  const session = (await openLazadaCdpSession()) || (await openLazadaPersistentSession());
  await session.page
    .goto("https://sellercenter.lazada.co.th/apps/order/index?tab=all", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await session.page.waitForTimeout(10000);
  const loginLike = await session.page
    .locator("body")
    .innerText({ timeout: 15000 })
    .then((text) => /login|password|sign up/i.test(text))
    .catch(() => true);
  if (loginLike) {
    await session.close();
    throw new Error("Lazada Seller Center is not logged in.");
  }
  return session;
}

async function fetchLazadaPayment(page, orderNo) {
  return page.evaluate(async (orderNoValue) => {
    function simplify(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
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

    const response = await callMtop("mtop.lazada.seller.order.query.list", {
      page: 1,
      pageSize: 20,
      filterOrderItems: true,
      sort: "GMT_CREATE",
      sortOrder: "DESC",
      orderNumbers: orderNoValue,
      tab: "all",
    });
    const ret = (response.ret || []).join(" ");
    if (!/SUCCESS/i.test(ret)) throw new Error(ret || "Lazada order query failed");
    const rows = response?.data?.data?.dataSource || [];
    return rows.find((row) => String(row.orderNumber || "") === orderNoValue) || rows[0] || null;
  }, orderNo);
}

function lazadaItemsFromOrder(row) {
  const items = [];
  for (const pkg of row?.packages || []) {
    for (const sku of pkg.skus || []) {
      items.push({
        name: sku.productName || sku.productTitle || "",
        skuText: sku.sellerSku || sku.shopSku || "",
        amount: numberValue(sku.quantity),
      });
    }
  }
  return items;
}

async function exportLazadaPayments(orderNos, existingMap, errors) {
  if (!orderNos.length) return [];
  const session = await openLazadaPage();
  const records = [];
  try {
    for (const orderNo of orderNos) {
      try {
        const row = await fetchLazadaPayment(session.page, orderNo);
        if (!row) {
          errors.push(`Lazada ${orderNo}: order not found`);
        } else {
          records.push({
            platform: "Lazada",
            orderNo,
            collectedAmount: numberValue(row.totalUnitPrice || row.totalRetailPrice),
            currency: "THB",
            paymentMethod: row.paymentMethod || "",
            status: row.tabStatus || row.packages?.[0]?.packageStatusName || "",
            source: "Lazada Seller Center",
            capturedAt: new Date().toISOString(),
            orderId: row.orderNumber || "",
            items: lazadaItemsFromOrder(row),
          });
        }
      } catch (error) {
        errors.push(`Lazada ${orderNo}: ${error.message || error}`);
      }
      await sleep(lazadaDelayMs);
    }
  } finally {
    await session.close().catch(() => {});
  }
  return records;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const previous = readJsonSafe(outputFile, { orders: [] });
  const existingMap = mergeByOrder(previous.orders || previous.payments || []);
  const targets = collectTargets();
  const platforms = String(process.env.SELLER_ORDER_PAYMENT_PLATFORMS || "Shopee,Lazada")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let todo = [];
  for (const platform of platforms) {
    for (const orderNo of targets[platform] || []) {
      if (!existingMap.has(`${platform}|${orderNo}`)) todo.push({ platform, orderNo });
    }
  }
  if (maxNew > 0) todo = todo.slice(0, maxNew);

  const errors = [];
  const newRecords = [];
  const shopeeOrders = todo.filter((item) => item.platform === "Shopee").map((item) => item.orderNo);
  const lazadaOrders = todo.filter((item) => item.platform === "Lazada").map((item) => item.orderNo);

  try {
    newRecords.push(...(await exportShopeePayments(shopeeOrders, existingMap, errors)));
  } catch (error) {
    errors.push(error.message || String(error));
  }
  try {
    newRecords.push(...(await exportLazadaPayments(lazadaOrders, existingMap, errors)));
  } catch (error) {
    errors.push(error.message || String(error));
  }

  for (const record of newRecords) {
    existingMap.set(`${record.platform}|${record.orderNo}`, record);
  }

  const orders = [...existingMap.values()].sort((a, b) =>
    `${a.platform}|${a.orderNo}`.localeCompare(`${b.platform}|${b.orderNo}`)
  );
  const output = {
    exportedAt: new Date().toISOString(),
    source: "Seller platform order payments",
    rule: "Amounts must come from Shopee Seller Center or Lazada Seller Center only. Do not use Packhai order amounts.",
    counts: {
      targetShopee: targets.Shopee.length,
      targetLazada: targets.Lazada.length,
      cachedBefore: existingMap.size - newRecords.length,
      requestedNew: todo.length,
      fetchedNew: newRecords.length,
      totalOrders: orders.length,
      errors: errors.length,
    },
    errors: errors.slice(0, 100),
    orders,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputFile, counts: output.counts }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
