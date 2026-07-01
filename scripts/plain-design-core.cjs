const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_VERSION = 1;
const ASSET_GROUPS = new Set(["product_images", "packaging_images", "factory_files"]);
const PLAIN_IMAGE_VERSION_COUNT = 3;
const MAX_AI_REFERENCE_IMAGES = 3;
const MAX_AI_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const AI_REFERENCE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const CODEX_AI_JOB_STATUSES = new Set(["pending", "working", "completed", "failed", "cancelled"]);
const COMMERCIAL_NUMBER_FIELDS = [
  "orderQuantity",
  "purchaseUnitCostUsd",
  "purchaseUnitCost",
  "widthCm",
  "lengthCm",
  "heightCm",
  "unitWeightKg",
  "packagingUnitCost",
  "otherUnitCost",
];
const COMMERCIAL_BOOLEAN_FIELDS = [
  "purchaseUnitCostCleared",
];
const REDESIGN_STATUS_OPTIONS = [
  { id: "passed", label: "ผ่าน", tone: "green" },
  { id: "ai_done_waiting_review", label: "AIทำรูปเสร็จแล้วรอตรวจสอบ", tone: "orange" },
  { id: "needs_ai_revision", label: "ต้องการให้AIแก้รูป", tone: "blue" },
  { id: "waiting_ai_images", label: "รอรูปภาพจากAI", tone: "neutral" },
];
const REDESIGN_STATUS_IDS = new Set(REDESIGN_STATUS_OPTIONS.map((item) => item.id));
const LEGACY_REDESIGN_STATUS_MAP = {
  not_started: "waiting_ai_images",
  designing: "waiting_ai_images",
  review: "ai_done_waiting_review",
  approved: "passed",
  factory_ready: "passed",
};

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

function normalizeRedesignStatus(value, fallback = "waiting_ai_images") {
  const rawStatus = String(value || "").trim();
  const mappedStatus = LEGACY_REDESIGN_STATUS_MAP[rawStatus] || rawStatus;
  if (REDESIGN_STATUS_IDS.has(mappedStatus)) return mappedStatus;
  return fallback;
}

function redesignStatusFromPayload(value) {
  const rawStatus = String(value || "").trim();
  const mappedStatus = LEGACY_REDESIGN_STATUS_MAP[rawStatus] || rawStatus;
  if (REDESIGN_STATUS_IDS.has(mappedStatus)) return mappedStatus;
  throw new Error(`Invalid redesign status: ${rawStatus || "(blank)"}`);
}

function normalizeStatusOptions(options) {
  const ids = new Set((options || []).map((item) => item?.id));
  return REDESIGN_STATUS_OPTIONS.every((item) => ids.has(item.id)) ? options : REDESIGN_STATUS_OPTIONS;
}

function normalizePlainImageAngleIndex(value) {
  const angleIndex = Math.trunc(numberValue(value));
  return angleIndex > 0 ? angleIndex : 0;
}

function normalizePlainImageVersion(value) {
  const version = Math.round(numberValue(value) * 10) / 10;
  const baseVersion = Math.trunc(version);
  if (
    Number.isFinite(version) &&
    baseVersion >= 1 &&
    baseVersion <= PLAIN_IMAGE_VERSION_COUNT &&
    version >= baseVersion &&
    version < baseVersion + 1
  ) {
    return version;
  }
  return 1;
}

function normalizePlainImageVersionSelections(value) {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([angleIndex, version]) => [normalizePlainImageAngleIndex(angleIndex), normalizePlainImageVersion(version)])
      .filter(([angleIndex]) => angleIndex > 0)
  );
}

function normalizeCodexAiJobStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return CODEX_AI_JOB_STATUSES.has(status) ? status : "pending";
}

function normalizeStoredAiReferenceImages(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_AI_REFERENCE_IMAGES)
    .map((image, index) => {
      const dataUrl = String(image?.dataUrl || "").trim();
      const filePath = String(image?.filePath || "").replace(/\\/g, "/");
      const publicUrl = String(image?.publicUrl || (filePath ? publicAssetUrl(filePath) : "")).trim();
      if (!dataUrl.startsWith("data:") && !filePath && !publicUrl && !image?.name) return null;
      return {
        name: safeSegment(image?.name || `reference-${index + 1}.png`, `reference-${index + 1}.png`),
        type: String(image?.type || "").split(";")[0].toLowerCase() || mimeTypeForFilePath(image?.name || ".png"),
        size: numberValue(image?.size),
        filePath,
        publicUrl,
        uploadedAt: image?.uploadedAt || "",
        dataUrlBytes: dataUrl ? Buffer.byteLength(dataUrl, "utf8") : numberValue(image?.dataUrlBytes),
      };
    })
    .filter(Boolean);
}

function normalizeCodexAiJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .map((job) => {
      const sku = normalizeSku(job?.sku);
      const angleIndex = normalizePlainImageAngleIndex(job?.angleIndex);
      const prompt = String(job?.prompt || "").trim();
      if (!sku || !angleIndex || !prompt) return null;
      return {
        id: String(job?.id || crypto.randomUUID()),
        type: "plain_image_redesign",
        status: normalizeCodexAiJobStatus(job?.status),
        sku,
        productName: String(job?.productName || ""),
        angleIndex,
        sourceVersion: normalizePlainImageVersion(job?.sourceVersion || job?.version),
        newVersion: normalizePlainImageVersion(job?.newVersion),
        prompt,
        referenceImages: normalizeStoredAiReferenceImages(job?.referenceImages),
        source: job?.source && typeof job.source === "object" && !Array.isArray(job.source) ? {
          type: String(job.source.type || ""),
          imageUrl: String(job.source.imageUrl || ""),
          publicUrl: String(job.source.publicUrl || ""),
          sourceUrl: String(job.source.sourceUrl || ""),
          assetId: String(job.source.assetId || ""),
          fileName: String(job.source.fileName || ""),
          alt: String(job.source.alt || ""),
        } : {},
        createdAt: job?.createdAt || new Date().toISOString(),
        updatedAt: job?.updatedAt || job?.createdAt || new Date().toISOString(),
        startedAt: job?.startedAt || "",
        completedAt: job?.completedAt || "",
        error: String(job?.error || ""),
        assetId: String(job?.assetId || ""),
        assetPublicUrl: String(job?.assetPublicUrl || ""),
        fileName: String(job?.fileName || ""),
        revisedPrompt: String(job?.revisedPrompt || ""),
      };
    })
    .filter(Boolean);
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

function buildKtwLogisticsIndex(ktwLogistics) {
  const bySku = new Map();
  for (const item of ktwLogistics?.items || []) {
    const sku = normalizeSku(item.sku);
    if (!sku) continue;
    bySku.set(sku, {
      sku,
      sourceUrl: item.sourceUrl || "",
      capturedAt: item.capturedAt || ktwLogistics.createdAt || "",
      sourceLabel: item.sourceLabel || ktwLogistics.sourceLabel || "shop.ktw.co.th",
      widthCm: numberValue(item.widthCm),
      lengthCm: numberValue(item.lengthCm),
      heightCm: numberValue(item.heightCm),
      unitWeightKg: numberValue(item.unitWeightKg),
      sourcePrice: numberValue(item.sourcePrice),
      priceSourceLabel: item.priceSourceLabel || item.sourceLabel || ktwLogistics.sourceLabel || "shop.ktw.co.th",
      priceCapturedAt: item.priceCapturedAt || item.capturedAt || ktwLogistics.createdAt || "",
      priceValid: numberValue(item.sourcePrice) > 0,
      ktwImages: (Array.isArray(item.ktwImages) ? item.ktwImages : []).map((image, index) => ({
        angleNo: numberValue(image.angleNo) || index + 1,
        url: image.url || "",
        alt: image.alt || "",
        sourceUrl: image.sourceUrl || item.sourceUrl || "",
      })).filter((image) => image.url),
      rawUnit: item.rawUnit || item.raw?.dimensionUnit || "",
      raw: item.raw || {},
    });
  }
  return bySku;
}

function logisticsValue(product, logistics, field) {
  return numberValue(product[field]) || numberValue(logistics?.[field]);
}

function storedOrKtwLogisticsValue(stored, product, field) {
  const storedValue = numberValue(stored?.[field]);
  return storedValue > 0 ? storedValue : numberValue(product[field]);
}

function storedPurchaseUnitCost(stored, product) {
  if (stored?.purchaseUnitCostCleared) return 0;
  if (!Object.prototype.hasOwnProperty.call(stored || {}, "purchaseUnitCost")) return product.purchaseUnitCost;
  const storedCost = numberValue(stored.purchaseUnitCost);
  const oldKtwPrice = numberValue(stored.ktwPrice || stored.saleUnitPrice);
  const wasDefaultKtwCost =
    storedCost > 0 &&
    oldKtwPrice > 0 &&
    storedCost === oldKtwPrice &&
    !numberValue(stored.purchaseUnitCostUsd);
  return wasDefaultKtwCost ? product.purchaseUnitCost : storedCost;
}

function ktwWebsitePrice(logistics) {
  if (!logistics) return 0;
  const sourceLabel = String(logistics.sourceLabel || "").toLowerCase();
  const sourceUrl = String(logistics.sourceUrl || "");
  const isShopKtw = sourceLabel === "shop.ktw.co.th" || /^https:\/\/shop\.ktw\.co\.th\//i.test(sourceUrl);
  return isShopKtw ? moneyValue(logistics.sourcePrice) : 0;
}

function normalizePurchaseOrder(order) {
  const id = String(order?.id || crypto.randomUUID());
  const lines = {};
  for (const [sku, qty] of Object.entries(order?.lines || {})) {
    const normalizedSku = normalizeSku(sku);
    if (!normalizedSku) continue;
    lines[normalizedSku] = numberValue(qty);
  }
  return {
    id,
    number: String(order?.number || "").trim() || `PLAIN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    poDate: String(order?.poDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    supplierName: String(order?.supplierName || "PLAIN Redesign Supplier"),
    fastCargoDiscount: numberValue(order?.fastCargoDiscount ?? 30),
    status: String(order?.status || "draft"),
    createdAt: order?.createdAt || new Date().toISOString(),
    updatedAt: order?.updatedAt || new Date().toISOString(),
    lines,
  };
}

function normalizePurchaseOrders(orders) {
  return (Array.isArray(orders) ? orders : []).map(normalizePurchaseOrder);
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

function buildPlainDesignInitialState({ seed, dashboard, ktwLogistics }) {
  const packhaiBySku = buildPackhaiIndex(dashboard);
  const ktwLogisticsBySku = buildKtwLogisticsIndex(ktwLogistics);
  const products = (seed?.products || []).map((product, index) => {
    const sku = normalizeSku(product.sku);
    const logistics = ktwLogisticsBySku.get(sku) || null;
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
    const ktwPrice = ktwWebsitePrice(logistics);
    return {
      id: sku,
      sku,
      name: product.name || packhai.productName || sku,
      category: product.category || "wood",
      ktwPrice,
      ktwPriceSourceLabel: ktwPrice > 0 ? "shop.ktw.co.th" : "",
      ktwPriceSourceUrl: ktwPrice > 0 ? logistics?.sourceUrl || "" : "",
      ktwPriceCapturedAt: ktwPrice > 0 ? logistics?.priceCapturedAt || logistics?.capturedAt || "" : "",
      orderQuantity: numberValue(product.orderQuantity),
      purchaseUnitCostUsd: numberValue(product.purchaseUnitCostUsd),
      purchaseUnitCost: numberValue(product.purchaseUnitCost || ktwPrice),
      purchaseUnitCostCleared: Boolean(product.purchaseUnitCostCleared),
      saleUnitPrice: ktwPrice,
      widthCm: logisticsValue(product, logistics, "widthCm"),
      lengthCm: logisticsValue(product, logistics, "lengthCm"),
      heightCm: logisticsValue(product, logistics, "heightCm"),
      unitWeightKg: logisticsValue(product, logistics, "unitWeightKg"),
      packagingUnitCost: numberValue(product.packagingUnitCost),
      otherUnitCost: numberValue(product.otherUnitCost),
      cargoMode: product.cargoMode || "truck",
      cargoType: product.cargoType || "A",
      sourceImageUrl: product.sourceImageUrl || logistics?.ktwImages?.[0]?.url || packhai.imageUrl || "",
      sourceUrl: product.sourceUrl || "",
      status: normalizeRedesignStatus(product.status),
      plainImageVersionSelections: normalizePlainImageVersionSelections(product.plainImageVersionSelections),
      notes: product.notes || "",
      sortOrder: index + 1,
      updatedAt: new Date().toISOString(),
      packhai,
      ktwLogistics: logistics,
      ktwImages: logistics?.ktwImages || [],
      assets: [],
    };
  });

  return {
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    statusOptions: normalizeStatusOptions(seed?.statusOptions),
    categoryOptions: seed?.categoryOptions || [],
    assetGroups: seed?.assetGroups || [],
    products,
    purchaseOrders: [],
    codexAiJobs: [],
  };
}

function mergeStoredState(initialState, storedState) {
  const storedBySku = new Map((storedState?.products || []).map((product) => [normalizeSku(product.sku), product]));
  return {
    ...initialState,
    updatedAt: storedState?.updatedAt || initialState.updatedAt,
    purchaseOrders: normalizePurchaseOrders(storedState?.purchaseOrders),
    codexAiJobs: normalizeCodexAiJobs(storedState?.codexAiJobs),
    products: initialState.products.map((product) => {
      const stored = storedBySku.get(product.sku);
      if (!stored) return product;
      return {
        ...product,
        status: normalizeRedesignStatus(stored.status || product.status, product.status),
        notes: Object.prototype.hasOwnProperty.call(stored, "notes") ? String(stored.notes || "") : product.notes,
        orderQuantity: Object.prototype.hasOwnProperty.call(stored, "orderQuantity")
          ? numberValue(stored.orderQuantity)
          : product.orderQuantity,
        purchaseUnitCost: storedPurchaseUnitCost(stored, product),
        purchaseUnitCostUsd: stored.purchaseUnitCostCleared
          ? 0
          : Object.prototype.hasOwnProperty.call(stored, "purchaseUnitCostUsd")
          ? numberValue(stored.purchaseUnitCostUsd)
          : product.purchaseUnitCostUsd,
        purchaseUnitCostCleared: Boolean(stored.purchaseUnitCostCleared),
        saleUnitPrice: product.ktwPrice,
        widthCm: storedOrKtwLogisticsValue(stored, product, "widthCm"),
        lengthCm: storedOrKtwLogisticsValue(stored, product, "lengthCm"),
        heightCm: storedOrKtwLogisticsValue(stored, product, "heightCm"),
        unitWeightKg: storedOrKtwLogisticsValue(stored, product, "unitWeightKg"),
        packagingUnitCost: Object.prototype.hasOwnProperty.call(stored, "packagingUnitCost")
          ? numberValue(stored.packagingUnitCost)
          : product.packagingUnitCost,
        otherUnitCost: Object.prototype.hasOwnProperty.call(stored, "otherUnitCost")
          ? numberValue(stored.otherUnitCost)
          : product.otherUnitCost,
        cargoMode: stored.cargoMode || product.cargoMode,
        cargoType: stored.cargoType || product.cargoType,
        plainImageVersionSelections: normalizePlainImageVersionSelections(
          Object.prototype.hasOwnProperty.call(stored, "plainImageVersionSelections")
            ? stored.plainImageVersionSelections
            : product.plainImageVersionSelections
        ),
        assets: Array.isArray(stored.assets) ? stored.assets : [],
        updatedAt: stored.updatedAt || product.updatedAt,
      };
    }),
  };
}

function loadPlainDesignState(options) {
  const seed = readJson(options.seedFile, { products: [] });
  const dashboard = readJson(options.dashboardFile, {});
  const ktwLogistics = readJson(options.ktwLogisticsFile, {});
  const initialState = buildPlainDesignInitialState({ seed, dashboard, ktwLogistics });
  const storedState = readJson(options.stateFile, null);
  return mergeStoredState(initialState, storedState);
}

function savePlainDesignState(options, state) {
  const nextState = {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    statusOptions: normalizeStatusOptions(state.statusOptions),
    codexAiJobs: normalizeCodexAiJobs(state.codexAiJobs),
    products: (state.products || []).map((product) => ({
      ...product,
      status: normalizeRedesignStatus(product.status),
      plainImageVersionSelections: normalizePlainImageVersionSelections(product.plainImageVersionSelections),
    })),
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
      status: Object.prototype.hasOwnProperty.call(payload, "status")
        ? redesignStatusFromPayload(payload.status)
        : normalizeRedesignStatus(product.status),
      notes: Object.prototype.hasOwnProperty.call(payload, "notes") ? String(payload.notes || "") : product.notes,
      updatedAt: new Date().toISOString(),
    };
    for (const field of COMMERCIAL_NUMBER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        found[field] = numberValue(payload[field]);
      }
    }
    for (const field of COMMERCIAL_BOOLEAN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        found[field] = Boolean(payload[field]);
      }
    }
    found.plainImageVersionSelections = normalizePlainImageVersionSelections(product.plainImageVersionSelections);
    if (Object.prototype.hasOwnProperty.call(payload, "plainImageVersionSelections")) {
      found.plainImageVersionSelections = {
        ...found.plainImageVersionSelections,
        ...normalizePlainImageVersionSelections(payload.plainImageVersionSelections),
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, "cargoMode")) {
      found.cargoMode = ["truck", "sea"].includes(String(payload.cargoMode)) ? String(payload.cargoMode) : product.cargoMode;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "cargoType")) {
      found.cargoType = ["A", "M", "O", "X", "Z"].includes(String(payload.cargoType).toUpperCase())
        ? String(payload.cargoType).toUpperCase()
        : product.cargoType;
    }
    found.saleUnitPrice = found.ktwPrice;
    return found;
  });
  if (!found) throw new Error(`Product ${sku} was not found.`);
  savePlainDesignState(options, state);
  return found;
}

function savePlainDesignPurchaseOrders(options, payload) {
  if (!Array.isArray(payload?.purchaseOrders)) {
    throw new Error("purchaseOrders is required.");
  }
  const state = loadPlainDesignState(options);
  state.purchaseOrders = normalizePurchaseOrders(payload.purchaseOrders);
  savePlainDesignState(options, state);
  return { purchaseOrders: state.purchaseOrders };
}

function publicAssetUrl(assetPath) {
  return `/api/plain-design/assets/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

function mimeTypeForFilePath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
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

function persistAiReferenceImages(options, sku, images) {
  return (Array.isArray(images) ? images : []).slice(0, MAX_AI_REFERENCE_IMAGES).map((image, index) => {
    const decoded = decodeDataUrl(image.dataUrl);
    const id = crypto.randomUUID();
    const fileName = safeSegment(image.name || `reference-${index + 1}.png`, `reference-${index + 1}.png`);
    const relativePath = `${sku}/codex_reference_images/${Date.now()}-${id.slice(0, 8)}-${fileName}`;
    const assetRoot = path.resolve(options.assetDir);
    const fullPath = path.resolve(assetRoot, relativePath);
    const relativeToRoot = path.relative(assetRoot, fullPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) throw new Error("Invalid reference image path.");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, decoded.buffer);
    return {
      name: fileName,
      type: String(image.type || decoded.mimeType || "image/png").split(";")[0].toLowerCase(),
      size: decoded.buffer.length,
      filePath: relativePath.replace(/\\/g, "/"),
      publicUrl: publicAssetUrl(relativePath.replace(/\\/g, "/")),
      uploadedAt: new Date().toISOString(),
      dataUrlBytes: Buffer.byteLength(String(image.dataUrl || ""), "utf8"),
    };
  });
}

function sanitizeAiReferenceImages(value) {
  const images = Array.isArray(value) ? value : [];
  if (images.length > MAX_AI_REFERENCE_IMAGES) {
    throw new Error(`AI reference images are limited to ${MAX_AI_REFERENCE_IMAGES} files.`);
  }
  return images.map((image, index) => {
    const dataUrl = String(image?.dataUrl || image?.imageUrl || image?.image_url || "").trim();
    const decoded = decodeDataUrl(dataUrl);
    const mimeType = String(decoded.mimeType || image?.type || "").split(";")[0].toLowerCase();
    if (!AI_REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`AI reference image ${index + 1} must be PNG, JPG, WEBP, or GIF.`);
    }
    if (decoded.buffer.length > MAX_AI_REFERENCE_IMAGE_BYTES) {
      throw new Error(`AI reference image ${index + 1} is larger than 5 MB.`);
    }
    return {
      name: safeSegment(image?.name || `reference-${index + 1}.png`, `reference-${index + 1}.png`),
      type: mimeType,
      size: decoded.buffer.length,
      dataUrl,
    };
  });
}

function sanitizeAssetMetadata(metadata) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const next = {};
  for (const [key, value] of Object.entries(source).slice(0, 24)) {
    const safeKey = safeSegment(key, "metadata").slice(0, 80);
    if (!safeKey) continue;
    if (typeof value === "boolean") next[safeKey] = value;
    else if (typeof value === "number" && Number.isFinite(value)) next[safeKey] = value;
    else if (value != null) next[safeKey] = String(value).slice(0, 1200);
  }
  return next;
}

function plainImageAssetsForAngle(product, angleIndex) {
  const normalizedAngleIndex = normalizePlainImageAngleIndex(angleIndex);
  return (product?.assets || []).filter((asset) => (
    asset?.group === "product_images" &&
    normalizePlainImageAngleIndex(asset.angleIndex) === normalizedAngleIndex
  ));
}

function legacyPlainImageAssetFor(product, angleIndex) {
  return (product?.assets || [])
    .filter((asset) => asset?.group === "product_images" && !normalizePlainImageAngleIndex(asset.angleIndex))
    [normalizePlainImageAngleIndex(angleIndex) - 1] || null;
}

function plainImageAssetFor(product, angleIndex, version) {
  const normalizedVersion = normalizePlainImageVersion(version);
  const slotted = plainImageAssetsForAngle(product, angleIndex).find((asset) => (
    normalizePlainImageVersion(asset.version) === normalizedVersion
  ));
  if (slotted) return slotted;
  return normalizedVersion === 1 ? legacyPlainImageAssetFor(product, angleIndex) : null;
}

function nextPlainImageSubVersion(product, angleIndex, sourceVersion, reservedVersions = []) {
  const normalizedSourceVersion = normalizePlainImageVersion(sourceVersion);
  const baseVersion = Math.trunc(normalizedSourceVersion);
  const used = new Set(
    [
      ...plainImageAssetsForAngle(product, angleIndex).map((asset) => normalizePlainImageVersion(asset.version)),
      ...reservedVersions.map(normalizePlainImageVersion),
    ]
      .filter((version) => Math.trunc(version) === baseVersion)
      .map((version) => Math.round((version - baseVersion) * 10))
      .filter((suffix) => suffix > 0)
  );
  for (let suffix = 1; suffix <= 9; suffix += 1) {
    if (!used.has(suffix)) return Number(`${baseVersion}.${suffix}`);
  }
  throw new Error(`No AI sub-version slot is available for V${baseVersion}.`);
}

function dataUrlFromAsset(options, asset) {
  if (!asset?.filePath) return "";
  const assetRoot = path.resolve(options.assetDir);
  const fullPath = path.resolve(assetRoot, asset.filePath);
  const relativePath = path.relative(assetRoot, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw new Error("Invalid asset path.");
  const mimeType = asset.mimeType || mimeTypeForFilePath(asset.filePath);
  return `data:${mimeType};base64,${fs.readFileSync(fullPath).toString("base64")}`;
}

async function dataUrlFromRemoteImage(url, fetchImpl = fetch) {
  if (!/^https?:\/\//i.test(String(url || ""))) return "";
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available for remote source images.");
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Source image fetch failed (${response.status}).`);
  const contentType = response.headers.get("content-type") || mimeTypeForFilePath(new URL(url).pathname);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 20 * 1024 * 1024) throw new Error("Source image is larger than the OpenAI image edit limit.");
  return `data:${contentType.split(";")[0] || "image/png"};base64,${buffer.toString("base64")}`;
}

async function sourceImageDataUrlFor(options, product, angleIndex, version, fetchImpl) {
  const sourceAsset = plainImageAssetFor(product, angleIndex, version);
  if (sourceAsset) return { dataUrl: dataUrlFromAsset(options, sourceAsset), asset: sourceAsset, source: "plain" };
  const ktwImage = (product.ktwImages || [])[normalizePlainImageAngleIndex(angleIndex) - 1] ||
    (normalizePlainImageAngleIndex(angleIndex) === 1 && product.sourceImageUrl ? { url: product.sourceImageUrl } : null);
  if (ktwImage?.url) {
    return {
      dataUrl: await dataUrlFromRemoteImage(ktwImage.url, fetchImpl),
      asset: null,
      source: "ktw",
    };
  }
  throw new Error("No source image is available for this angle/version.");
}

function sourceImageReferenceFor(product, angleIndex, version) {
  const sourceAsset = plainImageAssetFor(product, angleIndex, version);
  if (sourceAsset) {
    return {
      type: "plain",
      assetId: sourceAsset.id || "",
      publicUrl: sourceAsset.publicUrl || "",
      fileName: sourceAsset.fileName || "",
    };
  }
  const normalizedAngleIndex = normalizePlainImageAngleIndex(angleIndex);
  const ktwImage = (product.ktwImages || [])[normalizedAngleIndex - 1] ||
    (normalizedAngleIndex === 1 && product.sourceImageUrl ? { url: product.sourceImageUrl } : null);
  if (ktwImage?.url) {
    return {
      type: "ktw",
      imageUrl: ktwImage.url || "",
      sourceUrl: ktwImage.sourceUrl || product.sourceUrl || "",
      alt: ktwImage.alt || product.name || product.sku || "",
    };
  }
  return null;
}

async function createOpenAIImageEdit(request) {
  const apiKey = String(request.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for AI image editing.");
  const model = request.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const referenceImages = sanitizeAiReferenceImages(request.referenceImages);
  const images = [
    { image_url: request.sourceImageDataUrl },
    ...referenceImages.map((image) => ({ image_url: image.dataUrl })),
  ];
  const response = await (request.fetchImpl || fetch)("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: request.prompt,
      images,
      n: 1,
      output_format: "png",
      quality: "auto",
      size: "1024x1024",
      input_fidelity: "high",
    }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `OpenAI image edit failed (${response.status})`;
    throw new Error(message);
  }
  const image = data?.data?.[0] || {};
  if (!image.b64_json) throw new Error("OpenAI did not return image data.");
  return {
    dataUrl: `data:image/png;base64,${image.b64_json}`,
    mimeType: "image/png",
    model,
    revisedPrompt: image.revised_prompt || "",
  };
}

function savePlainDesignAssetFiles(options, payload) {
  const sku = normalizeSku(payload.sku);
  const group = String(payload.group || "");
  const files = Array.isArray(payload.files) ? payload.files : [];
  const angleIndex = group === "product_images" ? normalizePlainImageAngleIndex(payload.angleIndex) : 0;
  const version = group === "product_images" && angleIndex > 0 ? normalizePlainImageVersion(payload.version) : 0;
  const metadata = sanitizeAssetMetadata(payload.metadata);
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
    const asset = {
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
    if (angleIndex > 0) {
      asset.angleIndex = angleIndex;
      asset.version = version;
      asset.slotKey = `angle-${angleIndex}-v${version}`;
    }
    if (Object.keys(metadata).length) asset.metadata = metadata;
    return asset;
  });

  product.assets = [...created, ...(product.assets || [])];
  product.updatedAt = new Date().toISOString();
  savePlainDesignState(options, state);
  return created;
}

async function createPlainDesignAiImageRevision(options, payload, deps = {}) {
  const sku = normalizeSku(payload.sku);
  const angleIndex = normalizePlainImageAngleIndex(payload.angleIndex);
  const sourceVersion = normalizePlainImageVersion(payload.version);
  const prompt = String(payload.prompt || "").trim();
  if (!sku) throw new Error("SKU is required.");
  if (!angleIndex) throw new Error("Angle index is required.");
  if (!prompt) throw new Error("AI edit prompt is required.");
  const referenceImages = sanitizeAiReferenceImages(payload.referenceImages);

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === sku);
  if (!product) throw new Error(`Product ${sku} was not found.`);
  const newVersion = nextPlainImageSubVersion(product, angleIndex, sourceVersion);
  const sourceImage = await sourceImageDataUrlFor(options, product, angleIndex, sourceVersion, deps.fetchImpl);
  const editPrompt = [
    `Product SKU: ${product.sku}`,
    `Product name: ${product.name}`,
    `Angle: ${angleIndex}`,
    `Create a refined PLAIN redesign image based on the source image.`,
    `Keep the same product angle and make a commercially usable product design image.`,
    referenceImages.length ? `Use the ${referenceImages.length} attached reference image(s) as visual direction.` : "",
    `User instruction: ${prompt}`,
  ].filter(Boolean).join("\n");
  const imageResult = await (deps.generateImageEdit || createOpenAIImageEdit)({
    sku,
    angleIndex,
    sourceVersion,
    newVersion,
    prompt: editPrompt,
    sourceImageDataUrl: sourceImage.dataUrl,
    referenceImages,
    model: deps.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    apiKey: deps.apiKey,
    fetchImpl: deps.fetchImpl,
  });
  const fileName = `${sku}-angle-${angleIndex}-v${String(newVersion).replace(".", "-")}-ai.png`;
  const [asset] = savePlainDesignAssetFiles(options, {
    sku,
    group: "product_images",
    angleIndex,
    version: newVersion,
    files: [{
      name: fileName,
      type: imageResult.mimeType || "image/png",
      dataUrl: imageResult.dataUrl,
    }],
    metadata: {
      aiGenerated: true,
      aiPrompt: prompt,
      aiModel: imageResult.model || deps.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      sourceVersion,
      sourceType: sourceImage.source,
      parentAssetId: sourceImage.asset?.id || "",
      referenceImageCount: referenceImages.length,
      revisedPrompt: imageResult.revisedPrompt || "",
    },
  });
  const productWithSelection = updatePlainDesignProduct(options, {
    sku,
    plainImageVersionSelections: { [angleIndex]: newVersion },
  });
  return {
    ok: true,
    sku,
    angleIndex,
    sourceVersion,
    newVersion,
    asset,
    product: productWithSelection,
  };
}

function pendingCodexVersionsFor(state, sku, angleIndex) {
  return (state.codexAiJobs || [])
    .filter((job) => (
      job.sku === sku &&
      normalizePlainImageAngleIndex(job.angleIndex) === normalizePlainImageAngleIndex(angleIndex) &&
      ["pending", "working"].includes(normalizeCodexAiJobStatus(job.status))
    ))
    .map((job) => normalizePlainImageVersion(job.newVersion));
}

function queuePlainDesignCodexImageJob(options, payload) {
  const sku = normalizeSku(payload.sku);
  const angleIndex = normalizePlainImageAngleIndex(payload.angleIndex);
  const sourceVersion = normalizePlainImageVersion(payload.version);
  const prompt = String(payload.prompt || "").trim();
  if (!sku) throw new Error("SKU is required.");
  if (!angleIndex) throw new Error("Angle index is required.");
  if (!prompt) throw new Error("AI edit prompt is required.");
  const referenceImages = persistAiReferenceImages(options, sku, sanitizeAiReferenceImages(payload.referenceImages));

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === sku);
  if (!product) throw new Error(`Product ${sku} was not found.`);
  const source = sourceImageReferenceFor(product, angleIndex, sourceVersion);
  if (!source) throw new Error("No source image is available for this angle/version.");
  const newVersion = nextPlainImageSubVersion(product, angleIndex, sourceVersion, pendingCodexVersionsFor(state, sku, angleIndex));
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    type: "plain_image_redesign",
    status: "pending",
    sku,
    productName: product.name || "",
    angleIndex,
    sourceVersion,
    newVersion,
    prompt,
    referenceImages,
    source,
    createdAt: now,
    updatedAt: now,
    startedAt: "",
    completedAt: "",
    error: "",
    assetId: "",
    assetPublicUrl: "",
    fileName: "",
    revisedPrompt: "",
  };
  state.codexAiJobs = [job, ...(state.codexAiJobs || [])];
  savePlainDesignState(options, state);
  return { ok: true, job, codexAiJobs: state.codexAiJobs };
}

function listPlainDesignCodexImageJobs(options, filters = {}) {
  const status = String(filters.status || "").trim().toLowerCase();
  const sku = normalizeSku(filters.sku);
  const state = loadPlainDesignState(options);
  const jobs = (state.codexAiJobs || []).filter((job) => {
    if (status && normalizeCodexAiJobStatus(job.status) !== status) return false;
    if (sku && job.sku !== sku) return false;
    return true;
  });
  return { ok: true, jobs };
}

function updatePlainDesignCodexImageJob(options, payload) {
  const jobId = String(payload.jobId || payload.id || "");
  const status = normalizeCodexAiJobStatus(payload.status);
  if (!jobId) throw new Error("jobId is required.");
  const state = loadPlainDesignState(options);
  let updated = null;
  const now = new Date().toISOString();
  state.codexAiJobs = (state.codexAiJobs || []).map((job) => {
    if (job.id !== jobId) return job;
    updated = {
      ...job,
      status,
      updatedAt: now,
      startedAt: status === "working" && !job.startedAt ? now : job.startedAt,
      completedAt: ["completed", "failed", "cancelled"].includes(status) ? now : job.completedAt,
      error: Object.prototype.hasOwnProperty.call(payload, "error") ? String(payload.error || "") : job.error,
    };
    return updated;
  });
  if (!updated) throw new Error(`Codex image job ${jobId} was not found.`);
  savePlainDesignState(options, state);
  return { ok: true, job: updated };
}

function completePlainDesignCodexImageJob(options, payload) {
  const jobId = String(payload.jobId || payload.id || "");
  const imageDataUrl = String(payload.imageDataUrl || payload.dataUrl || "").trim();
  if (!jobId) throw new Error("jobId is required.");
  if (!imageDataUrl) throw new Error("imageDataUrl is required.");

  let state = loadPlainDesignState(options);
  const job = (state.codexAiJobs || []).find((item) => item.id === jobId);
  if (!job) throw new Error(`Codex image job ${jobId} was not found.`);
  if (["completed", "cancelled"].includes(normalizeCodexAiJobStatus(job.status))) {
    throw new Error(`Codex image job ${jobId} is already ${job.status}.`);
  }
  const product = state.products.find((item) => item.sku === job.sku);
  if (!product) throw new Error(`Product ${job.sku} was not found.`);

  const decoded = decodeDataUrl(imageDataUrl);
  const fileName = safeSegment(
    payload.fileName || `${job.sku}-angle-${job.angleIndex}-v${String(job.newVersion).replace(".", "-")}-codex.png`,
    "codex-result.png"
  );
  const [asset] = savePlainDesignAssetFiles(options, {
    sku: job.sku,
    group: "product_images",
    angleIndex: job.angleIndex,
    version: job.newVersion,
    files: [{
      name: fileName,
      type: payload.mimeType || decoded.mimeType || "image/png",
      dataUrl: imageDataUrl,
    }],
    metadata: {
      aiGenerated: true,
      codexGenerated: true,
      codexJobId: job.id,
      aiPrompt: job.prompt,
      aiModel: payload.model || "Codex + ChatGPT",
      sourceVersion: job.sourceVersion,
      sourceType: job.source?.type || "",
      parentAssetId: job.source?.assetId || "",
      referenceImageCount: (job.referenceImages || []).length,
      revisedPrompt: payload.revisedPrompt || "",
    },
  });
  const productWithSelection = updatePlainDesignProduct(options, {
    sku: job.sku,
    plainImageVersionSelections: { [job.angleIndex]: job.newVersion },
  });

  state = loadPlainDesignState(options);
  const now = new Date().toISOString();
  let completedJob = null;
  state.codexAiJobs = (state.codexAiJobs || []).map((item) => {
    if (item.id !== job.id) return item;
    completedJob = {
      ...item,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      error: "",
      assetId: asset.id,
      assetPublicUrl: asset.publicUrl,
      fileName: asset.fileName,
      revisedPrompt: String(payload.revisedPrompt || ""),
    };
    return completedJob;
  });
  savePlainDesignState(options, state);
  return {
    ok: true,
    job: completedJob,
    asset,
    product: productWithSelection,
  };
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
  completePlainDesignCodexImageJob,
  createPlainDesignAiImageRevision,
  deletePlainDesignAsset,
  listPlainDesignCodexImageJobs,
  loadPlainDesignState,
  queuePlainDesignCodexImageJob,
  resolvePlainDesignAssetPath,
  savePlainDesignAssetFiles,
  savePlainDesignPurchaseOrders,
  updatePlainDesignCodexImageJob,
  updatePlainDesignProduct,
};
