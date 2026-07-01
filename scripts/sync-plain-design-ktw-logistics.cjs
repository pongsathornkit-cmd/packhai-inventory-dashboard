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

async function fetchProductLogistics(product) {
  const sku = normalizeSku(product.sku);
  const sourceUrl = productUrl(product);
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "th-TH,th;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`KTW returned ${response.status}`);
  }
  const html = await response.text();
  const parsed = parseConversionUnitTable(html);
  if (!parsed) {
    throw new Error("conversion-unit table was not found");
  }
  if (!parsed.widthCm || !parsed.lengthCm || !parsed.heightCm || !parsed.unitWeightKg) {
    throw new Error("KTW conversion-unit row has zero dimension or weight");
  }
  return {
    sku,
    sourceLabel: "shop.ktw.co.th",
    sourceUrl,
    capturedAt: new Date().toISOString(),
    ...parsed,
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
      const item = await fetchProductLogistics(product);
      items.push(item);
      console.log(`${sku}: ${item.lengthCm} x ${item.widthCm} x ${item.heightCm} cm, ${item.unitWeightKg} kg`);
    } catch (error) {
      missing.push({ sku, sourceUrl: productUrl(product), message: error.message });
      console.warn(`${sku}: ${error.message}`);
    }
  }

  const payload = {
    createdAt: new Date().toISOString(),
    sourceLabel: "shop.ktw.co.th",
    source: "KTW product conversion-unit table",
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
