const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const seedFile = path.join(projectRoot, "data", "plain_design_products.json");
const outputFile = path.join(projectRoot, "data", "plain_design_ktw_logistics.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/^'+/, "").replace(/\.0$/, "").toUpperCase();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function moneyValue(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lengthToCm(value, unit) {
  const parsed = numberValue(value);
  const normalized = String(unit || "").trim().toUpperCase();
  if (!parsed) return 0;
  if (normalized === "MM") return parsed / 10;
  if (normalized === "M") return parsed * 100;
  return parsed;
}

function weightToKg(value, unit) {
  const parsed = numberValue(value);
  const normalized = String(unit || "").trim().toUpperCase();
  if (!parsed) return 0;
  if (normalized === "G" || normalized === "GRAM") return parsed / 1000;
  if (normalized === "MG") return parsed / 1000000;
  return parsed;
}

function productUrl(product) {
  return product.sourceUrl || `https://shop.ktw.co.th/p/${encodeURIComponent(normalizeSku(product.sku))}`;
}

function absoluteKtwUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text.replace(/^http:\/\//i, "https://");
  if (text.startsWith("//")) return `https:${text}`;
  return new URL(text, "https://shop.ktw.co.th").toString();
}

function normalizeCookieDomain(value) {
  return String(value || "").trim().replace(/^\./, "").toLowerCase();
}

function cookieMatchesUrl(cookie, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const cookieDomain = normalizeCookieDomain(cookie?.domain || host);
  const cookiePath = String(cookie?.path || "/");
  const expires = Number(cookie?.expires || 0);
  if (cookie?.secure && parsed.protocol !== "https:") return false;
  if (expires > 0 && expires < Date.now() / 1000) return false;
  if (cookieDomain && host !== cookieDomain && !host.endsWith(`.${cookieDomain}`)) return false;
  return parsed.pathname.startsWith(cookiePath);
}

function ktwCookieHeader(sourceUrl) {
  try {
    const { loadStorageState } = require(path.join(__dirname, "browser-auth-state.cjs"));
    const loaded = loadStorageState("ktw");
    const cookies = (loaded.state?.cookies || [])
      .filter((cookie) => cookieMatchesUrl(cookie, sourceUrl))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return cookies.join("; ");
  } catch {
    return "";
  }
}

function parseProductImages(html, sourceUrl) {
  const page = String(html || "");
  const collect = (patterns) => {
    const seen = new Set();
    const images = [];
    const pushImage = (url, alt = "") => {
      const absoluteUrl = absoluteKtwUrl(url);
      if (!absoluteUrl || !/\/medias\//i.test(absoluteUrl) || seen.has(absoluteUrl)) return;
      seen.add(absoluteUrl);
      images.push({
        url: absoluteUrl,
        alt: decodeHtml(alt),
        sourceUrl,
      });
    };

    for (const pattern of patterns) {
      for (const match of page.matchAll(pattern.regex)) {
        pushImage(match[1], pattern.alt?.(match) || "");
      }
    }
    return images.map((image, index) => ({ ...image, angleNo: index + 1 }));
  };

  const galleryImages = collect([
    {
      regex: /<a[^>]+href=["']([^"']+)["'][^>]*data-fancybox=["']gallery["'][^>]*>/gi,
    },
  ]);
  if (galleryImages.length) return galleryImages;

  return collect([
    {
      regex: /<img[^>]+class=["'][^"']*origin_img[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/gi,
      alt: (match) => match[0].match(/\b(?:alt|title)=["']([^"']*)["']/i)?.[1] || "",
    },
  ]);
}

function parseVisibleKtwSalePrice(html) {
  const text = decodeHtml(html);
  const labeledPatterns = [
    /(?:^|[^\u0E00-\u0E7F])ราคา\s*[:：]\s*([0-9,]+(?:\.\d+)?)\s*บาท/i,
    /(?:^|[^\u0E00-\u0E7F])ราคาสุทธิ\s*[:：]?\s*([0-9,]+(?:\.\d+)?)\s*บาท/i,
    /(?:^|[^\u0E00-\u0E7F])ราคาโปร(?:โมชัน)?\s*[:：]?\s*([0-9,]+(?:\.\d+)?)\s*บาท/i,
  ];
  for (const pattern of labeledPatterns) {
    const price = moneyValue(numberValue(text.match(pattern)?.[1]));
    if (price > 0) return price;
  }

  const discountMatch = text.match(
    /ราคาตั้ง\s*[:：]?\s*([0-9,]+(?:\.\d+)?)\s*(?:บาท)?\s*ลด\s*([0-9,]+(?:\.\d+)?)\s*%/i
  );
  const listPrice = numberValue(discountMatch?.[1]);
  const discountPercent = numberValue(discountMatch?.[2]);
  if (listPrice > 0 && discountPercent > 0 && discountPercent < 100) {
    return moneyValue(listPrice * (1 - discountPercent / 100));
  }

  return 0;
}

function parseKtwSourcePrice(html, sku, options = {}) {
  const page = String(html || "");
  const visibleSalePrice = parseVisibleKtwSalePrice(page);
  if (visibleSalePrice > 0) return visibleSalePrice;
  if (options.discountOnly) return 0;

  const normalizedSku = normalizeSku(sku);
  const skuPattern = escapeRegExp(normalizedSku);
  const skuScopedPatterns = [
    new RegExp(`[\\\"']item_id[\\\"']\\s*:\\s*[\\\"']${skuPattern}[\\\"'][\\s\\S]{0,700}?[\\\"']price[\\\"']\\s*:\\s*[\\\"']?([\\d,.]+)`, "i"),
    new RegExp(`[\\\"']item_id[\\\"']\\s*:\\s*[\\\"']${skuPattern}[\\\"'][\\s\\S]{0,700}?productPrice\\s*[:=]\\s*[\\\"']?([\\d,.]+)`, "i"),
  ];
  for (const pattern of skuScopedPatterns) {
    const match = page.match(pattern);
    const price = numberValue(match?.[1]);
    if (price > 0) return moneyValue(price);
  }

  const fallbackPatterns = [
    /\/\/KTW-\d+[^'"]*pdp price[\s\S]{0,120}?['"]price['"]\s*:\s*['"]?([\d,.]+)/i,
    /['"]price['"]\s*:\s*['"]?([\d,.]+)[\s\S]{0,120}?['"]item_brand['"]/i,
  ];
  for (const pattern of fallbackPatterns) {
    const match = page.match(pattern);
    const price = numberValue(match?.[1]);
    if (price > 0) return moneyValue(price);
  }
  return 0;
}

function parseConversionUnitTable(html) {
  const tableMatch = String(html).match(/id=["']conversionunit["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tableMatch) return null;

  const rows = [...tableMatch[1].matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeHtml(cell[1])))
    .filter((columns) => columns.length >= 10)
    .map((columns) => ({
      x: numberValue(columns[0]),
      altUnit: columns[1],
      y: numberValue(columns[2]),
      baseUnit: columns[3],
      length: numberValue(columns[4]),
      width: numberValue(columns[5]),
      height: numberValue(columns[6]),
      dimensionUnit: columns[7],
      weight: numberValue(columns[8]),
      weightUnit: columns[9],
    }));

  const selected =
    rows.find((row) => row.altUnit.toUpperCase() === "PCS" && row.baseUnit.toUpperCase() === "PCS") ||
    rows.find((row) => row.baseUnit.toUpperCase() === "PCS") ||
    rows[0];
  if (!selected) return null;

  const quantityDivisor = selected.altUnit.toUpperCase() === "PCS" ? 1 : selected.y || 1;
  return {
    widthCm: moneyValue(lengthToCm(selected.width, selected.dimensionUnit)),
    lengthCm: moneyValue(lengthToCm(selected.length, selected.dimensionUnit)),
    heightCm: moneyValue(lengthToCm(selected.height, selected.dimensionUnit)),
    unitWeightKg: moneyValue(weightToKg(selected.weight, selected.weightUnit) / quantityDivisor),
    raw: selected,
  };
}

async function fetchProductKtwData(product) {
  const sku = normalizeSku(product.sku);
  const sourceUrl = productUrl(product);
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "th-TH,th;q=0.9,en;q=0.8",
    "user-agent": "Mozilla/5.0",
  };
  const cookie = ktwCookieHeader(sourceUrl);
  if (cookie) headers.cookie = cookie;
  const response = await fetch(sourceUrl, {
    headers,
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`KTW returned ${response.status}`);
  }
  const html = await response.text();
  const parsed = parseConversionUnitTable(html);
  const ktwImages = parseProductImages(html, sourceUrl);
  const visibleSourcePrice = parseKtwSourcePrice(html, sku, { discountOnly: true });
  const sourcePrice = visibleSourcePrice || moneyValue(numberValue(product.ktwPrice)) || parseKtwSourcePrice(html, sku);
  const logisticsValid = Boolean(parsed?.widthCm && parsed?.lengthCm && parsed?.heightCm && parsed?.unitWeightKg);
  const logisticsIssue = !parsed
    ? "conversion-unit table was not found"
    : logisticsValid
    ? ""
    : "KTW conversion-unit row has zero dimension or weight";
  return {
    sku,
    sourceLabel: "shop.ktw.co.th",
    sourceUrl,
    capturedAt: new Date().toISOString(),
    sourcePrice,
    priceSourceLabel: "shop.ktw.co.th",
    priceCapturedAt: new Date().toISOString(),
    priceValid: sourcePrice > 0,
    widthCm: parsed?.widthCm || 0,
    lengthCm: parsed?.lengthCm || 0,
    heightCm: parsed?.heightCm || 0,
    unitWeightKg: parsed?.unitWeightKg || 0,
    logisticsValid,
    logisticsIssue,
    ktwImages,
    imageCount: ktwImages.length,
    raw: parsed?.raw || {},
  };
}

async function main() {
  const seed = readJson(seedFile);
  const products = seed.products || [];
  const items = [];
  const missing = [];

  for (const product of products) {
    const sku = normalizeSku(product.sku);
    try {
      const item = await fetchProductKtwData(product);
      items.push(item);
      const logisticsText = item.logisticsValid
        ? `${item.lengthCm} x ${item.widthCm} x ${item.heightCm} cm, ${item.unitWeightKg} kg`
        : item.logisticsIssue;
      console.log(`${sku}: ${logisticsText}; ${item.imageCount} images`);
      if (item.logisticsIssue) {
        missing.push({ sku, sourceUrl: productUrl(product), message: item.logisticsIssue });
      }
    } catch (error) {
      missing.push({ sku, sourceUrl: productUrl(product), message: error.message });
      console.warn(`${sku}: ${error.message}`);
    }
  }

  const payload = {
    createdAt: new Date().toISOString(),
    sourceLabel: "shop.ktw.co.th",
    source: "KTW product page data",
    itemCount: items.length,
    missingCount: missing.length,
    items,
    missing,
  };

  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${path.relative(projectRoot, outputFile)} (${items.length}/${products.length} items)`);
  if (!items.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
