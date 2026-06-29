const fs = require("fs");
const path = require("path");
const http = require("http");
const { loadStorageState, openAuthContext } = require("./browser-auth-state.cjs");
const { boolEnv, chromium, chromiumOptions } = require("./playwright-runtime.cjs");
const { cookieHeaderForHost, cookieValueForHost } = require("./seller-direct-api.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const shopeeHost = "seller.shopee.co.th";
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
const progressEvery = Math.max(1, Number(process.env.SELLER_ORDER_PAYMENT_PROGRESS_EVERY || 25));
const shopeeBrowserFallback = boolEnv("SELLER_ORDER_PAYMENT_BROWSER_FALLBACK", !process.env.RENDER);

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

function logProgress(event) {
  console.log(JSON.stringify(event));
}

function logPaymentProgress(platform, current, total, orderNo, fetched, errorCount) {
  if (!total) return;
  if (current === 1 || current === total || current % progressEvery === 0) {
    logProgress({
      event: "seller-payment-progress",
      platform,
      current,
      total,
      orderNo,
      fetched,
      errors: errorCount,
    });
  }
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sortedOrdersFromMap(existingMap) {
  return [...existingMap.values()].sort((a, b) =>
    `${a.platform}|${a.orderNo}`.localeCompare(`${b.platform}|${b.orderNo}`)
  );
}

function writeJsonAtomic(file, value) {
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmpFile, file);
}

function buildPaymentOutput({ existingMap, targets, cachedBefore, requestedNew, fetchedNew, errors, partial = false }) {
  const orders = sortedOrdersFromMap(existingMap);
  return {
    exportedAt: new Date().toISOString(),
    source: "Seller platform order payments",
    rule: "Amounts must come from Shopee Seller Center or Lazada Seller Center only. Do not use Packhai order amounts.",
    partial,
    counts: {
      targetShopee: targets.Shopee.length,
      targetLazada: targets.Lazada.length,
      cachedBefore,
      requestedNew,
      fetchedNew,
      totalOrders: orders.length,
      errors: errors.length,
    },
    errors: errors.slice(0, 100),
    orders,
  };
}

function writePaymentOutput(state) {
  const output = buildPaymentOutput(state);
  writeJsonAtomic(outputFile, output);
  return output;
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

function firstNumberOrNull(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    return numberValue(value);
  }
  return null;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function shopeeMoney(value) {
  const amount = numberValue(value);
  return roundMoney(Math.abs(amount) >= 100000 ? amount / 100000 : amount);
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function shopeeItemLineAmount(item) {
  const quantity = firstPositive(item.amount, item.quantity, item.qty) || 1;
  const lineAmount = shopeeMoney(
    firstPositive(
      item.line_amount,
      item.lineAmount,
      item.total_amount,
      item.totalAmount,
      item.total_price,
      item.totalPrice,
      item.paid_amount,
      item.paidAmount,
      item.actual_amount,
      item.actualAmount
    )
  );
  if (lineAmount > 0) return lineAmount;
  const unitPrice = shopeeMoney(
    firstPositive(
      item.price,
      item.item_price,
      item.itemPrice,
      item.order_price,
      item.orderPrice,
      item.model_discounted_price,
      item.modelDiscountedPrice,
      item.discounted_price,
      item.discountedPrice
    )
  );
  return unitPrice > 0 ? unitPrice * quantity : 0;
}

function shopeeMoneyOrNull(value) {
  if (value == null || value === "") return null;
  const amount = shopeeMoney(value);
  return Number.isFinite(amount) ? amount : null;
}

function flattenShopeeBreakdown(rows, parent = null) {
  const output = [];
  for (const row of rows || []) {
    const entry = {
      fieldId: row.field_id ?? row.fieldId ?? "",
      fieldName: String(row.field_name || row.fieldName || "").trim(),
      displayName: String(row.display_name || row.displayName || "").trim(),
      amount: shopeeMoney(row.amount),
      parentFieldName: parent?.fieldName || "",
      parentDisplayName: parent?.displayName || "",
    };
    output.push(entry);
    output.push(...flattenShopeeBreakdown(row.sub_breakdown || row.subBreakdown || [], entry));
  }
  return output;
}

function findShopeeBreakdownAmount(rows, fieldNames, displayNames = []) {
  const fieldSet = new Set(fieldNames.map((item) => String(item).toUpperCase()));
  const displaySet = new Set(displayNames.map((item) => String(item).trim()));
  const row = (rows || []).find(
    (item) =>
      (item.fieldName && fieldSet.has(item.fieldName.toUpperCase())) ||
      (item.displayName && displaySet.has(item.displayName))
  );
  return row ? row.amount : null;
}

function shopeePaymentDetailFromIncomeComponents(data) {
  const sellerRows = flattenShopeeBreakdown(data?.seller_income_breakdown?.breakdown);
  const buyerRows = flattenShopeeBreakdown(data?.buyer_payment_breakdown?.breakdown);
  const paymentBreakdown = {
    merchandiseSubtotal: findShopeeBreakdownAmount(sellerRows, ["MERCHANDISE_SUBTOTAL"], ["รวมค่าสินค้า"]),
    productRevenue: findShopeeBreakdownAmount(sellerRows, ["PRODUCT_PRICE"], ["รายรับค่าสินค้า"]),
    shippingSubtotal: findShopeeBreakdownAmount(sellerRows, ["SHIPPING_SUBTOTAL"], ["ค่าจัดส่งทั้งหมด"]),
    shippingFeePaidByBuyer: findShopeeBreakdownAmount(sellerRows, ["SHIPPING_FEE_PAID_BY_BUYER"], [
      "ค่าจัดส่งที่ชำระโดยผู้ซื้อ",
    ]),
    actualShippingFee: findShopeeBreakdownAmount(sellerRows, ["ACTUAL_SHIPPING_FEE"], [
      "ค่าจัดส่งตามจริง คิดโดยผู้ให้บริการขนส่ง",
    ]),
    feesAndCharges: findShopeeBreakdownAmount(sellerRows, ["FEES_AND_CHARGES"], ["ค่าธรรมเนียม"]),
    commissionFee: findShopeeBreakdownAmount(sellerRows, ["COMMISSION_FEE"], ["ค่าคอมมิชชั่น"]),
    serviceFee: findShopeeBreakdownAmount(sellerRows, ["SERVICE_FEE"], ["ค่าบริการ"]),
    platformInfrastructureFee: findShopeeBreakdownAmount(sellerRows, ["SELLER_ORDER_PROCESSING_FEE"], [
      "ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม",
    ]),
    transactionFee: findShopeeBreakdownAmount(sellerRows, ["TRANSACTION_FEE"], ["ค่าธุรกรรมการชำระเงิน"]),
    escrowTopUpAdsFee: findShopeeBreakdownAmount(sellerRows, ["ESCROW_ADS_CREDIT_TOP_UP"], [
      "ค่าธรรมเนียมเติมเงินโฆษณาจากเงิน Escrow",
    ]),
    valueAddedServicesSubtotal: findShopeeBreakdownAmount(sellerRows, ["VALUE_ADDED_SERVICES_SUBTOTAL"], [
      "ยอดรวมบริการเสริมเพิ่มมูลค่าสำหรับผู้ซื้อ",
    ]),
    escrowAmount: findShopeeBreakdownAmount(sellerRows, ["ESCROW_AMOUNT"], ["รายรับจากคำสั่งซื้อ"]),
    buyerPaidAmount: findShopeeBreakdownAmount(buyerRows, ["BUYER_PAID_AMOUNT"], ["การชำระเงินทั้งหมดของผู้ซื้อ"]),
    buyerMerchandiseSubtotal: findShopeeBreakdownAmount(buyerRows, ["MERCHANDISE_SUBTOTAL"], ["รวมค่าสินค้า"]),
    buyerShippingFee: findShopeeBreakdownAmount(buyerRows, ["SHIPPING_FEE"], ["ค่าจัดส่ง"]),
    buyerShopeeVoucherDiscount: findShopeeBreakdownAmount(buyerRows, ["SHOPEE_VOUCHER_DISCOUNT"], ["Shopee Voucher"]),
    buyerSellerVoucherDiscount: findShopeeBreakdownAmount(buyerRows, ["SELLER_VOUCHER_DISCOUNT"], ["Seller Voucher"]),
    sellerIncomeBreakdown: sellerRows,
    buyerPaymentBreakdown: buyerRows,
  };
  const adjustedAmount = shopeeMoneyOrNull(data?.adjustment_info?.amount_after_adjustment);
  const orderIncomeAmount =
    paymentBreakdown.escrowAmount != null ? paymentBreakdown.escrowAmount : adjustedAmount != null ? adjustedAmount : null;

  return {
    orderIncomeAmount,
    buyerPaidAmount: paymentBreakdown.buyerPaidAmount,
    paymentBreakdown,
    items: shopeeItemsFromIncomeComponents(data),
  };
}

function shopeeItemsFromIncomeComponents(data) {
  return (data?.order_item_list?.order_items || []).map((item) => {
    const quantity = firstPositive(item.amount, item.quantity, item.qty) || 1;
    const unitPrice = shopeeMoney(firstPositive(item.price, item.unit_price, item.unitPrice));
    const lineAmount = shopeeMoney(firstPositive(item.subtotal, item.net_sales_amount, item.netSalesAmount, item.total_price));
    const skuText = String(item.model_sku || item.product_sku || item.sku || "").trim();
    return {
      name: item.product_name || item.name || "",
      skuText,
      amount: quantity,
      unitPrice,
      lineAmount,
      netSalesAmount: lineAmount,
      itemId: item.item_id || "",
      modelId: item.model_id || "",
      lineItemId: item.line_item_id || "",
      image: item.product_image || "",
    };
  });
}

function lazadaItemLineAmount(sku) {
  const quantity = firstPositive(sku.quantity, sku.amount, sku.qty) || 1;
  const lineAmount = firstPositive(
    sku.lineAmount,
    sku.totalAmount,
    sku.totalPrice,
    sku.totalUnitPrice,
    sku.totalRetailPrice,
    sku.paidAmount,
    sku.paidPriceTotal,
    sku.itemTotalPrice,
    sku.actualAmount
  );
  if (lineAmount > 0) return lineAmount;
  const unitPrice = firstPositive(
    sku.unitPrice,
    sku.itemPrice,
    sku.paidPrice,
    sku.actualPrice,
    sku.retailPrice,
    sku.price
  );
  return unitPrice > 0 ? unitPrice * quantity : 0;
}

function mergeByOrder(records) {
  const map = new Map();
  for (const record of records || []) {
    const platform = record.platform === "Lazada" ? "Lazada" : record.platform === "Shopee" ? "Shopee" : "";
    const orderNo = normalizeOrderNo(record.orderNo || record.orderSn || record.orderId || record.platformOrderNo);
    if (!platform || !orderNo) continue;
    const paymentBreakdown = record.paymentBreakdown || record.payment_breakdown || {};
    const orderIncomeAmount = firstNumberOrNull(
      record.orderIncomeAmount,
      record.orderIncome,
      paymentBreakdown.escrowAmount,
      paymentBreakdown.orderIncomeAmount
    );
    map.set(`${platform}|${orderNo}`, {
      ...record,
      platform,
      orderNo,
      collectedAmount:
        platform === "Shopee" && orderIncomeAmount != null
          ? orderIncomeAmount
          : numberValue(record.collectedAmount ?? record.collected ?? record.netAmount ?? record.payoutAmount ?? record.totalAmount),
    });
  }
  return map;
}

function recordNeedsItemAmountRefresh(record) {
  if (record?.platform === "Shopee" && !record.incomeDetailCaptured) return true;
  const items = Array.isArray(record?.items) ? record.items : [];
  if (!items.length) return true;
  const skuKeys = new Set(
    items
      .map((item) => String(item.skuText || item.sku || item.sellerSku || item.shopSku || item.name || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const hasItemLineAmount = items.some((item) => numberValue(item.lineAmount) > 0);
  return skuKeys.size > 1 && !hasItemLineAmount;
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
          unitPrice: shopeeMoney(
            firstPositive(
              item.price,
              item.item_price,
              item.itemPrice,
              item.order_price,
              item.orderPrice,
              item.model_discounted_price,
              item.modelDiscountedPrice,
              item.discounted_price,
              item.discountedPrice
            )
          ),
          lineAmount: shopeeItemLineAmount(item),
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

async function fetchShopeeIncomeComponents(page, spc, shopId, orderId, orderSn) {
  if (!orderId) return null;
  return page.evaluate(
    async ({ spcToken, shopIdValue, orderIdValue, orderSnValue }) => {
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

      const body = {
        order_id: Number(orderIdValue),
        order_sn: orderSnValue,
        components: [2, 3, 4, 5, 6],
      };
      if (Number(shopIdValue)) body.shop_id = Number(shopIdValue);
      return fetchJson(
        "/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components",
        {},
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
    },
    { spcToken: spc, shopIdValue: shopId, orderIdValue: orderId, orderSnValue: orderSn }
  );
}

function shopeeDirectContext() {
  const loaded = loadStorageState("shopee");
  if (!loaded.state) throw new Error("Shopee storage state is not configured.");
  const spcToken = cookieValueForHost(loaded.state, "SPC_CDS", shopeeHost);
  if (!spcToken) throw new Error("Missing Shopee SPC_CDS cookie; refresh Seller Center session.");
  return {
    state: loaded.state,
    spcToken,
    shopId: Number(process.env.SHOPEE_SHOP_ID || 18147317),
  };
}

function shopeeDirectUrl(endpoint, params, spcToken) {
  const url = new URL(endpoint, `https://${shopeeHost}`);
  for (const [key, value] of Object.entries({ SPC_CDS: spcToken, SPC_CDS_VER: "2", ...params })) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function parseShopeeDirectJson(response, label) {
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON status ${response.status}: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  if (json.code !== 0) {
    throw new Error(
      `${label} ${JSON.stringify({
        code: json.code,
        message: json.message,
        user_message: json.user_message,
      })}`
    );
  }
  return json.data || {};
}

function isRetryableShopeeDirectError(error) {
  return /ErrorCode:10000|code["']?:10000|spex client error|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(
    error?.message || String(error)
  );
}

async function fetchShopeeDirectJson(context, endpoint, params = {}, options = {}) {
  const url = shopeeDirectUrl(endpoint, params, context.spcToken);
  const headers = {
    accept: "application/json",
    "accept-language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
    cookie: cookieHeaderForHost(context.state, shopeeHost, endpoint),
    origin: `https://${shopeeHost}`,
    referer: "https://seller.shopee.co.th/portal/sale/order",
    "user-agent": "Mozilla/5.0",
    "x-requested-with": "XMLHttpRequest",
    ...(options.headers || {}),
  };
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await parseShopeeDirectJson(
        await fetch(url, {
          credentials: "include",
          ...options,
          headers,
        }),
        endpoint
      );
    } catch (error) {
      lastError = error;
      if (attempt >= 4 || !isRetryableShopeeDirectError(error)) break;
      await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function fetchShopeeDirectOrderPayment(context, orderNo) {
  const search = await fetchShopeeDirectJson(context, "/api/v3/order/get_order_list_search_bar_hint", {
    keyword: orderNo,
    category: "1",
    order_list_tab: "100",
    entity_type: "1",
  });
  const order = search.order_sn_result?.list?.find((item) => item.order_sn === orderNo) || search.order_sn_result?.list?.[0];
  if (!order?.order_id) throw new Error("Order not found in Shopee Seller Center");

  let card = null;
  let payment = null;
  try {
    const cardData = await fetchShopeeDirectJson(
      context,
      "/api/v3/order/get_order_list_card_list",
      {},
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_list_tab: 100,
          need_count_down_desc: true,
          order_param_list: [{ order_id: Number(order.order_id), shop_id: Number(context.shopId), region_id: "TH" }],
        }),
      }
    );
    card = cardFromShopeeList(cardData.card_list || [], orderNo);
    payment = paymentFromShopeeCard(card);
  } catch {}

  const incomeComponents = await fetchShopeeDirectJson(
    context,
    "/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components",
    {},
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        order_id: Number(order.order_id),
        order_sn: orderNo,
        shop_id: Number(context.shopId),
        components: [2, 3, 4, 5, 6],
      }),
    }
  );
  const incomeDetail = shopeePaymentDetailFromIncomeComponents(incomeComponents);
  const fallbackCollectedAmount = shopeeMoney(payment?.total_price ?? incomeDetail.buyerPaidAmount ?? 0);
  const collectedAmount = incomeDetail.orderIncomeAmount != null ? incomeDetail.orderIncomeAmount : fallbackCollectedAmount;
  const items = incomeDetail.items.length ? incomeDetail.items : card ? shopeeItemsFromCard(card) : [];

  return {
    platform: "Shopee",
    orderNo,
    collectedAmount,
    orderIncomeAmount: incomeDetail.orderIncomeAmount,
    buyerPaidAmount: incomeDetail.buyerPaidAmount != null ? incomeDetail.buyerPaidAmount : fallbackCollectedAmount,
    paymentBreakdown: incomeDetail.paymentBreakdown,
    currency: "THB",
    paymentMethod: payment?.payment_method || incomeComponents.order_info?.source || "",
    status: card?.status_info?.status || String(incomeComponents.order_info?.status || ""),
    source: "Shopee Seller Center",
    capturedAt: new Date().toISOString(),
    orderId: order.order_id,
    incomeDetailCaptured: true,
    sessionMode: "storage-state:direct-api",
    items,
  };
}

async function exportShopeePaymentsDirect(orderNos, existingMap, errors, onRecord) {
  if (!orderNos.length) return [];
  const context = shopeeDirectContext();
  const records = [];
  logProgress({ event: "seller-payment-platform-start", platform: "Shopee", total: orderNos.length, mode: "direct-api" });
  let current = 0;
  for (const orderNo of orderNos) {
    try {
      const record = await fetchShopeeDirectOrderPayment(context, orderNo);
      records.push(record);
      if (onRecord) onRecord(record, { platform: "Shopee", current: current + 1, total: orderNos.length });
    } catch (error) {
      errors.push(`Shopee ${orderNo}: ${error.message || error}`);
    }
    current += 1;
    logPaymentProgress("Shopee", current, orderNos.length, orderNo, records.length, errors.length);
    await sleep(shopeeDelayMs);
  }
  return records;
}

async function exportShopeePaymentsBrowser(orderNos, existingMap, errors, onRecord) {
  if (!orderNos.length) return [];
  const session = await openShopeePage();
  const records = [];
  try {
    logProgress({ event: "seller-payment-platform-start", platform: "Shopee", total: orderNos.length });
    let current = 0;
    for (const orderNo of orderNos) {
      try {
        const raw = await fetchShopeePayment(session.page, session.spc, session.shopId, orderNo);
        const card = cardFromShopeeList(raw.rawCardList, orderNo);
        const payment = paymentFromShopeeCard(card);
        if (!card || !payment) {
          errors.push(`Shopee ${orderNo}: payment not found`);
        } else {
          const orderId = card.order_ext_info?.order_id || "";
          let incomeComponents = null;
          let incomeDetail = { items: [], orderIncomeAmount: null, buyerPaidAmount: null, paymentBreakdown: {} };
          try {
            incomeComponents = await fetchShopeeIncomeComponents(session.page, session.spc, session.shopId, orderId, orderNo);
            incomeDetail = shopeePaymentDetailFromIncomeComponents(incomeComponents);
          } catch (error) {
            errors.push(`Shopee ${orderNo}: income detail unavailable (${error.message || error})`);
          }
          const fallbackCollectedAmount = shopeeMoney(payment.total_price);
          const collectedAmount =
            incomeDetail.orderIncomeAmount != null ? incomeDetail.orderIncomeAmount : fallbackCollectedAmount;
          const items = incomeDetail.items.length ? incomeDetail.items : shopeeItemsFromCard(card);
          const record = {
            platform: "Shopee",
            orderNo,
            collectedAmount,
            orderIncomeAmount: incomeDetail.orderIncomeAmount,
            buyerPaidAmount: incomeDetail.buyerPaidAmount != null ? incomeDetail.buyerPaidAmount : fallbackCollectedAmount,
            paymentBreakdown: incomeDetail.paymentBreakdown,
            currency: "THB",
            paymentMethod: payment.payment_method || "",
            status: card.status_info?.status || "",
            source: "Shopee Seller Center",
            capturedAt: new Date().toISOString(),
            orderId,
            incomeDetailCaptured: Boolean(incomeComponents),
            items,
          };
          records.push(record);
          if (onRecord) onRecord(record, { platform: "Shopee", current: current + 1, total: orderNos.length });
        }
      } catch (error) {
        errors.push(`Shopee ${orderNo}: ${error.message || error}`);
      }
      current += 1;
      logPaymentProgress("Shopee", current, orderNos.length, orderNo, records.length, errors.length);
      await sleep(shopeeDelayMs);
    }
  } finally {
    await session.close().catch(() => {});
  }
  return records;
}

async function exportShopeePayments(orderNos, existingMap, errors, onRecord) {
  if (!orderNos.length) return [];
  try {
    return await exportShopeePaymentsDirect(orderNos, existingMap, errors, onRecord);
  } catch (error) {
    if (!shopeeBrowserFallback) throw error;
    errors.push(`Shopee direct API failed, falling back to browser: ${error.message || error}`);
    return exportShopeePaymentsBrowser(orderNos, existingMap, errors, onRecord);
  }
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
        unitPrice: firstPositive(
          sku.unitPrice,
          sku.itemPrice,
          sku.paidPrice,
          sku.actualPrice,
          sku.retailPrice,
          sku.price
        ),
        lineAmount: lazadaItemLineAmount(sku),
      });
    }
  }
  return items;
}

async function exportLazadaPayments(orderNos, existingMap, errors, onRecord) {
  if (!orderNos.length) return [];
  const session = await openLazadaPage();
  const records = [];
  try {
    logProgress({ event: "seller-payment-platform-start", platform: "Lazada", total: orderNos.length });
    let current = 0;
    for (const orderNo of orderNos) {
      try {
        const row = await fetchLazadaPayment(session.page, orderNo);
        if (!row) {
          errors.push(`Lazada ${orderNo}: order not found`);
        } else {
          const record = {
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
          };
          records.push(record);
          if (onRecord) onRecord(record, { platform: "Lazada", current: current + 1, total: orderNos.length });
        }
      } catch (error) {
        errors.push(`Lazada ${orderNo}: ${error.message || error}`);
      }
      current += 1;
      logPaymentProgress("Lazada", current, orderNos.length, orderNo, records.length, errors.length);
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
      const existingRecord = existingMap.get(`${platform}|${orderNo}`);
      const needsItemAmountRefresh = existingRecord && recordNeedsItemAmountRefresh(existingRecord);
      if (!existingRecord || needsItemAmountRefresh) todo.push({ platform, orderNo, needsItemAmountRefresh });
    }
  }
  if (maxNew > 0) todo = todo.slice(0, maxNew);
  const cachedBefore = existingMap.size;

  logProgress({
    event: "seller-payment-targets",
    platforms,
    targetShopee: targets.Shopee.length,
    targetLazada: targets.Lazada.length,
    cachedBefore,
    requestedNew: todo.length,
    maxNew: maxNew > 0 ? maxNew : "all",
  });

  const errors = [];
  let fetchedNew = 0;
  let checkpointCount = 0;
  const checkpoint = (record, meta = {}) => {
    existingMap.set(`${record.platform}|${record.orderNo}`, record);
    fetchedNew += 1;
    if (fetchedNew === 1 || fetchedNew % progressEvery === 0) {
      checkpointCount += 1;
      const output = writePaymentOutput({
        existingMap,
        targets,
        cachedBefore,
        requestedNew: todo.length,
        fetchedNew,
        errors,
        partial: true,
      });
      logProgress({
        event: "seller-payment-checkpoint",
        platform: meta.platform || record.platform,
        fetchedNew,
        totalOrders: output.counts.totalOrders,
        errors: output.counts.errors,
        checkpoint: checkpointCount,
      });
    }
  };
  const shopeeOrders = todo.filter((item) => item.platform === "Shopee").map((item) => item.orderNo);
  const lazadaOrders = todo.filter((item) => item.platform === "Lazada").map((item) => item.orderNo);

  try {
    await exportShopeePayments(shopeeOrders, existingMap, errors, checkpoint);
  } catch (error) {
    errors.push(error.message || String(error));
  }
  if (fetchedNew > 0) {
    writePaymentOutput({ existingMap, targets, cachedBefore, requestedNew: todo.length, fetchedNew, errors, partial: true });
  }
  try {
    await exportLazadaPayments(lazadaOrders, existingMap, errors, checkpoint);
  } catch (error) {
    errors.push(error.message || String(error));
  }

  const output = writePaymentOutput({
    existingMap,
    targets,
    cachedBefore,
    requestedNew: todo.length,
    fetchedNew,
    errors,
    partial: false,
  });

  console.log(JSON.stringify({ ok: true, outputFile, counts: output.counts }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
