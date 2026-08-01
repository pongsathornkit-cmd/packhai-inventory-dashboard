const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const defaultPiFile = path.join(projectRoot, "data", "wynns_pi_20260731.json");
const defaultSeedFile = path.join(projectRoot, "data", "plain_design_products.json");
const sourceDocument = "PI 20260731";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function money(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function productName(item) {
  const sku = normalizeSku(item.sku).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(item.description || "")
    .replace(new RegExp(`^[（(]\\s*${sku}\\s*[）)]\\s*`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function assertPiReconciles(pi) {
  const items = Array.isArray(pi?.items) ? pi.items : [];
  const totalQuantity = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const totalRmb = money(items.reduce((total, item) => total + Number(item.amountRmb || 0), 0));
  const totalUsd = money(items.reduce((total, item) => total + Number(item.amountUsd || 0), 0));
  const uniqueSkus = new Set(items.map((item) => normalizeSku(item.sku)));

  if (items.length !== 97 || uniqueSkus.size !== 97) {
    throw new Error(`Expected 97 unique PI items, found ${items.length} rows and ${uniqueSkus.size} unique SKUs.`);
  }
  if (totalQuantity !== 6957 || totalRmb !== 83750.41 || totalUsd !== 12425.91) {
    throw new Error(`PI reconciliation failed: ${totalQuantity} pcs, RMB ${totalRmb}, USD ${totalUsd}.`);
  }
  if (pi.shippingFeeRmb !== null || pi.shippingFeeUsd !== null) {
    throw new Error("PI shipping fees must stay null because the source document leaves them blank.");
  }
}

function toPlainProduct(item) {
  const sku = normalizeSku(item.sku);
  return {
    sku,
    name: productName(item),
    category: "wynns_tools",
    ktwPrice: 0,
    orderQuantity: Number(item.quantity || 0),
    purchaseUnitCostUsd: Number(item.unitCostUsd || 0),
    purchaseUnitCostRmb: Number(item.unitCostRmb || 0),
    supplierAmountUsd: Number(item.amountUsd || 0),
    supplierAmountRmb: Number(item.amountRmb || 0),
    unitsPerCarton: Number(item.unitsPerCarton || 0),
    sourceDocument,
    sourceImageUrl: "",
    sourceUrl: "",
    status: "waiting_ai_images",
    notes: [
      sourceDocument,
      `${Number(item.unitsPerCarton || 0)} pcs/ctn`,
      `RMB ${Number(item.unitCostRmb || 0)}/pc`,
      `Amount RMB ${Number(item.amountRmb || 0)}`,
      `Amount USD ${Number(item.amountUsd || 0)}`,
      "shipping fee not stated",
    ].join(" | "),
  };
}

function mergeWynnsPiProducts(seed, pi) {
  assertPiReconciles(pi);
  const piSkus = new Set(pi.items.map((item) => normalizeSku(item.sku)));
  const existingProducts = (Array.isArray(seed?.products) ? seed.products : []).filter((product) => {
    const sku = normalizeSku(product.sku);
    return product.sourceDocument !== sourceDocument && !piSkus.has(sku);
  });
  const categoryOptions = Array.isArray(seed?.categoryOptions) ? [...seed.categoryOptions] : [];
  if (!categoryOptions.some((category) => category.id === "wynns_tools")) {
    categoryOptions.push({ id: "wynns_tools", label: "Wynn's Tools" });
  }

  return {
    ...seed,
    categoryOptions,
    products: [...existingProducts, ...pi.items.map(toPlainProduct)],
  };
}

function importWynnsPiProducts({ piFile = defaultPiFile, seedFile = defaultSeedFile } = {}) {
  const pi = readJson(piFile);
  const seed = readJson(seedFile);
  const merged = mergeWynnsPiProducts(seed, pi);
  fs.writeFileSync(seedFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return {
    imported: pi.items.length,
    totalProducts: merged.products.length,
    seedFile,
  };
}

if (require.main === module) {
  const result = importWynnsPiProducts();
  console.log(`${result.imported} Wynn's PI products merged; ${result.totalProducts} total products`);
}

module.exports = {
  assertPiReconciles,
  importWynnsPiProducts,
  mergeWynnsPiProducts,
  productName,
  toPlainProduct,
};
