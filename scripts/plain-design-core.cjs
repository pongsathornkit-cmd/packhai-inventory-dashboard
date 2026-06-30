const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_VERSION = 1;
const ASSET_GROUPS = new Set(["product_images", "packaging_images", "factory_files"]);
const COMMERCIAL_NUMBER_FIELDS = [
  "orderQuantity",
  "purchaseUnitCostUsd",
  "purchaseUnitCost",
  "saleUnitPrice",
  "widthCm",
  "lengthCm",
  "heightCm",
  "unitWeightKg",
  "packagingUnitCost",
  "otherUnitCost",
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFile, file);
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/^'+/, "").replace(/\.0$/, "").toUpperCase();
}

function numberValue(value) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[,\s]|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function safeSegment(value, fallback = "file") {
  return String(value || fallback)
    .normalize("NFKD")
    .replace(/[^\w.\-\u0E00-\u0E7F]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160) || fallback;
}

function packhaiUrlForSku(sku) {
  return `../#inventory-detail?sku=${encodeURIComponent(normalizeSku(sku))}`;
}

function buildPackhaiIndex(dashboard) {
  const bySku = new Map();
  for (const row of dashboard?.rows || []) {
    const sku = normalizeSku(row.sku);
    if (!sku) continue;
    if (!bySku.has(sku)) {
      bySku.set(sku, {
        sku,
        matched: true,
        stockRows: 0,
        quantity: 0,
        available: 0,
        waiting: 0,
        inventoryValue: 0,
        warehouses: [],
        productName: row.name || "",
        imageUrl: row.imageUrl || "",
        priceSource: row.priceSource || "",
      });
    }
    const item = bySku.get(sku);
    item.stockRows += 1;
    item.quantity += numberValue(row.quantity);
    item.available += numberValue(row.available);
    item.waiting += numberValue(row.waiting);
    item.inventoryValue += numberValue(row.inventoryValue);
    if (!item.imageUrl && row.imageUrl) item.imageUrl = row.imageUrl;
    if (!item.productName && row.name) item.productName = row.name;
    item.warehouses.push({
      stockSource: row.stockSource || "",
      warehouseId: row.warehouseId || "",
      warehouseName: row.warehouseName || row.stockSourceLabel || row.stockSource || "",
      quantity: numberValue(row.quantity),
      available: numberValue(row.available),
      inventoryValue: numberValue(row.inventoryValue),
    });
  }

  for (const item of bySku.values()) {
    item.quantity = moneyValue(item.quantity);
    item.available = moneyValue(item.available);
    item.waiting = moneyValue(item.waiting);
    item.inventoryValue = moneyValue(item.inventoryValue);
    item.url = packhaiUrlForSku(item.sku);
  }
  return bySku;
}

function buildPlainDesignInitialState({ seed, dashboard }) {
  const packhaiBySku = buildPackhaiIndex(dashboard);
  const products = (seed?.products || []).map((product, index) => {
    const sku = normalizeSku(product.sku);
    const packhai = packhaiBySku.get(sku) || {
      sku,
      matched: false,
      stockRows: 0,
      quantity: 0,
      available: 0,
      waiting: 0,
      inventoryValue: 0,
      warehouses: [],
      productName: "",
      imageUrl: "",
      priceSource: "",
      url: packhaiUrlForSku(sku),
    };
    return {
      id: sku,
      sku,
      name: product.name || packhai.productName || sku,
      category: product.category || "wood",
      ktwPrice: numberValue(product.ktwPrice),
      orderQuantity: numberValue(product.orderQuantity),
      purchaseUnitCostUsd: numberValue(product.purchaseUnitCostUsd),
      purchaseUnitCost: numberValue(product.purchaseUnitCost || product.ktwPrice),
      saleUnitPrice: numberValue(product.saleUnitPrice || product.ktwPrice),
      widthCm: numberValue(product.widthCm),
      lengthCm: numberValue(product.lengthCm),
      heightCm: numberValue(product.heightCm),
      unitWeightKg: numberValue(product.unitWeightKg),
      packagingUnitCost: numberValue(product.packagingUnitCost),
      otherUnitCost: numberValue(product.otherUnitCost),
      cargoMode: product.cargoMode || "truck",
      cargoType: product.cargoType || "A",
      sourceImageUrl: product.sourceImageUrl || packhai.imageUrl || "",
      sourceUrl: product.sourceUrl || "",
      status: product.status || "not_started",
      notes: product.notes || "",
      sortOrder: index + 1,
      updatedAt: new Date().toISOString(),
      packhai,
      assets: [],
    };
  });

  return {
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    statusOptions: seed?.statusOptions || [],
    categoryOptions: seed?.categoryOptions || [],
    assetGroups: seed?.assetGroups || [],
    products,
  };
}

function mergeStoredState(initialState, storedState) {
  const storedBySku = new Map((storedState?.products || []).map((product) => [normalizeSku(product.sku), product]));
  return {
    ...initialState,
    updatedAt: storedState?.updatedAt || initialState.updatedAt,
    products: initialState.products.map((product) => {
      const stored = storedBySku.get(product.sku);
      if (!stored) return product;
      return {
        ...product,
        status: stored.status || product.status,
        notes: Object.prototype.hasOwnProperty.call(stored, "notes") ? String(stored.notes || "") : product.notes,
        orderQuantity: Object.prototype.hasOwnProperty.call(stored, "orderQuantity")
          ? numberValue(stored.orderQuantity)
          : product.orderQuantity,
        purchaseUnitCost: Object.prototype.hasOwnProperty.call(stored, "purchaseUnitCost")
          ? numberValue(stored.purchaseUnitCost)
          : product.purchaseUnitCost,
        purchaseUnitCostUsd: Object.prototype.hasOwnProperty.call(stored, "purchaseUnitCostUsd")
          ? numberValue(stored.purchaseUnitCostUsd)
          : product.purchaseUnitCostUsd,
        saleUnitPrice: Object.prototype.hasOwnProperty.call(stored, "saleUnitPrice")
          ? numberValue(stored.saleUnitPrice)
          : product.saleUnitPrice,
        widthCm: Object.prototype.hasOwnProperty.call(stored, "widthCm") ? numberValue(stored.widthCm) : product.widthCm,
        lengthCm: Object.prototype.hasOwnProperty.call(stored, "lengthCm") ? numberValue(stored.lengthCm) : product.lengthCm,
        heightCm: Object.prototype.hasOwnProperty.call(stored, "heightCm") ? numberValue(stored.heightCm) : product.heightCm,
        unitWeightKg: Object.prototype.hasOwnProperty.call(stored, "unitWeightKg")
          ? numberValue(stored.unitWeightKg)
          : product.unitWeightKg,
        packagingUnitCost: Object.prototype.hasOwnProperty.call(stored, "packagingUnitCost")
          ? numberValue(stored.packagingUnitCost)
          : product.packagingUnitCost,
        otherUnitCost: Object.prototype.hasOwnProperty.call(stored, "otherUnitCost")
          ? numberValue(stored.otherUnitCost)
          : product.otherUnitCost,
        cargoMode: stored.cargoMode || product.cargoMode,
        cargoType: stored.cargoType || product.cargoType,
        assets: Array.isArray(stored.assets) ? stored.assets : [],
        updatedAt: stored.updatedAt || product.updatedAt,
      };
    }),
  };
}

function loadPlainDesignState(options) {
  const seed = readJson(options.seedFile, { products: [] });
  const dashboard = readJson(options.dashboardFile, {});
  const initialState = buildPlainDesignInitialState({ seed, dashboard });
  const storedState = readJson(options.stateFile, null);
  return mergeStoredState(initialState, storedState);
}

function savePlainDesignState(options, state) {
  const nextState = {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(options.stateFile, nextState);
  return nextState;
}

function updatePlainDesignProduct(options, payload) {
  const sku = normalizeSku(payload.sku);
  if (!sku) throw new Error("SKU is required.");
  const state = loadPlainDesignState(options);
  let found = null;
  state.products = state.products.map((product) => {
    if (product.sku !== sku) return product;
    found = {
      ...product,
      status: payload.status || product.status,
      notes: Object.prototype.hasOwnProperty.call(payload, "notes") ? String(payload.notes || "") : product.notes,
      updatedAt: new Date().toISOString(),
    };
    for (const field of COMMERCIAL_NUMBER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        found[field] = numberValue(payload[field]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "cargoMode")) {
      found.cargoMode = ["truck", "sea"].includes(String(payload.cargoMode)) ? String(payload.cargoMode) : product.cargoMode;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "cargoType")) {
      found.cargoType = ["A", "M", "O", "X", "Z"].includes(String(payload.cargoType).toUpperCase())
        ? String(payload.cargoType).toUpperCase()
        : product.cargoType;
    }
    return found;
  });
  if (!found) throw new Error(`Product ${sku} was not found.`);
  savePlainDesignState(options, state);
  return found;
}

function publicAssetUrl(assetPath) {
  return `/api/plain-design/assets/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("File payload must be a data URL.");
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  return {
    mimeType,
    buffer: isBase64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8"),
  };
}

function savePlainDesignAssetFiles(options, payload) {
  const sku = normalizeSku(payload.sku);
  const group = String(payload.group || "");
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!sku) throw new Error("SKU is required.");
  if (!ASSET_GROUPS.has(group)) throw new Error("Asset group is invalid.");
  if (!files.length) return [];

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === sku);
  if (!product) throw new Error(`Product ${sku} was not found.`);

  const created = files.map((file) => {
    const decoded = decodeDataUrl(file.dataUrl);
    const id = crypto.randomUUID();
    const fileName = safeSegment(file.name || `file-${Date.now()}`);
    const relativePath = `${sku}/${group}/${Date.now()}-${id.slice(0, 8)}-${fileName}`;
    const fullPath = path.resolve(options.assetDir, relativePath);
    if (!fullPath.startsWith(path.resolve(options.assetDir))) throw new Error("Invalid asset path.");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, decoded.buffer);
    return {
      id,
      sku,
      group,
      fileName: file.name || fileName,
      filePath: relativePath.replace(/\\/g, "/"),
      fileSize: decoded.buffer.length,
      mimeType: file.type || decoded.mimeType,
      publicUrl: publicAssetUrl(relativePath.replace(/\\/g, "/")),
      uploadedAt: new Date().toISOString(),
    };
  });

  product.assets = [...created, ...(product.assets || [])];
  product.updatedAt = new Date().toISOString();
  savePlainDesignState(options, state);
  return created;
}

function deletePlainDesignAsset(options, payload) {
  const sku = normalizeSku(payload.sku);
  const assetId = String(payload.assetId || "");
  if (!sku || !assetId) throw new Error("SKU and assetId are required.");

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === sku);
  if (!product) throw new Error(`Product ${sku} was not found.`);
  const asset = (product.assets || []).find((item) => item.id === assetId);
  product.assets = (product.assets || []).filter((item) => item.id !== assetId);
  product.updatedAt = new Date().toISOString();
  savePlainDesignState(options, state);

  if (asset?.filePath) {
    const fullPath = path.resolve(options.assetDir, asset.filePath);
    if (fullPath.startsWith(path.resolve(options.assetDir))) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Missing files should not block state cleanup.
      }
    }
  }
  return { ok: true };
}

function resolvePlainDesignAssetPath(options, urlPath) {
  const prefix = "/api/plain-design/assets/";
  if (!urlPath.startsWith(prefix)) return null;
  const relativePath = decodeURIComponent(urlPath.slice(prefix.length));
  const fullPath = path.resolve(options.assetDir, relativePath);
  if (!fullPath.startsWith(path.resolve(options.assetDir))) return null;
  return fullPath;
}

module.exports = {
  buildPlainDesignInitialState,
  deletePlainDesignAsset,
  loadPlainDesignState,
  resolvePlainDesignAssetPath,
  savePlainDesignAssetFiles,
  updatePlainDesignProduct,
};
