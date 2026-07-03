const fs = require("fs");
const path = require("path");
const { chromium, chromiumOptions } = require("./playwright-runtime.cjs");
const { mergeAlibabaOrderDetailProducts } = require("./alibaba-purchase-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB|USD|CNY|Sets|pcs|items/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function defaultInputFile() {
  return path.join(projectRoot, "data", "alibaba_purchase_orders.json");
}

function defaultStorageStateFile() {
  return path.join(projectRoot, "storage-states", "alibaba.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function extractAlibabaDetailProducts(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }

    function amount(value) {
      const parsed = Number(String(value || "").replace(/[,\\s]|THB|USD|CNY|Sets|pcs|items/gi, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function imageUrlFrom(row) {
      const img = row.querySelector("img[src]");
      if (!img) return "";
      return img.currentSrc || img.src || img.getAttribute("src") || "";
    }

    const productList = document.querySelector(".product-list");
    const rows = [...(productList || document).querySelectorAll("tr")].filter((row) => {
      const text = clean(row.textContent);
      return row.querySelector('a[href*="product-detail"]') && !/^Product name/i.test(text);
    });

    let detailProducts = rows
      .map((row) => {
        const cells = [...row.querySelectorAll("td, th")];
        const link = row.querySelector('a[href*="product-detail"]');
        const title = clean(link?.textContent) || clean(cells[0]?.textContent);
        const skuText = clean(cells[1]?.textContent);
        const unitPriceText = clean(cells[2]?.textContent);
        const quantityText = clean(cells[3]?.textContent);
        const totalText = clean(cells[4]?.textContent);
        return {
          title,
          skuText,
          unitPriceText,
          unitPrice: amount(unitPriceText),
          quantityText,
          quantity: amount(quantityText),
          totalText,
          totalAmount: amount(totalText),
          productUrl: link?.href || "",
          imageUrl: imageUrlFrom(row),
        };
      })
      .filter((product) => product.title || product.productUrl || product.imageUrl);

    if (!detailProducts.length) {
      const bodyText = clean(document.body?.innerText || "");
      const match = bodyText.match(/Product name:\s*(.+?)(?:Attached files:|Shipment details|Payment details|Supplier details|Alibaba\.com order protection|$)/i);
      const productNameText = clean(match?.[1] || "");
      detailProducts = productNameText
        .split(/\s*;\s*/)
        .map((title) => ({ title: clean(title), skuText: "", quantity: 0, productUrl: "", imageUrl: "" }))
        .filter((product) => product.title);
    }

    return {
      capturedAt: new Date().toISOString(),
      capturedUrl: location.href,
      products: detailProducts,
    };
  });
}

async function enrichAlibabaPurchaseOrders(options = {}) {
  const inputFile = path.resolve(options.inputFile || argValue("input", process.env.ALIBABA_PURCHASE_ORDERS_FILE || defaultInputFile()));
  const outputFile = path.resolve(options.outputFile || argValue("output", inputFile));
  const storageState = path.resolve(
    options.storageState ||
      argValue("storage-state", process.env.ALIBABA_STORAGE_STATE_FILE || process.env.ALIBABA_STORAGE_STATE || defaultStorageStateFile())
  );
  const limit = numberValue(options.limit || argValue("limit", process.env.ALIBABA_DETAIL_ENRICH_LIMIT || ""));

  if (!fs.existsSync(inputFile)) throw new Error(`Alibaba purchase order input not found: ${inputFile}`);
  if (!fs.existsSync(storageState)) throw new Error(`Alibaba storageState not found: ${storageState}`);

  const source = readJson(inputFile);
  const orders = Array.isArray(source.orders) ? source.orders : Array.isArray(source.rows) ? source.rows : [];
  const targetOrders = limit > 0 ? orders.slice(0, limit) : orders;
  const browser = await chromium.launch(chromiumOptions({ headless: true }));
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const errors = [];
  let enriched = 0;

  try {
    for (const order of targetOrders) {
      if (!order || !order.orderUrl) continue;
      try {
        await page.goto(order.orderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(".product-list", { timeout: 20000 });
        const detail = await extractAlibabaDetailProducts(page);
        const merged = mergeAlibabaOrderDetailProducts(order, detail);
        if ((merged.products || []).length > (order.products || []).length) enriched += 1;
        Object.assign(order, merged);
      } catch (error) {
        errors.push({ orderNo: order.orderNo || "", message: error.message });
        order.productDetailError = error.message;
      }
    }
  } finally {
    await context.storageState({ path: storageState }).catch(() => {});
    await browser.close();
  }

  source.productDetailEnrichedAt = new Date().toISOString();
  source.productDetailEnrichedOrderCount = enriched;
  source.productDetailEnrichmentErrors = errors;
  writeJson(outputFile, source);

  return {
    ok: true,
    inputFile,
    outputFile,
    orderCount: targetOrders.length,
    enriched,
    errors: errors.length,
  };
}

if (require.main === module) {
  enrichAlibabaPurchaseOrders()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = {
  enrichAlibabaPurchaseOrders,
  extractAlibabaDetailProducts,
};
