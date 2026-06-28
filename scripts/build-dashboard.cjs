const fs = require("fs");
const path = require("path");
const {
  buildPlatformPaymentSummary,
  buildSellerPaymentIndex,
  enrichMovementWithSellerPayment,
} = require("./seller-order-payment-core.cjs");
const { selectPublicSyncApiBase } = require("./sync-api-base-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const srcDir = path.join(projectRoot, "src");
const distDir = path.join(projectRoot, "dist");
const localSyncApiBaseFile = path.join(projectRoot, ".sync-api-base.local");
const dataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : path.join(projectRoot, "data");

function preferExisting(primary, fallback) {
  return fs.existsSync(primary) ? primary : fallback;
}

const inputFiles = {
  packhai: preferExisting(
    path.join(dataDir, "packhai_stock.json"),
    path.join(workspaceRoot, "packhai_stock_20260622.json")
  ),
  flowaccount: preferExisting(
    path.join(dataDir, "flowaccount_stock_selected_warehouses.json"),
    path.join(workspaceRoot, "flowaccount_stock_selected_warehouses.json")
  ),
  shopee: preferExisting(
    path.join(dataDir, "seller_compare", "shopee_products_export.json"),
    path.join(workspaceRoot, "outputs", "seller_compare", "shopee_products_export.json")
  ),
  lazada: preferExisting(
    path.join(dataDir, "seller_compare", "lazada_products_export.json"),
    path.join(workspaceRoot, "outputs", "seller_compare", "lazada_products_export.json")
  ),
  ktw: preferExisting(
    path.join(dataDir, "ktw_product_source", "ktw_price_update_plan.json"),
    path.join(workspaceRoot, "outputs", "ktw_product_source", "ktw_price_update_plan.json")
  ),
  sellerPayments: preferExisting(
    path.join(dataDir, "seller_compare", "seller_order_payments.json"),
    path.join(workspaceRoot, "outputs", "seller_compare", "seller_order_payments.json")
  ),
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function readOptionalJson(file, fallback) {
  try {
    return readJson(file);
  } catch {
    return fallback;
  }
}

function readPublicSyncApiBase() {
  let localFileSyncApiBase = "";
  try {
    localFileSyncApiBase = fs.readFileSync(localSyncApiBaseFile, "utf8");
  } catch {
    localFileSyncApiBase = "";
  }
  return selectPublicSyncApiBase({
    publicSyncApiBase: process.env.PUBLIC_SYNC_API_BASE,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL,
    localFileSyncApiBase,
  });
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    return numberValue(value.priceEndValue ?? value.priceStartValue ?? value.text ?? value.value ?? value.stock);
  }
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\.0$/, "")
    .toUpperCase();
}

function compactSku(value) {
  return normalizeSku(value).replace(/[\s\-_/]+/g, "");
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function emptyFlowaccountStock() {
  return {
    exportedAt: "",
    source: "https://advance.flowaccount.com/N8387296/business/reports/inventory",
    syncDate: "",
    rowCount: 0,
    uniqueSkuCount: 0,
    duplicateSkus: [],
    warehouses: [
      { id: 491661, name: "คลัง ซ.เจริญกิจ", rowCount: 0 },
      { id: 491662, name: "คลัง สุขสวัสดิ์", rowCount: 0 },
    ],
    rows: [],
  };
}

function emptySellerPayments() {
  return {
    exportedAt: "",
    source: "Seller platform order payments",
    orders: [],
  };
}

function groupPackhaiMovements(packhai, paymentIndex) {
  const byStockShopId = new Map();
  for (const movement of packhai.stockMovement?.rows || []) {
    const enriched = enrichMovementWithSellerPayment(movement, paymentIndex);
    const key = Number(enriched.stockShopId || 0);
    if (!key) continue;
    if (!byStockShopId.has(key)) byStockShopId.set(key, []);
    byStockShopId.get(key).push(enriched);
  }
  for (const list of byStockShopId.values()) {
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }
  return byStockShopId;
}

function stockSourceLabel(item) {
  const warehouseName = String(item.warehouseName || "").trim();
  if (item.stockSource === "FlowAccount") return warehouseName ? `FlowAccount - ${warehouseName}` : "FlowAccount";
  if (item.stockSource === "GitHub") return warehouseName ? `GitHub - ${warehouseName}` : "GitHub";
  return warehouseName || "คลัง Packhai";
}

function buildStockRows(packhai, flowaccount, paymentIndex) {
  const packhaiMovementsByStockShopId = groupPackhaiMovements(packhai, paymentIndex);
  const packhaiRows = (packhai.rows || []).map((item) => ({
    ...item,
    stockSource: "Packhai",
    stockMovements: packhaiMovementsByStockShopId.get(Number(item.stockShopId || 0)) || [],
    warehouseId: item.warehouseId || "packhai",
    warehouseName: item.warehouseName || "คลัง Packhai",
    stockSourceLabel: stockSourceLabel({ stockSource: "Packhai", warehouseName: item.warehouseName || "คลัง Packhai" }),
  }));

  const flowRows = (flowaccount.rows || []).map((item) => ({
    ...item,
    stockSource: "FlowAccount",
    warehouseId: item.warehouseId || "",
    warehouseName: item.warehouseName || "",
    stockSourceLabel: stockSourceLabel({ stockSource: "FlowAccount", warehouseName: item.warehouseName || "" }),
  }));

  return [...packhaiRows, ...flowRows];
}

function thaiDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function makePriceIndex(sourceName) {
  return {
    sourceName,
    bySku: new Map(),
    byCompactSku: new Map(),
    rowCount: 0,
  };
}

function addCandidate(index, sku, candidate) {
  const normalized = normalizeSku(sku);
  if (!normalized) return;
  const next = {
    ...candidate,
    sourceSku: normalizeSku(candidate.sourceSku || normalized),
    price: roundMoney(numberValue(candidate.price)),
    sourceName: index.sourceName,
  };
  if (!index.bySku.has(normalized)) index.bySku.set(normalized, []);
  index.bySku.get(normalized).push(next);

  const compact = compactSku(normalized);
  if (compact) {
    if (!index.byCompactSku.has(compact)) index.byCompactSku.set(compact, []);
    index.byCompactSku.get(compact).push(next);
  }
  index.rowCount += 1;
}

function chooseCandidate(list) {
  if (!list?.length) return null;
  const priced = list.filter((item) => item.price > 0);
  if (!priced.length) return null;
  return [...priced].sort((a, b) => {
    if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
    if (Number(b.active) !== Number(a.active)) return Number(b.active) - Number(a.active);
    if (a.price !== b.price) return a.price - b.price;
    return numberValue(b.stock) - numberValue(a.stock);
  })[0];
}

function lookupPrice(index, sku) {
  const normalized = normalizeSku(sku);
  const exactList = index.bySku.get(normalized) || [];
  const exact = chooseCandidate(exactList);
  if (exact) return { ...exact, matchType: "exact", candidateCount: exactList.length };

  const compact = compactSku(normalized);
  const compactList = index.byCompactSku.get(compact) || [];
  const compactMatch = chooseCandidate(compactList);
  if (compactMatch) return { ...compactMatch, matchType: "compact", candidateCount: compactList.length };
  return null;
}

function chooseImageCandidate(list) {
  if (!list?.length) return null;
  return (
    [...list]
      .filter((item) => item.imageUrl)
      .sort((a, b) => {
        if ((a.priority || 99) !== (b.priority || 99)) return (a.priority || 99) - (b.priority || 99);
        if (Number(b.active) !== Number(a.active)) return Number(b.active) - Number(a.active);
        return numberValue(b.stock) - numberValue(a.stock);
      })[0] || null
  );
}

function lookupImage(index, sku) {
  const normalized = normalizeSku(sku);
  const exact = chooseImageCandidate(index.bySku.get(normalized) || []);
  if (exact) return { ...exact, matchType: "exact" };

  const compact = compactSku(normalized);
  const compactMatch = chooseImageCandidate(index.byCompactSku.get(compact) || []);
  if (compactMatch) return { ...compactMatch, matchType: "compact" };
  return null;
}

function selectImage(sku, indices, selectedPrice) {
  if (selectedPrice?.imageUrl) return selectedPrice;
  return lookupImage(indices.shopee, sku) || lookupImage(indices.lazada, sku) || lookupImage(indices.ktw, sku) || null;
}

function shopeePrice(product, model) {
  const productPrice = product.raw?.price_detail || {};
  const modelPrice = model?.price_detail || {};
  return (
    firstPositive(
      modelPrice.promotion_price,
      modelPrice.origin_price,
      productPrice.selling_price_min,
      productPrice.price_min,
      productPrice.selling_price_max,
      productPrice.price_max
    ) || 0
  );
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function shopeeImageUrl(...values) {
  const image = firstText(...values);
  if (!image) return "";
  if (/^https?:\/\//i.test(image)) return image;
  return `https://down-th.img.susercontent.com/file/${image}`;
}

function lazadaImageUrl(product, skuRow) {
  return firstText(
    skuRow?.imageUrl,
    skuRow?.raw?.itemDesc?.skuImg,
    product?.imageUrl,
    product?.raw?.itemDesc?.imageUrl
  );
}

function buildShopeeIndex(shopee) {
  const index = makePriceIndex("Shopee");
  const groupPriority = {
    liveAll: 1,
    all: 2,
    deboosted: 3,
    reviewing: 4,
    delisted: 5,
    draft: 6,
  };

  for (const product of shopee.products || []) {
    const raw = product.raw || {};
    const base = {
      sourceLabel: "Shopee Seller Center",
      sourceGroup: product.source_group,
      priority: groupPriority[product.source_group] || 9,
      active: product.status === 1 || raw.status === 1,
      stock: numberValue(product.stock),
      title: product.name || raw.name || "",
      productId: product.id || raw.id || "",
      sourceCapturedAt: shopee.exportedAt,
      imageUrl: shopeeImageUrl(raw.cover_image),
      imageSource: "Shopee",
    };
    addCandidate(index, product.parent_sku, {
      ...base,
      sourceSku: product.parent_sku,
      price: shopeePrice(product),
    });

    for (const model of raw.model_list || []) {
      const modelSku = model.sku || (model.is_default ? product.parent_sku : "");
      addCandidate(index, modelSku, {
        ...base,
        sourceSku: modelSku || product.parent_sku,
        price: shopeePrice(product, model),
        stock: numberValue(model.stock_detail?.total_available_stock ?? product.stock),
        modelId: model.id || "",
        imageUrl: shopeeImageUrl(model.image, raw.cover_image),
        imageSource: "Shopee",
      });
    }
  }
  return index;
}

function lazadaFinalPrice(product, skuRow) {
  const skuPrice = skuRow?.raw?.price || {};
  const productPrice = product?.raw?.price || {};
  return firstPositive(
    skuPrice.specialPriceEndValue,
    skuPrice.specialPriceStartValue,
    skuPrice.specialPrice,
    productPrice.specialPriceEndValue,
    productPrice.specialPriceStartValue,
    productPrice.specialPrice,
    product.price,
    skuPrice.priceEndValue,
    skuPrice.priceStartValue,
    skuRow.price,
    productPrice.priceEndValue,
    productPrice.priceStartValue,
    productPrice.price
  );
}

function buildLazadaIndex(lazada) {
  const index = makePriceIndex("Lazada");
  for (const product of lazada.products || []) {
    const rows = Array.isArray(product.skuRows) && product.skuRows.length ? product.skuRows : [product];
    for (const skuRow of rows) {
      const sellerSku = skuRow.sellerSku || skuRow.normalizedSellerSku || product.sellerSku || "";
      addCandidate(index, sellerSku, {
        sourceLabel: "Lazada Seller Center",
        priority: 1,
        active: skuRow.active !== false,
        stock: numberValue(skuRow.stock ?? skuRow.raw?.stock ?? product.stock),
        price: lazadaFinalPrice(product, skuRow),
        sourceSku: sellerSku,
        title: product.title || skuRow.title || "",
        productId: product.productId || skuRow.productId || "",
        sourceUrl: product.pdpLink || skuRow.pdpLink || "",
        sourceCapturedAt: lazada.exportedAt,
        imageUrl: lazadaImageUrl(product, skuRow),
        imageSource: "Lazada",
      });
    }
  }
  return index;
}

function buildKtwIndex(ktw) {
  const index = makePriceIndex("KTW");
  for (const item of ktw.items || []) {
    addCandidate(index, item.sku, {
      sourceLabel: "ktw.co.th",
      priority: 1,
      active: true,
      stock: numberValue(item.sourceStock),
      price: numberValue(item.sourcePrice),
      sourceSku: item.sku,
      title: item.title || "",
      sourceUrl: item.sourceUrl || "",
      sourceCapturedAt: item.sourceCapturedAt || ktw.createdAt,
    });
  }
  return index;
}

function skuPrefix(sku) {
  const normalized = normalizeSku(sku);
  if (!normalized) return "ไม่ระบุ";
  if (normalized.includes("-")) return normalized.split("-")[0] || "ไม่ระบุ";
  const letters = normalized.match(/^[A-Z]+/);
  if (letters) return letters[0];
  const digits = normalized.match(/^\d{2,}/);
  if (digits) return "Numeric";
  return "อื่นๆ";
}

function rowNote(row, selectedPrice, traces) {
  const notes = [];
  if (numberValue(row.quantity) < 0) notes.push("จำนวนคงเหลือติดลบ");
  if (numberValue(row.waiting) > 0) notes.push("มีจำนวนรอจัด/รอส่ง");
  if (selectedPrice?.matchType === "compact") notes.push("match SKU แบบตัดช่องว่าง/ขีด");
  if (!selectedPrice) {
    const seen = traces.filter(Boolean).map((item) => item.sourceName).join(", ");
    notes.push(seen ? `พบ SKU แต่ราคาไม่สมบูรณ์ใน ${seen}` : "ไม่พบราคาจาก Shopee/Lazada/KTW");
  }
  return notes.join("; ");
}

function selectPrice(sku, indices) {
  const shopee = lookupPrice(indices.shopee, sku);
  if (shopee) return { selected: shopee, traces: [shopee] };
  const lazada = lookupPrice(indices.lazada, sku);
  if (lazada) return { selected: lazada, traces: [shopee, lazada] };
  const ktw = lookupPrice(indices.ktw, sku);
  if (ktw) return { selected: ktw, traces: [shopee, lazada, ktw] };
  return { selected: null, traces: [shopee, lazada, ktw] };
}

function summarizeRows(rows, stockSources, shopee, lazada, ktw, indices) {
  const sourceBreakdown = new Map();
  const warehouseBreakdown = new Map();
  const prefixBreakdown = new Map();
  const missingPriceRows = [];
  const negativeStockRows = [];
  const waitingRows = [];
  const compactMatchedRows = [];

  const summary = {
    rowCount: rows.length,
    uniqueSkuCount: new Set(rows.map((row) => row.sku).filter(Boolean)).size,
    positiveStockRows: 0,
    valuedPositiveRows: 0,
    missingPositiveRows: 0,
    totalQuantity: 0,
    totalWaiting: 0,
    totalAvailable: 0,
    totalInventoryValue: 0,
    totalAvailableValue: 0,
    totalWaitingValue: 0,
    maxRowValue: 0,
    duplicateSkuRows: stockSources.duplicateSkuRows || 0,
    imageRows: 0,
  };

  for (const row of rows) {
    const source = row.priceSource || "Missing";
    if (!sourceBreakdown.has(source)) {
      sourceBreakdown.set(source, {
        source,
        rowCount: 0,
        positiveStockRows: 0,
        quantity: 0,
        value: 0,
      });
    }
    const sourceItem = sourceBreakdown.get(source);
    sourceItem.rowCount += 1;
    sourceItem.quantity += Math.max(0, row.quantity);
    sourceItem.value += row.inventoryValue;
    if (row.quantity > 0) sourceItem.positiveStockRows += 1;

    const warehouseKey = `${row.stockSource || "Unknown"}|${row.warehouseName || ""}`;
    if (!warehouseBreakdown.has(warehouseKey)) {
      warehouseBreakdown.set(warehouseKey, {
        stockSource: row.stockSource || "Unknown",
        warehouseId: row.warehouseId || "",
        warehouseName: row.warehouseName || row.stockSource || "Unknown",
        rowCount: 0,
        positiveStockRows: 0,
        quantity: 0,
        value: 0,
      });
    }
    const warehouseItem = warehouseBreakdown.get(warehouseKey);
    warehouseItem.rowCount += 1;
    warehouseItem.quantity += Math.max(0, row.quantity);
    warehouseItem.value += row.inventoryValue;
    if (row.quantity > 0) warehouseItem.positiveStockRows += 1;

    const prefix = row.skuPrefix;
    if (!prefixBreakdown.has(prefix)) {
      prefixBreakdown.set(prefix, { prefix, rowCount: 0, quantity: 0, value: 0 });
    }
    const prefixItem = prefixBreakdown.get(prefix);
    prefixItem.rowCount += 1;
    prefixItem.quantity += Math.max(0, row.quantity);
    prefixItem.value += row.inventoryValue;

    if (row.quantity > 0) {
      summary.positiveStockRows += 1;
      summary.totalQuantity += row.quantity;
      if (row.price > 0) summary.valuedPositiveRows += 1;
      if (row.price <= 0) {
        summary.missingPositiveRows += 1;
        missingPriceRows.push(row);
      }
    }
    if (row.quantity < 0) negativeStockRows.push(row);
    if (row.waiting > 0) waitingRows.push(row);
    if (row.priceMatchType === "compact") compactMatchedRows.push(row);
    if (row.imageUrl) summary.imageRows += 1;

    summary.totalWaiting += Math.max(0, row.waiting);
    summary.totalAvailable += Math.max(0, row.available);
    summary.totalInventoryValue += row.inventoryValue;
    summary.totalAvailableValue += row.availableValue;
    summary.totalWaitingValue += row.waitingValue;
    summary.maxRowValue = Math.max(summary.maxRowValue, row.inventoryValue);
  }

  for (const key of ["totalInventoryValue", "totalAvailableValue", "totalWaitingValue"]) {
    summary[key] = roundMoney(summary[key]);
  }

  const sourceOrder = { Shopee: 1, Lazada: 2, KTW: 3, Missing: 4 };
  const sourceRows = [...sourceBreakdown.values()]
    .map((item) => ({ ...item, value: roundMoney(item.value), quantity: roundMoney(item.quantity) }))
    .sort((a, b) => (sourceOrder[a.source] || 9) - (sourceOrder[b.source] || 9));

  const prefixRows = [...prefixBreakdown.values()]
    .map((item) => ({ ...item, value: roundMoney(item.value), quantity: roundMoney(item.quantity) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const warehouseRows = [...warehouseBreakdown.values()]
    .map((item) => ({ ...item, value: roundMoney(item.value), quantity: roundMoney(item.quantity) }))
    .sort((a, b) => b.value - a.value || b.quantity - a.quantity);

  const topProducts = [...rows]
    .filter((row) => row.inventoryValue > 0)
    .sort((a, b) => b.inventoryValue - a.inventoryValue)
    .slice(0, 30);
  const stockMovementMeta = stockSources.packhai.stockMovement
    ? {
        ...stockSources.packhai.stockMovement,
        rows: undefined,
        file: "stock-movements.json",
      }
    : null;

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedAtLabel: thaiDateTime(new Date().toISOString()),
      reportTitle: "สรุปมูลค่าสินค้าคงคลัง Packhai + FlowAccount",
      valuationRule:
        "มูลค่าคงเหลือ = จำนวนคงเหลือจาก Packhai และ FlowAccount เฉพาะคลัง ซ.เจริญกิจ / คลัง สุขสวัสดิ์ (เฉพาะค่าบวก) x ราคาขาย ตามลำดับ Shopee Seller > Lazada Seller > ktw.co.th",
      quantityRule:
        "ใช้ field quantity จาก Packhai และ remaining จาก FlowAccount sync เป็นจำนวนคงเหลือในคลัง โดย FlowAccount sync ดึงเฉพาะคลัง ซ.เจริญกิจ และคลัง สุขสวัสดิ์เท่านั้น",
      pricePriority: ["Shopee Seller Center", "Lazada Seller Center", "ktw.co.th"],
      sources: {
        packhai: {
          file: path.relative(projectRoot, inputFiles.packhai).replace(/\\/g, "/"),
          source: stockSources.packhai.source || "https://shop.packhai.com/my-stock",
          exportedAt: stockSources.packhai.exportedAt,
          exportedAtLabel: thaiDateTime(stockSources.packhai.exportedAt),
          rowCount: stockSources.packhai.rowCount,
          uniqueSkuCount: stockSources.packhai.uniqueSkuCount,
          stockMovement: stockMovementMeta,
        },
        flowaccount: {
          file: path.relative(projectRoot, inputFiles.flowaccount).replace(/\\/g, "/"),
          source: stockSources.flowaccount.source || "https://advance.flowaccount.com/N8387296/business/reports/inventory",
          storage: "flowaccount-sync",
          exportedAt: stockSources.flowaccount.exportedAt,
          exportedAtLabel: thaiDateTime(stockSources.flowaccount.exportedAt),
          rowCount: stockSources.flowaccount.rowCount,
          uniqueSkuCount: stockSources.flowaccount.uniqueSkuCount,
          warehouses: stockSources.flowaccount.warehouses || [],
        },
        shopee: {
          file: path.relative(projectRoot, inputFiles.shopee).replace(/\\/g, "/"),
          exportedAt: shopee.exportedAt,
          exportedAtLabel: thaiDateTime(shopee.exportedAt),
          counts: shopee.counts,
          indexedPriceRows: indices.shopee.rowCount,
        },
        lazada: {
          file: path.relative(projectRoot, inputFiles.lazada).replace(/\\/g, "/"),
          exportedAt: lazada.exportedAt,
          exportedAtLabel: thaiDateTime(lazada.exportedAt),
          counts: lazada.counts,
          indexedPriceRows: indices.lazada.rowCount,
        },
        ktw: {
          file: path.relative(projectRoot, inputFiles.ktw).replace(/\\/g, "/"),
          createdAt: ktw.createdAt,
          createdAtLabel: thaiDateTime(ktw.createdAt),
          itemCount: ktw.items?.length || 0,
          indexedPriceRows: indices.ktw.rowCount,
        },
        sellerPayments: {
          file: path.relative(projectRoot, inputFiles.sellerPayments).replace(/\\/g, "/"),
          exportedAt: stockSources.sellerPayments.exportedAt || "",
          exportedAtLabel: thaiDateTime(stockSources.sellerPayments.exportedAt),
          rowCount: stockSources.sellerPaymentIndex.rowCount,
          rule: "ใช้ยอดเงินจาก Shopee/Lazada Seller platform เท่านั้น ไม่ใช้ยอดเงินจาก Packhai",
        },
      },
    },
    summary,
    sourceBreakdown: sourceRows,
    warehouseBreakdown: warehouseRows,
    prefixBreakdown: prefixRows,
    topProducts,
    exceptions: {
      missingPricePositive: missingPriceRows.slice(0, 100),
      negativeStock: negativeStockRows.slice(0, 100),
      waiting: waitingRows.sort((a, b) => b.waitingValue - a.waitingValue).slice(0, 100),
      compactMatched: compactMatchedRows.slice(0, 100),
    },
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(file, rows) {
  const headers = [
    "SKU",
    "Stock Source",
    "Warehouse",
    "Product Name",
    "Quantity",
    "Waiting",
    "Available",
    "Latest Stock Movement",
    "Latest Movement Type",
    "Latest Movement Reference",
    "Latest Movement Detail",
    "Price",
    "Price Source",
    "Inventory Value",
    "Image URL",
    "Image Source",
    "Price Match Type",
    "Source Title",
    "Note",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.sku,
        row.stockSource,
        row.warehouseName,
        row.name,
        row.quantity,
        row.waiting,
        row.available,
        row.latestStockMovementAt,
        row.latestStockMovementType,
        row.latestStockMovementReferenceNo,
        row.latestStockMovementDescription,
        row.price,
        row.priceSource,
        row.inventoryValue,
        row.imageUrl,
        row.imageSource,
        row.priceMatchType,
        row.sourceTitle,
        row.note,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ];
  fs.writeFileSync(file, `\uFEFF${lines.join("\n")}`, "utf8");
}

function build() {
  fs.mkdirSync(distDir, { recursive: true });

  const packhai = readJson(inputFiles.packhai);
  const flowaccount = readOptionalJson(inputFiles.flowaccount, emptyFlowaccountStock());
  const shopee = readJson(inputFiles.shopee);
  const lazada = readJson(inputFiles.lazada);
  const ktw = readJson(inputFiles.ktw);
  const sellerPayments = readOptionalJson(inputFiles.sellerPayments, emptySellerPayments());

  const indices = {
    shopee: buildShopeeIndex(shopee),
    lazada: buildLazadaIndex(lazada),
    ktw: buildKtwIndex(ktw),
  };
  const sellerPaymentIndex = buildSellerPaymentIndex(sellerPayments);

  const stockRows = buildStockRows(packhai, flowaccount, sellerPaymentIndex);
  const duplicateStockRows = stockRows.length - new Set(stockRows.map((row) => `${row.warehouseId || row.stockSource}|${normalizeSku(row.sku)}`)).size;
  const stockSources = {
    packhai,
    flowaccount,
    sellerPayments,
    sellerPaymentIndex,
    duplicateSkuRows: Math.max(0, duplicateStockRows),
  };

  const rows = stockRows.map((item, index) => {
    const sku = normalizeSku(item.sku);
    const quantity = numberValue(item.quantity);
    const waiting = numberValue(item.waiting);
    const waitImport = numberValue(item.waitImport);
    const available = numberValue(item.available);
    const { selected, traces } = selectPrice(sku, indices);
    const imageCandidate = selectImage(sku, indices, selected);
    const price = selected?.price || 0;
    const inventoryValue = roundMoney(Math.max(0, quantity) * price);
    const availableValue = roundMoney(Math.max(0, available) * price);
    const waitingValue = roundMoney(Math.max(0, waiting) * price);
    const source = selected?.sourceName || "Missing";
    return {
      rowNo: index + 1,
      sku,
      skuPrefix: skuPrefix(sku),
      stockSource: item.stockSource || "Packhai",
      warehouseId: item.warehouseId || "",
      warehouseName: item.warehouseName || "",
      stockSourceLabel: item.stockSourceLabel || stockSourceLabel(item),
      stockShopId: item.stockShopId || "",
      name: String(item.name || sku).trim(),
      barcode: String(item.barcode || "").trim(),
      prop: String(item.prop || "").trim(),
      quantity,
      waiting,
      waitImport,
      available,
      latestStockMovementAt: item.latestStockMovementAt || "",
      latestStockMovementAtLabel: thaiDateTime(item.latestStockMovementAt),
      latestStockMovementType: item.latestStockMovementType || "",
      latestStockMovementDescription: item.latestStockMovementDescription || "",
      latestStockMovementReferenceNo: item.latestStockMovementReferenceNo || "",
      latestStockMovementReferenceNo2: item.latestStockMovementReferenceNo2 || "",
      latestStockMovementChannelName: item.latestStockMovementChannelName || "",
      latestStockMovementAddQuantity: numberValue(item.latestStockMovementAddQuantity),
      latestStockMovementRemoveQuantity: numberValue(item.latestStockMovementRemoveQuantity),
      latestStockMovementTotalQuantity: numberValue(item.latestStockMovementTotalQuantity),
      stockMovementCount: (item.stockMovements || []).length,
      stockForValue: Math.max(0, quantity),
      price,
      priceSource: source,
      priceSourceLabel: selected?.sourceLabel || "ไม่พบราคา",
      priceSourcePriority: source === "Shopee" ? 1 : source === "Lazada" ? 2 : source === "KTW" ? 3 : 9,
      priceMatchType: selected?.matchType || "",
      priceCandidateCount: selected?.candidateCount || 0,
      sourceSku: selected?.sourceSku || "",
      sourceTitle: selected?.title || "",
      sourceProductId: selected?.productId || "",
      sourceUrl: selected?.sourceUrl || "",
      sourceCapturedAt: selected?.sourceCapturedAt || "",
      imageUrl: imageCandidate?.imageUrl || "",
      imageSource: imageCandidate?.imageSource || imageCandidate?.sourceName || "",
      inventoryValue,
      availableValue,
      waitingValue,
      note: rowNote(item, selected, traces),
    };
  });

  rows.sort((a, b) => b.inventoryValue - a.inventoryValue || a.sku.localeCompare(b.sku, "en"));
  const stockMovements = stockRows.flatMap((item) => item.stockMovements || []);
  const platformPaymentSummary = buildPlatformPaymentSummary(stockMovements);

  const dashboard = {
    ...summarizeRows(rows, stockSources, shopee, lazada, ktw, indices),
    rows,
  };
  dashboard.summary.platformPayment = platformPaymentSummary;
  dashboard.platformPaymentSummary = platformPaymentSummary;

  const template = fs.readFileSync(path.join(srcDir, "index.template.html"), "utf8");
  const styles = fs.readFileSync(path.join(srcDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(srcDir, "app.js"), "utf8");
  const configScript = `window.__PACKHAI_SYNC_API_BASE__ = ${JSON.stringify(readPublicSyncApiBase())};`;
  const dataScript = `window.__PACKHAI_DASHBOARD__ = ${JSON.stringify(dashboard)};`;
  const html = template
    .replace("/* __INLINE_STYLES__ */", styles)
    .replace("/* __INLINE_DATA__ */", `${configScript}\n${dataScript}`)
    .replace("/* __INLINE_APP__ */", app);

  fs.writeFileSync(path.join(distDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(distDir, "inventory-valuation-data.json"), JSON.stringify(dashboard, null, 2), "utf8");
  fs.writeFileSync(
    path.join(distDir, "stock-movements.json"),
    JSON.stringify({
      exportedAt: stockSources.packhai.exportedAt || "",
      source: stockSources.packhai.stockMovement?.source || "https://shop.packhai.com/stock-history",
      rowCount: stockMovements.length,
      rows: stockMovements,
    }),
    "utf8"
  );
  writeCsv(path.join(distDir, "packhai-inventory-valuation.csv"), rows);

  console.log(
    JSON.stringify(
      {
        ok: true,
        html: path.join(distDir, "index.html"),
        rows: rows.length,
        totalInventoryValue: dashboard.summary.totalInventoryValue,
        sources: dashboard.sourceBreakdown,
      },
      null,
      2
    )
  );
}

build();
