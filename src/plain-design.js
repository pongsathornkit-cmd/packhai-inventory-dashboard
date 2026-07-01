(function () {
  const embedded = window.__PLAIN_DESIGN__ || {};
  const EXCHANGE_RATE_REFRESH_MS = 5 * 60 * 1000;
  const PURCHASE_ORDERS_STORAGE_KEY = "plainPurchaseOrdersV2";
  const PLAIN_IMAGE_VERSION_COUNT = 3;
  const MAX_AI_REFERENCE_IMAGES = 3;
  const MAX_AI_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
  const MOMO_RATES = {
    truck: {
      label: "ทางรถ 7-14 วัน",
      A: { label: "A ทั่วไป", cbm: 7500, kg: 40 },
      M: { label: "M มอก.", cbm: 8500, kg: 55 },
      O: { label: "O อย.", cbm: 8900, kg: 60 },
      X: { label: "X พิเศษ", cbm: 12000, kg: 120 },
      Z: { label: "Z ควบคุม", cbm: 14000, kg: 140 },
    },
    sea: {
      label: "ทางเรือ 14-18 วัน",
      A: { label: "A ทั่วไป", cbm: 4900, kg: 30 },
      M: { label: "M มอก.", cbm: 6000, kg: 40 },
      O: { label: "O อย.", cbm: 7900, kg: 50 },
      X: { label: "X พิเศษ", cbm: 10000, kg: 100 },
      Z: { label: "Z ควบคุม", cbm: 12000, kg: 120 },
    },
  };

  const state = {
    products: embedded.products || [],
    statusOptions: embedded.statusOptions || [],
    categoryOptions: embedded.categoryOptions || [],
    assetGroups: embedded.assetGroups || [],
    selectedSku: "",
    query: "",
    category: "all",
    status: "all",
    fastCargoDiscount: numberValue(localStorage.getItem("plainFastCargoDiscount") || 30),
    poNumber: localStorage.getItem("plainPoNumber") || `PLAIN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    supplierName: localStorage.getItem("plainSupplierName") || "PLAIN Redesign Supplier",
    poDate: localStorage.getItem("plainPoDate") || new Date().toISOString().slice(0, 10),
    purchaseOrders: [],
    activePurchaseOrderId: localStorage.getItem("plainActivePurchaseOrderId") || "",
    bulkStatusSelectedSkus: new Set(),
    bulkStatusTarget: "",
    bulkAiPrompt: "",
    bulkAiRequest: null,
    bulkAiReferenceImages: [],
    productTableMode: localStorage.getItem("plainProductTableMode") || "combined",
    productImageMode: localStorage.getItem("plainProductImageMode") || "ktw",
    detailPanelCollapsed: localStorage.getItem("plainDetailPanelCollapsed") === "1",
    aiImageRequests: new Map(),
    aiImageReferenceUploads: new Map(),
    exchangeRate: {
      rate: numberValue(localStorage.getItem("plainUsdThbRate") || 0),
      fetchedAt: localStorage.getItem("plainUsdThbFetchedAt") || "",
      source: "Google Finance",
      sourceUrl: "https://www.google.com/finance/quote/USD-THB",
      loading: false,
      stale: false,
      error: "",
    },
    saving: false,
  };

  const $ = (id) => document.getElementById(id);
  const fmtQty = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const fmtMeasure = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 4 });
  const fmtMoney = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  });
  const fmtUsd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  const fmtPercent = new Intl.NumberFormat("th-TH", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  let imageLightboxLastFocus = null;
  let imageLightboxSlides = [];
  let imageLightboxSlideIndex = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeCss(value) {
    return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
  }

  function numberValue(value) {
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[,\s]|THB|%/gi, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function moneyValue(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, numberValue(value)));
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

  function showMessage(message, isError = false) {
    const el = $("statusLine");
    el.hidden = false;
    el.className = isError ? "status-line error" : "status-line";
    el.textContent = message;
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => {
      el.hidden = true;
    }, isError ? 5000 : 1800);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload;
  }

  function normalizeProduct(product) {
    const ktwPrice = numberValue(product.ktwPrice);
    const purchaseUnitCostCleared = Boolean(product.purchaseUnitCostCleared);
    return {
      ...product,
      ktwPrice,
      orderQuantity: numberValue(product.orderQuantity),
      purchaseUnitCostUsd: numberValue(product.purchaseUnitCostUsd),
      purchaseUnitCost: purchaseUnitCostCleared ? 0 : numberValue(product.purchaseUnitCost || ktwPrice),
      purchaseUnitCostCleared,
      saleUnitPrice: ktwPrice,
      widthCm: numberValue(product.widthCm),
      lengthCm: numberValue(product.lengthCm),
      heightCm: numberValue(product.heightCm),
      unitWeightKg: numberValue(product.unitWeightKg),
      packagingUnitCost: numberValue(product.packagingUnitCost),
      otherUnitCost: numberValue(product.otherUnitCost),
      cargoMode: product.cargoMode || "truck",
      cargoType: product.cargoType || "A",
      ktwLogistics: product.ktwLogistics || null,
      ktwImages: Array.isArray(product.ktwImages) ? product.ktwImages : [],
      plainImageVersionSelections: normalizePlainImageVersionSelections(product.plainImageVersionSelections),
    };
  }

  function todayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function makeClientId(prefix = "po") {
    return window.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function makePurchaseOrderNumber(index = state.purchaseOrders.length + 1) {
    return `PLAIN-${todayDate().replace(/-/g, "")}-${String(index).padStart(2, "0")}`;
  }

  function plannedOrderLines() {
    return Object.fromEntries(
      state.products
        .map((product) => [product.sku, numberValue(product.orderQuantity)])
        .filter(([, qty]) => qty > 0)
    );
  }

  function poAvailableProducts(order = activePurchaseOrder()) {
    const selectedSkus = new Set(
      Object.entries(order?.lines || {})
        .filter(([, qty]) => numberValue(qty) > 0)
        .map(([sku]) => sku)
    );
    return state.products.filter((product) => !selectedSkus.has(product.sku));
  }

  function normalizePurchaseOrder(order = {}, index = 0) {
    const lines = {};
    Object.entries(order.lines || {}).forEach(([sku, qty]) => {
      const normalizedSku = String(sku || "").trim();
      if (normalizedSku) lines[normalizedSku] = numberValue(qty);
    });
    const now = new Date().toISOString();
    return {
      id: String(order.id || makeClientId("po")),
      number: String(order.number || "").trim() || makePurchaseOrderNumber(index + 1),
      poDate: String(order.poDate || "").slice(0, 10) || todayDate(),
      supplierName: String(order.supplierName || state.supplierName || "PLAIN Redesign Supplier"),
      fastCargoDiscount: clamp(order.fastCargoDiscount ?? state.fastCargoDiscount ?? 30, 0, 100),
      status: String(order.status || "draft"),
      createdAt: order.createdAt || now,
      updatedAt: order.updatedAt || now,
      lines,
    };
  }

  function readLocalPurchaseOrders() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PURCHASE_ORDERS_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function makePurchaseOrder(lines = {}) {
    return normalizePurchaseOrder({
      id: makeClientId("po"),
      number: makePurchaseOrderNumber(state.purchaseOrders.length + 1),
      poDate: todayDate(),
      supplierName: state.supplierName,
      fastCargoDiscount: state.fastCargoDiscount,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    });
  }

  function activePurchaseOrder() {
    return state.purchaseOrders.find((order) => order.id === state.activePurchaseOrderId) || state.purchaseOrders[0] || null;
  }

  function savePurchaseOrdersLocal() {
    localStorage.setItem(PURCHASE_ORDERS_STORAGE_KEY, JSON.stringify(state.purchaseOrders));
    localStorage.setItem("plainActivePurchaseOrderId", state.activePurchaseOrderId || "");
    localStorage.setItem("plainPoNumber", state.poNumber || "");
    localStorage.setItem("plainPoDate", state.poDate || "");
    localStorage.setItem("plainSupplierName", state.supplierName || "");
    localStorage.setItem("plainFastCargoDiscount", String(state.fastCargoDiscount));
  }

  function syncActivePurchaseOrderState() {
    const order = activePurchaseOrder();
    if (!order) return;
    state.activePurchaseOrderId = order.id;
    state.poNumber = order.number;
    state.poDate = order.poDate;
    state.supplierName = order.supplierName;
    state.fastCargoDiscount = clamp(order.fastCargoDiscount, 0, 100);
    savePurchaseOrdersLocal();
  }

  function initializePurchaseOrders(serverOrders = []) {
    const source = Array.isArray(serverOrders) && serverOrders.length ? serverOrders : readLocalPurchaseOrders();
    const orders = source.map((order, index) => normalizePurchaseOrder(order, index));
    state.purchaseOrders = orders.length ? orders : [makePurchaseOrder(plannedOrderLines())];
    if (!state.purchaseOrders.some((order) => order.id === state.activePurchaseOrderId)) {
      state.activePurchaseOrderId = state.purchaseOrders[0]?.id || "";
    }
    syncActivePurchaseOrderState();
  }

  function persistPurchaseOrders() {
    savePurchaseOrdersLocal();
    window.clearTimeout(persistPurchaseOrders.timer);
    persistPurchaseOrders.timer = window.setTimeout(async () => {
      try {
        const payload = await api("/api/plain-design/purchase-orders", {
          method: "POST",
          body: JSON.stringify({ purchaseOrders: state.purchaseOrders }),
        });
        if (Array.isArray(payload.purchaseOrders)) {
          state.purchaseOrders = payload.purchaseOrders.map((order, index) => normalizePurchaseOrder(order, index));
          if (!state.purchaseOrders.some((order) => order.id === state.activePurchaseOrderId)) {
            state.activePurchaseOrderId = state.purchaseOrders[0]?.id || "";
          }
          syncActivePurchaseOrderState();
        }
      } catch (error) {
        showMessage(`บันทึกบิลไม่สำเร็จ: ${error.message}`, true);
      }
    }, 450);
  }

  function createPurchaseOrder() {
    const order = makePurchaseOrder({});
    state.purchaseOrders = [order, ...state.purchaseOrders];
    state.activePurchaseOrderId = order.id;
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
    renderPoPanel();
    showMessage("สร้างบิลใหม่แล้ว");
  }

  function deletePurchaseOrder(id = state.activePurchaseOrderId) {
    const target = state.purchaseOrders.find((order) => order.id === id);
    if (!target) return;
    if (window.confirm && !window.confirm(`ลบใบสั่งซื้อ ${target.number} ใช่ไหม?`)) return;
    state.purchaseOrders = state.purchaseOrders.filter((order) => order.id !== id);
    if (!state.purchaseOrders.length) state.purchaseOrders = [makePurchaseOrder({})];
    const nextActiveOrder = activePurchaseOrder() || state.purchaseOrders[0];
    state.activePurchaseOrderId = nextActiveOrder?.id || "";
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
    renderStats();
    renderPoPanel();
    showMessage(`ลบใบสั่งซื้อ ${target.number} แล้ว`);
  }

  function setActivePurchaseOrder(id) {
    if (!state.purchaseOrders.some((order) => order.id === id)) return;
    state.activePurchaseOrderId = id;
    syncActivePurchaseOrderState();
    renderPoPanel();
  }

  function updateActivePurchaseOrder(updates) {
    const order = activePurchaseOrder();
    if (!order) return;
    Object.assign(order, updates);
    if (Object.prototype.hasOwnProperty.call(updates, "fastCargoDiscount")) {
      order.fastCargoDiscount = clamp(updates.fastCargoDiscount, 0, 100);
    }
    order.updatedAt = new Date().toISOString();
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
  }

  function updateActivePurchaseOrderLine(sku, qty) {
    const order = activePurchaseOrder();
    if (!order) return;
    const normalizedQty = Math.max(0, numberValue(qty));
    if (normalizedQty > 0) order.lines[sku] = normalizedQty;
    else delete order.lines[sku];
    order.updatedAt = new Date().toISOString();
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
    renderStats();
    if (normalizedQty > 0) refreshPoRealtime();
    else renderPoPanel();
  }

  function addPurchaseOrderLine(sku, qty) {
    const order = activePurchaseOrder();
    const product = state.products.find((item) => item.sku === sku);
    if (!order || !product) {
      showMessage("เลือกสินค้าที่ต้องการเพิ่มเข้าบิลก่อน", true);
      return;
    }
    const defaultQty = numberValue(product.orderQuantity) || 1;
    const normalizedQty = Math.max(1, numberValue(qty) || defaultQty);
    order.lines[sku] = normalizedQty;
    order.updatedAt = new Date().toISOString();
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
    renderStats();
    renderTrackerTable();
    renderDesignDetail();
    renderPoPanel();
    showMessage(`เพิ่ม ${sku} เข้าบิลแล้ว`);
  }

  function removePurchaseOrderLine(sku) {
    const order = activePurchaseOrder();
    if (!order || !order.lines?.[sku]) return;
    delete order.lines[sku];
    order.updatedAt = new Date().toISOString();
    syncActivePurchaseOrderState();
    persistPurchaseOrders();
    renderStats();
    renderTrackerTable();
    renderDesignDetail();
    renderPoPanel();
    showMessage(`ลบ ${sku} ออกจากบิลแล้ว`);
  }

  function poUsdCostUpdates(sku, value) {
    const purchaseUnitCostUsd = numberValue(value);
    const purchaseUnitCost =
      state.exchangeRate.rate > 0 && purchaseUnitCostUsd > 0
        ? moneyValue(purchaseUnitCostUsd * state.exchangeRate.rate)
        : 0;
    return { purchaseUnitCostUsd, purchaseUnitCost, purchaseUnitCostCleared: purchaseUnitCostUsd <= 0 };
  }

  async function loadExchangeRate(force = false) {
    state.exchangeRate.loading = true;
    try {
      const payload = await api(`/api/plain-design/exchange-rate${force ? "?force=1" : ""}`);
      const rate = numberValue(payload.rate);
      if (rate > 0) {
        state.exchangeRate = {
          rate,
          fetchedAt: payload.fetchedAt || new Date().toISOString(),
          source: payload.source || "Google Finance",
          sourceUrl: payload.sourceUrl || state.exchangeRate.sourceUrl,
          loading: false,
          stale: Boolean(payload.stale),
          error: payload.error || "",
        };
        localStorage.setItem("plainUsdThbRate", String(rate));
        localStorage.setItem("plainUsdThbFetchedAt", state.exchangeRate.fetchedAt);
      }
    } catch (error) {
      state.exchangeRate.loading = false;
      state.exchangeRate.error = error.message || String(error);
      showMessage(`ดึงเรต USD/THB ไม่สำเร็จ: ${state.exchangeRate.error}`, true);
    }
    render();
  }

  async function loadState() {
    try {
      const payload = await api("/api/plain-design/state");
      state.products = (payload.products || state.products).map(normalizeProduct);
      state.statusOptions = payload.statusOptions || state.statusOptions;
      state.categoryOptions = payload.categoryOptions || state.categoryOptions;
      state.assetGroups = payload.assetGroups || state.assetGroups;
      state.selectedSku = state.selectedSku || state.products[0]?.sku || "";
      initializePurchaseOrders(payload.purchaseOrders || []);
    } catch (error) {
      showMessage(`ใช้ข้อมูล fallback: ${error.message}`, true);
      state.products = state.products.map(normalizeProduct);
      state.selectedSku = state.selectedSku || state.products[0]?.sku || "";
      initializePurchaseOrders([]);
    }
    render();
  }

  function selectedProduct() {
    return state.products.find((product) => product.sku === state.selectedSku) || state.products[0] || null;
  }

  function categoryLabel(category) {
    return state.categoryOptions.find((item) => item.id === category)?.label || category;
  }

  function statusMeta(status) {
    return state.statusOptions.find((item) => item.id === status) || state.statusOptions[0] || { label: status, tone: "" };
  }

  function cargoRate(product) {
    const mode = MOMO_RATES[product.cargoMode] ? product.cargoMode : "truck";
    const type = MOMO_RATES[mode][product.cargoType] ? product.cargoType : "A";
    return { mode, type, ...MOMO_RATES[mode][type], modeLabel: MOMO_RATES[mode].label };
  }

  function effectivePurchaseUnitCost(product) {
    if (product.purchaseUnitCostCleared) return 0;
    const usd = numberValue(product.purchaseUnitCostUsd);
    const rate = numberValue(state.exchangeRate.rate);
    if (usd > 0 && rate > 0) return moneyValue(usd * rate);
    return numberValue(product.purchaseUnitCost || product.ktwPrice);
  }

  function displayPurchaseUnitCostUsd(product) {
    if (product.purchaseUnitCostCleared) return 0;
    const usd = numberValue(product.purchaseUnitCostUsd);
    if (usd > 0) return usd;
    const thb = numberValue(product.purchaseUnitCost || product.ktwPrice);
    const rate = numberValue(state.exchangeRate.rate);
    return rate > 0 && thb > 0 ? moneyValue(thb / rate) : 0;
  }

  function lineCalc(product, discountPercent = state.fastCargoDiscount) {
    const qty = numberValue(product.orderQuantity);
    const purchaseUnitCostUsd = displayPurchaseUnitCostUsd(product);
    const purchaseUnitCost = effectivePurchaseUnitCost(product);
    const saleUnitPrice = numberValue(product.saleUnitPrice || product.ktwPrice);
    const packagingUnitCost = numberValue(product.packagingUnitCost);
    const otherUnitCost = numberValue(product.otherUnitCost);
    const widthCm = numberValue(product.widthCm);
    const lengthCm = numberValue(product.lengthCm);
    const heightCm = numberValue(product.heightCm);
    const unitWeightKg = numberValue(product.unitWeightKg);
    const cbmPerUnit = widthCm > 0 && lengthCm > 0 && heightCm > 0 ? (widthCm * lengthCm * heightCm) / 1000000 : 0;
    const totalCbm = cbmPerUnit * qty;
    const totalWeightKg = unitWeightKg * qty;
    const rate = cargoRate(product);
    const cbmCharge = totalCbm * rate.cbm;
    const weightCharge = totalWeightKg * rate.kg;
    const momoBaseShipping = Math.max(cbmCharge, weightCharge);
    const discount = clamp(discountPercent, 0, 100);
    const shippingTotal = moneyValue(momoBaseShipping * (1 - discount / 100));
    const shippingUnit = qty > 0 ? shippingTotal / qty : 0;
    const unitCost = purchaseUnitCost + packagingUnitCost + otherUnitCost + shippingUnit;
    const revenueTotal = saleUnitPrice * qty;
    const productCostTotal = purchaseUnitCost * qty;
    const packagingTotal = packagingUnitCost * qty;
    const otherTotal = otherUnitCost * qty;
    const totalCost = productCostTotal + packagingTotal + otherTotal + shippingTotal;
    const profitTotal = revenueTotal - totalCost;
    return {
      qty,
      purchaseUnitCostUsd,
      purchaseUnitCost,
      saleUnitPrice,
      packagingUnitCost,
      otherUnitCost,
      cbmPerUnit,
      totalCbm,
      totalWeightKg,
      rate,
      cbmCharge,
      weightCharge,
      chargeBasis: cbmCharge >= weightCharge ? "CBM" : "KG",
      momoBaseShipping,
      shippingTotal,
      shippingUnit,
      unitCost,
      revenueTotal,
      productCostTotal,
      packagingTotal,
      otherTotal,
      totalCost,
      profitUnit: saleUnitPrice - unitCost,
      profitTotal,
      marginPct: revenueTotal > 0 ? profitTotal / revenueTotal : 0,
    };
  }

  function purchaseOrderQuantity(order, sku) {
    return numberValue(order?.lines?.[sku]);
  }

  function poLineRows(order = activePurchaseOrder()) {
    const discount = numberValue(order?.fastCargoDiscount ?? state.fastCargoDiscount);
    return state.products.map((product) => ({
      product,
      calc: lineCalc({ ...product, orderQuantity: purchaseOrderQuantity(order, product.sku) }, discount),
    }));
  }

  function billCalc(order = activePurchaseOrder()) {
    const tableRows = poLineRows(order);
    return tableRows.reduce(
      (total, line) => {
        if (line.calc.qty <= 0) return total;
        total.qty += line.calc.qty;
        total.revenueTotal += line.calc.revenueTotal;
        total.productCostTotal += line.calc.productCostTotal;
        total.packagingTotal += line.calc.packagingTotal;
        total.otherTotal += line.calc.otherTotal;
        total.shippingTotal += line.calc.shippingTotal;
        total.totalCost += line.calc.totalCost;
        total.profitTotal += line.calc.profitTotal;
        total.lines.push(line);
        return total;
      },
      {
        tableRows,
        lines: [],
        qty: 0,
        revenueTotal: 0,
        productCostTotal: 0,
        packagingTotal: 0,
        otherTotal: 0,
        shippingTotal: 0,
        totalCost: 0,
        profitTotal: 0,
      }
    );
  }

  function assetsFor(product, group) {
    return (product?.assets || []).filter((asset) => asset.group === group);
  }

  function plainVersionLabel(version) {
    const normalized = normalizePlainImageVersion(version);
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
  }

  function plainImageVersions(product, index) {
    const angleIndex = normalizePlainImageAngleIndex(index + 1);
    const baseVersions = Array.from({ length: PLAIN_IMAGE_VERSION_COUNT }, (_, itemIndex) => itemIndex + 1);
    const assetVersions = assetsFor(product, "product_images")
      .filter((asset) => asset?.publicUrl && assetAngleIndex(asset) === angleIndex)
      .map((asset) => assetVersion(asset));
    return [...new Set([...baseVersions, ...assetVersions])]
      .sort((a, b) => a - b);
  }

  function plainImageRowVersions(product) {
    const baseVersions = Array.from({ length: PLAIN_IMAGE_VERSION_COUNT }, (_, itemIndex) => itemIndex + 1);
    const assetVersions = assetsFor(product, "product_images")
      .filter((asset) => asset?.publicUrl && assetAngleIndex(asset) > 0)
      .map((asset) => assetVersion(asset));
    return [...new Set([...baseVersions, ...assetVersions])]
      .sort((a, b) => a - b);
  }

  function assetAngleIndex(asset) {
    return normalizePlainImageAngleIndex(asset?.angleIndex);
  }

  function assetVersion(asset) {
    return normalizePlainImageVersion(asset?.version);
  }

  function legacyProductImageAssets(product) {
    return assetsFor(product, "product_images").filter((asset) => asset?.publicUrl && !assetAngleIndex(asset));
  }

  function plainImageVersionSelection(product, index) {
    const angleIndex = normalizePlainImageAngleIndex(index + 1);
    return normalizePlainImageVersion(product?.plainImageVersionSelections?.[angleIndex] || 1);
  }

  function plainImageAssetFor(product, index, version = plainImageVersionSelection(product, index)) {
    const angleIndex = normalizePlainImageAngleIndex(index + 1);
    if (!angleIndex) return null;
    const slottedAsset = assetsFor(product, "product_images").find((asset) => (
      asset?.publicUrl &&
      assetAngleIndex(asset) === angleIndex &&
      assetVersion(asset) === normalizePlainImageVersion(version)
    ));
    if (slottedAsset) return slottedAsset;
    return normalizePlainImageVersion(version) === 1 ? legacyProductImageAssets(product)[index] || null : null;
  }

  function aiImageRequestKey(sku, angleIndex, version) {
    return `${sku}|${normalizePlainImageAngleIndex(angleIndex)}|${plainVersionLabel(version)}`;
  }

  function renderAiReferenceSummary(files = []) {
    const items = Array.isArray(files) ? files : [];
    if (!items.length) return `<small class="ai-reference-summary muted">ยังไม่ได้แนบรูปอ้างอิง</small>`;
    const names = items.map((file) => file.name || "reference image").slice(0, MAX_AI_REFERENCE_IMAGES);
    return `<small class="ai-reference-summary">${fmtQty.format(items.length)} รูปอ้างอิง: ${escapeHtml(names.join(", "))}</small>`;
  }

  function referenceImagesForAiRequest(requestKey) {
    return (state.aiImageReferenceUploads.get(requestKey) || []).map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: file.dataUrl,
    }));
  }

  function plainProductImageCompletionCount(product) {
    const target = assetTarget(product, "product_images");
    return Array.from({ length: target })
      .filter((_, index) => plainImageAssetFor(product, index)?.publicUrl)
      .length;
  }

  function completion(product) {
    const completed = state.assetGroups.filter((group) => {
      const progress = assetProgress(product, group.id);
      return progress.count >= progress.target;
    }).length;
    const total = Math.max(1, state.assetGroups.length);
    return { completed, total, percent: Math.round((completed / total) * 100) };
  }

  function ktwImagesFor(product) {
    const images = (product?.ktwImages || []).filter((image) => image?.url);
    if (images.length) return images;
    return product?.sourceImageUrl ? [{ angleNo: 1, url: product.sourceImageUrl, alt: product.name || "", sourceUrl: product.sourceUrl || "" }] : [];
  }

  function tableCoverImageFor(product) {
    const ktwCover = ktwImagesFor(product)[0] || {};
    const ktwImage = {
      src: ktwCover.url || product.sourceImageUrl || "",
      alt: ktwCover.alt || product.name || product.sku || "",
      mode: "ktw",
    };
    const plainAsset = plainImageAssetFor(product, 0) || assetsFor(product, "product_images")[0];
    if (state.productImageMode === "plain") {
      if (plainAsset?.publicUrl) {
        return {
          src: plainAsset.publicUrl,
          alt: plainAsset.fileName || product.name || product.sku || "",
          mode: "plain",
        };
      }
      return {
        src: "",
        alt: product.name || product.sku || "",
        mode: "plain",
        empty: true,
      };
    }
    return ktwImage;
  }

  function tableImageGalleryFor(product, mode = state.productImageMode) {
    const normalizedMode = mode === "plain" ? "plain" : "ktw";
    if (normalizedMode === "plain") {
      const plainImages = assetsFor(product, "product_images");
      const highestVersionedAngle = Math.max(0, ...plainImages.map(assetAngleIndex));
      const galleryCount = Math.max(1, ktwImagesFor(product).length, legacyProductImageAssets(product).length, highestVersionedAngle);
      return Array.from({ length: galleryCount })
        .map((_, index) => plainImageAssetFor(product, index))
        .filter((asset) => asset?.publicUrl)
        .map((asset, index) => ({
          src: asset.publicUrl,
          alt: asset.fileName || product.name || product.sku || "",
          title: `PLAIN ${product.sku} มุมที่ ${fmtQty.format(index + 1)}`,
          caption: asset.fileName || product.name || "",
        }));
    }
    return ktwImagesFor(product)
      .filter((image) => image?.url)
      .map((image, index) => ({
        src: image.url,
        alt: image.alt || product.name || product.sku || "",
        title: `KTW ${product.sku} มุมที่ ${fmtQty.format(index + 1)}`,
        caption: image.alt || product.name || "",
      }));
  }

  function renderTableCoverImage(product) {
    const coverImage = tableCoverImageFor(product);
    if (!coverImage.src) {
      return `<span class="table-product-image-empty" data-image-mode="${escapeHtml(coverImage.mode)}" aria-label="ยังไม่มีรูปสินค้า Plain"></span>`;
    }
    return `
      <button class="table-product-image-button" type="button"
        data-open-gallery-sku="${escapeHtml(product.sku)}"
        data-open-gallery-mode="${escapeHtml(coverImage.mode)}"
        aria-label="ดูรูปสินค้า ${escapeHtml(product.sku)} แบบเต็มจอ">
        <img class="table-product-image" src="${escapeHtml(coverImage.src)}" alt="${escapeHtml(coverImage.alt)}" data-image-mode="${escapeHtml(coverImage.mode)}" loading="lazy" />
      </button>`;
  }

  function assetTarget(product, groupId) {
    if (groupId === "product_images") return Math.max(1, ktwImagesFor(product).length || 0);
    return groupId === "factory_files" ? 2 : 2;
  }

  function assetProgress(product, groupId) {
    const count = groupId === "product_images" ? plainProductImageCompletionCount(product) : assetsFor(product, groupId).length;
    const target = assetTarget(product, groupId);
    const tone = count >= target ? "green" : count > 0 ? "orange" : "red";
    return { count, target, tone };
  }

  function assetPill(product, groupId) {
    const progress = assetProgress(product, groupId);
    return `<span class="asset-pill ${progress.tone}">${fmtQty.format(progress.count)}/${fmtQty.format(progress.target)}</span>`;
  }

  function hasShippingMetrics(product) {
    return numberValue(product.widthCm) > 0 &&
      numberValue(product.lengthCm) > 0 &&
      numberValue(product.heightCm) > 0 &&
      numberValue(product.unitWeightKg) > 0;
  }

  function shippingMeasureSummary(product) {
    if (!hasShippingMetrics(product)) return "KTW ยังไม่มีข้อมูลขนาด/น้ำหนักสำหรับคำนวณค่าส่ง";
    return `ยาว ${fmtMeasure.format(product.lengthCm)} x กว้าง ${fmtMeasure.format(product.widthCm)} x สูง ${fmtMeasure.format(product.heightCm)} ซม. · ${fmtMeasure.format(product.unitWeightKg)} กก./ชิ้น`;
  }

  function sameMeasureValue(a, b) {
    return Math.abs(numberValue(a) - numberValue(b)) < 0.0001;
  }

  function usingKtwShippingMetrics(product) {
    const logistics = product.ktwLogistics;
    return Boolean(logistics) &&
      sameMeasureValue(product.widthCm, logistics.widthCm) &&
      sameMeasureValue(product.lengthCm, logistics.lengthCm) &&
      sameMeasureValue(product.heightCm, logistics.heightCm) &&
      sameMeasureValue(product.unitWeightKg, logistics.unitWeightKg);
  }

  function shippingMeasureTitle(product) {
    if (!product.ktwLogistics) return "ขนาด/น้ำหนักจาก KTW";
    return usingKtwShippingMetrics(product) ? "ขนาด/น้ำหนักจาก KTW" : "ขนาด/น้ำหนักที่ใช้คำนวณ";
  }

  function ktwLogisticsTimeLabel(product) {
    const capturedAt = product.ktwLogistics?.capturedAt;
    if (!capturedAt) return "";
    return new Date(capturedAt).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function renderKtwLogisticsStrip(product) {
    const hasMetrics = hasShippingMetrics(product);
    const timeLabel = ktwLogisticsTimeLabel(product);
    return `
      <div class="ktw-logistics-strip ${hasMetrics ? "" : "missing"}">
        <div>
          <strong>${escapeHtml(shippingMeasureTitle(product))}</strong>
          <span>${escapeHtml(shippingMeasureSummary(product))}</span>
          ${timeLabel ? `<small>อัปเดตจาก shop.ktw.co.th ${escapeHtml(timeLabel)}</small>` : ""}
        </div>
        <em>${hasMetrics ? (usingKtwShippingMetrics(product) ? "ใช้ค่า KTW" : "แก้ไขเอง") : "รอข้อมูลจาก KTW"}</em>
      </div>`;
  }

  function imagePreviewButton(src, alt, title, caption = "") {
    return `
      <button class="image-compare-image" type="button"
        data-open-image="${escapeHtml(src)}"
        data-image-title="${escapeHtml(title)}"
        data-image-caption="${escapeHtml(caption)}"
        aria-label="ดูรูป ${escapeHtml(title)}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />
      </button>`;
  }

  function renderRowPlainVersionControls(product) {
    const angleCount = Math.max(1, assetTarget(product, "product_images"));
    const selections = normalizePlainImageVersionSelections(product.plainImageVersionSelections);
    return `
      <div class="plain-row-version-controls" role="group" aria-label="Plain row image version ${escapeHtml(product.sku)}">
        <span>ทุกมุม</span>
        ${plainImageRowVersions(product).map((version) => {
          const active = Array.from({ length: angleCount })
            .every((_, index) => normalizePlainImageVersion(selections[index + 1] || 1) === version);
          return `
            <button class="plain-row-version-button ${active ? "active" : ""}" type="button"
              data-row-plain-version="${escapeHtml(product.sku)}"
              data-version="${escapeHtml(version)}"
              aria-pressed="${active ? "true" : "false"}"
              title="เปลี่ยนรูป PLAIN ทุกมุมเป็น V${escapeHtml(plainVersionLabel(version))}">
              V${escapeHtml(plainVersionLabel(version))}
            </button>`;
        }).join("")}
      </div>`;
  }

  function renderPlainImageVersionControls(product, index) {
    const angleIndex = normalizePlainImageAngleIndex(index + 1);
    const selectedVersion = plainImageVersionSelection(product, index);
    return `
      <div class="plain-image-version-selector" role="group" aria-label="Plain image version angle ${fmtQty.format(angleIndex)}">
        ${plainImageVersions(product, index).map((version) => {
          const asset = plainImageAssetFor(product, index, version);
          const active = version === selectedVersion;
          return `
            <button class="plain-image-version-button ${active ? "active" : ""} ${asset ? "has-file" : "missing-file"}" type="button"
              data-plain-image-version="${escapeHtml(product.sku)}"
              data-angle-index="${escapeHtml(angleIndex)}"
              data-version="${escapeHtml(version)}"
              aria-pressed="${active ? "true" : "false"}"
              title="PLAIN angle ${fmtQty.format(angleIndex)} version ${escapeHtml(plainVersionLabel(version))}">
              V${escapeHtml(plainVersionLabel(version))}
            </button>`;
        }).join("")}
        <label class="plain-version-upload" title="Upload PLAIN image for selected version">
          +
          <input type="file" accept="image/*"
            data-plain-image-version-upload="${escapeHtml(product.sku)}"
            data-angle-index="${escapeHtml(angleIndex)}"
            data-version="${escapeHtml(selectedVersion)}" />
        </label>
      </div>`;
  }

  function renderAiImageCommand(product, index, selectedVersion) {
    const angleIndex = normalizePlainImageAngleIndex(index + 1);
    const versionLabel = plainVersionLabel(selectedVersion);
    const requestKey = aiImageRequestKey(product.sku, angleIndex, selectedVersion);
    const busy = state.aiImageRequests.has(requestKey);
    const referenceImages = state.aiImageReferenceUploads.get(requestKey) || [];
    return `
      <div class="ai-image-command ${busy ? "working" : ""}">
        <textarea data-ai-image-command="${escapeHtml(product.sku)}"
          data-angle-index="${escapeHtml(angleIndex)}"
          data-version="${escapeHtml(selectedVersion)}"
          rows="2"
          placeholder="สั่ง AI แก้ V${escapeHtml(versionLabel)}..."></textarea>
        <div class="ai-reference-tools">
          <label class="ai-reference-picker" title="แนบรูปอ้างอิงให้ AI">
            <span>แนบรูปอ้างอิง</span>
            <input type="file" accept="image/*" multiple
              data-ai-image-reference-upload="${escapeHtml(product.sku)}"
              data-angle-index="${escapeHtml(angleIndex)}"
              data-version="${escapeHtml(selectedVersion)}" />
          </label>
          ${referenceImages.length ? `<button class="ghost-button ai-reference-clear" type="button"
            data-ai-image-reference-clear="${escapeHtml(product.sku)}"
            data-angle-index="${escapeHtml(angleIndex)}"
            data-version="${escapeHtml(selectedVersion)}">ล้าง</button>` : ""}
        </div>
        ${renderAiReferenceSummary(state.aiImageReferenceUploads.get(requestKey))}
        <button type="button"
          data-ai-image-submit="${escapeHtml(product.sku)}"
          data-angle-index="${escapeHtml(angleIndex)}"
          data-version="${escapeHtml(selectedVersion)}"
          ${busy ? "disabled" : ""}>
          <span class="ai-image-spinner" aria-hidden="true"></span>
          <span>${busy ? "กำลังออกแบบ" : "สั่ง AI"}</span>
        </button>
      </div>`;
  }

  function renderPlainImagePane(product, index) {
    const selectedVersion = plainImageVersionSelection(product, index);
    const asset = plainImageAssetFor(product, index, selectedVersion);
    const versionControls = renderPlainImageVersionControls(product, index);
    if (!asset) {
      return `
        <div class="plain-image-preview">
          <div class="image-compare-empty">
            <strong>รอรูป PLAIN V${escapeHtml(plainVersionLabel(selectedVersion))}</strong>
            <span>มุมที่ ${fmtQty.format(index + 1)}</span>
          </div>
          ${versionControls}
          ${renderAiImageCommand(product, index, selectedVersion)}
        </div>`;
    }
    return `
      <div class="plain-image-preview">
        ${imagePreviewButton(asset.publicUrl, asset.fileName, `PLAIN มุมที่ ${fmtQty.format(index + 1)} V${plainVersionLabel(selectedVersion)}`, asset.fileName)}
        ${versionControls}
        ${renderAiImageCommand(product, index, selectedVersion)}
        <button class="image-delete-button" type="button" data-delete-asset="${escapeHtml(asset.id)}" aria-label="ลบรูป PLAIN ${escapeHtml(asset.fileName)}">ลบรูป PLAIN</button>
      </div>`;
  }

  function renderImageComparison(product) {
    const ktwImages = ktwImagesFor(product);
    const progress = assetProgress(product, "product_images");
    const pairs = ktwImages.map((ktwImage, index) => ({ ktwImage, plainImage: plainImageAssetFor(product, index) }));
    const extraPlain = legacyProductImageAssets(product).slice(ktwImages.length);
    return `
      <section class="image-compare-card" id="image-compare">
        <div class="mini-heading">
          <div>
            <h3>เทียบรูป KTW ↔ PLAIN</h3>
            <span>ต้องอัปโหลดรูป PLAIN ให้ครบทุกมุมตามรูปสินค้า KTW และเรียงลำดับเดียวกัน</span>
          </div>
          <strong class="compare-count ${progress.tone}">${fmtQty.format(progress.count)}/${fmtQty.format(progress.target)} มุม</strong>
        </div>
        <div class="image-compare-grid">
          ${pairs.map(({ ktwImage, plainImage }, index) => `
            <article class="image-compare-pair ${plainImage ? "matched" : "missing"}">
              <div class="compare-pair-head">
                <strong>มุมที่ ${fmtQty.format(index + 1)}</strong>
                <span>${plainImage ? "จับคู่แล้ว" : "ยังขาดรูป PLAIN"}</span>
              </div>
              <div class="compare-columns">
                <div class="compare-pane">
                  <span>KTW</span>
                  ${imagePreviewButton(ktwImage.url, ktwImage.alt || product.name, `KTW มุมที่ ${fmtQty.format(index + 1)}`, ktwImage.alt || product.name)}
                </div>
                <div class="compare-pane">
                  <span>PLAIN</span>
                  ${renderPlainImagePane(product, index)}
                </div>
              </div>
            </article>`).join("")}
          ${extraPlain.map((asset, index) => `
            <article class="image-compare-pair extra">
              <div class="compare-pair-head">
                <strong>รูป PLAIN เพิ่มเติม ${fmtQty.format(index + 1)}</strong>
                <span>เกินจำนวนมุม KTW</span>
              </div>
              <div class="compare-columns single">
                <div class="compare-pane">
                  <span>PLAIN</span>
                  ${renderPlainImagePane(asset, ktwImages.length + index)}
                </div>
              </div>
            </article>`).join("")}
        </div>
      </section>`;
  }

  function normalizeProductTableMode(mode) {
    return ["accounting", "designer", "combined"].includes(mode) ? mode : "combined";
  }

  function productTableColspan(mode = state.productTableMode) {
    const normalized = normalizeProductTableMode(mode);
    if (normalized === "accounting") return 10;
    if (normalized === "designer") return 7;
    return 12;
  }

  function renderProductTableModeToggle() {
    const toggle = $("productTableModeToggle");
    if (!toggle) return;
    state.productTableMode = normalizeProductTableMode(state.productTableMode);
    toggle.querySelectorAll("[data-product-table-mode]").forEach((button) => {
      const active = button.dataset.productTableMode === state.productTableMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderProductTableHead() {
    const header = document.querySelector(".product-table thead tr");
    if (!header) return;
    const selectHeader = `
      <th class="bulk-select-col">
        <input class="bulk-checkbox" data-bulk-status-toggle-all type="checkbox" aria-label="เลือกสินค้าทั้งหมดในตาราง" />
      </th>`;
    const mode = normalizeProductTableMode(state.productTableMode);
    if (mode === "accounting") {
      header.innerHTML = `
        ${selectHeader}
        <th>รูปสินค้า</th>
        <th>สินค้า</th>
        <th class="num">ราคาขาย</th>
        <th class="num">ต้นทุนสินค้า</th>
        <th class="num">ต้นทุนขนส่ง</th>
        <th class="num">กำไร</th>
        <th class="num">จำนวนสั่งซื้อ</th>
        <th class="num">ยอดขายรวม</th>
        <th class="num">กำไรรวม</th>`;
      return;
    }
    if (mode === "designer") {
      header.innerHTML = `
        ${selectHeader}
        <th>สินค้า</th>
        <th>เทียบรูป KTW ↔ PLAIN</th>
        <th>สถานะรีดีไซน์</th>
        <th class="num">รูปสินค้า</th>
        <th class="num">รูปแพคเกจจิ้ง</th>
        <th class="num">ไฟล์โรงงาน</th>`;
      return;
    }
    header.innerHTML = `
      ${selectHeader}
      <th>รูปสินค้า</th>
      <th>ชื่อสินค้า</th>
      <th class="num">ราคา KTW</th>
      <th class="num">ต้นทุนสินค้า</th>
      <th class="num">ต้นทุนขนส่ง</th>
      <th class="num">กำไร</th>
      <th class="num">จำนวนสั่งซื้อ</th>
      <th>สถานะรีดีไซน์</th>
      <th class="num">รูปสินค้า</th>
      <th class="num">รูปแพคเกจจิ้ง</th>
      <th class="num">ไฟล์โรงงาน</th>`;
  }

  function trackerCostInputValue(calc) {
    return calc.purchaseUnitCostUsd > 0 ? String(calc.purchaseUnitCostUsd) : "";
  }

  function filteredProducts() {
    const q = state.query.trim().toLowerCase();
    return state.products.filter((product) => {
      const text = `${product.sku} ${product.name}`.toLowerCase();
      return (!q || text.includes(q)) &&
        (state.category === "all" || product.category === state.category) &&
        (state.status === "all" || product.status === state.status);
    });
  }

  function statusOptionExists(status) {
    return state.statusOptions.some((item) => item.id === status);
  }

  function pruneBulkStatusSelection(rows) {
    const visibleSkus = new Set(rows.map((product) => product.sku));
    state.bulkStatusSelectedSkus = new Set([...state.bulkStatusSelectedSkus].filter((sku) => visibleSkus.has(sku)));
  }

  function canStartBulkAiDesign() {
    return (
      normalizeProductTableMode(state.productTableMode) === "designer" &&
      state.bulkStatusSelectedSkus.size > 0 &&
      Boolean(String(state.bulkAiPrompt || "").trim()) &&
      !state.bulkAiRequest?.running
    );
  }

  function refreshBulkAiDesignStartButton() {
    const button = document.querySelector("[data-bulk-ai-design-start]");
    if (button) button.disabled = !canStartBulkAiDesign();
  }

  function renderBulkStatusBar(rows = filteredProducts()) {
    const bar = $("bulkStatusBar");
    if (!bar) return;
    if (state.bulkStatusTarget && !statusOptionExists(state.bulkStatusTarget)) {
      state.bulkStatusTarget = "";
    }
    const selectedCount = state.bulkStatusSelectedSkus.size;
    const canApply = selectedCount > 0 && statusOptionExists(state.bulkStatusTarget);
    const isDesignerMode = normalizeProductTableMode(state.productTableMode) === "designer";
    const aiTargets = isDesignerMode && selectedCount ? bulkAiDesignTargets() : [];
    const aiBusy = Boolean(state.bulkAiRequest?.running);
    const aiProgress = state.bulkAiRequest
      ? `${fmtQty.format(state.bulkAiRequest.done)}/${fmtQty.format(state.bulkAiRequest.total)} รูป${state.bulkAiRequest.failed ? ` · พลาด ${fmtQty.format(state.bulkAiRequest.failed)}` : ""}`
      : `${fmtQty.format(aiTargets.length)} รูปจาก ${fmtQty.format(selectedCount)} SKU`;
    bar.innerHTML = `
      <div class="bulk-status-summary">
        <strong>${selectedCount ? `เลือก ${fmtQty.format(selectedCount)} SKU` : "ยังไม่ได้เลือก SKU"}</strong>
        <span>เลือกจาก checkbox ในตาราง หรือเลือกทั้งหมด ${fmtQty.format(rows.length)} รายการที่กรองอยู่</span>
      </div>
      <div class="bulk-status-actions">
        <label>
          <span>สถานะใหม่</span>
          <select data-bulk-status-select>
            <option value="">เลือกสถานะ</option>
            ${state.statusOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.bulkStatusTarget ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <button class="secondary-button" data-bulk-status-apply type="button" ${canApply ? "" : "disabled"}>ใช้กับที่เลือก</button>
        <button class="danger-button" data-bulk-cost-clear type="button" ${selectedCount ? "" : "disabled"}>ลบราคาต้นทุน</button>
        <button class="ghost-button" data-bulk-status-clear type="button" ${selectedCount ? "" : "disabled"}>ล้างที่เลือก</button>
      </div>
      ${isDesignerMode ? `
        <div class="bulk-ai-design ${aiBusy ? "working" : ""}">
          <div>
            <strong>AI Bulk Design</strong>
            <span>${escapeHtml(aiProgress)}</span>
          </div>
          <textarea data-bulk-ai-prompt rows="2" placeholder="พิมพ์คำสั่งออกแบบสำหรับสินค้า PLAIN ที่เลือก...">${escapeHtml(state.bulkAiPrompt)}</textarea>
          <div class="bulk-ai-reference-tools">
            <label class="ai-reference-picker" title="แนบรูปอ้างอิงให้ AI Bulk">
              <span>แนบรูปอ้างอิง</span>
              <input type="file" accept="image/*" multiple data-bulk-ai-reference-upload />
            </label>
            ${state.bulkAiReferenceImages.length ? `<button class="ghost-button ai-reference-clear" data-bulk-ai-reference-clear type="button">ล้าง</button>` : ""}
            ${renderAiReferenceSummary(state.bulkAiReferenceImages)}
          </div>
          <button class="secondary-button" data-bulk-ai-design-start type="button" ${canStartBulkAiDesign() ? "" : "disabled"}>
            <span class="bulk-ai-spinner" aria-hidden="true"></span>
            <span>${aiBusy ? "กำลังออกแบบ Bulk" : "สั่ง AI Bulk"}</span>
          </button>
          ${state.bulkAiRequest?.current ? `<small>กำลังทำ: ${escapeHtml(state.bulkAiRequest.current)}</small>` : ""}
        </div>` : ""}`;
  }

  function renderProductImageModeToggle() {
    const toggle = $("productImageModeToggle");
    if (!toggle) return;
    if (state.productImageMode !== "plain") state.productImageMode = "ktw";
    toggle.hidden = normalizeProductTableMode(state.productTableMode) !== "combined";
    toggle.querySelectorAll("[data-product-image-mode]").forEach((button) => {
      const active = button.dataset.productImageMode === state.productImageMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderDetailPanelShell() {
    const grid = $("plainMainGrid");
    const detail = $("design");
    const expandButton = $("detailPanelExpandButton");
    const collapsed = Boolean(state.detailPanelCollapsed);
    grid?.classList.toggle("detail-collapsed", collapsed);
    detail?.setAttribute("aria-hidden", collapsed ? "true" : "false");
    if (expandButton) {
      expandButton.hidden = !collapsed;
      expandButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  function setDetailPanelCollapsed(collapsed) {
    state.detailPanelCollapsed = Boolean(collapsed);
    localStorage.setItem("plainDetailPanelCollapsed", state.detailPanelCollapsed ? "1" : "0");
    renderDetailPanelShell();
    if (!state.detailPanelCollapsed) {
      renderDesignDetail();
      $("design")?.scrollIntoView({ block: "nearest" });
    }
  }

  function syncBulkStatusMaster(rows = filteredProducts()) {
    const toggle = document.querySelector("[data-bulk-status-toggle-all]");
    if (!toggle) return;
    const visibleSkus = rows.map((product) => product.sku);
    const selectedVisibleCount = visibleSkus.filter((sku) => state.bulkStatusSelectedSkus.has(sku)).length;
    toggle.checked = visibleSkus.length > 0 && selectedVisibleCount === visibleSkus.length;
    toggle.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleSkus.length;
    toggle.disabled = visibleSkus.length === 0;
  }

  function setBulkStatusSelection(sku, selected) {
    if (!state.products.some((product) => product.sku === sku)) return;
    if (selected) state.bulkStatusSelectedSkus.add(sku);
    else state.bulkStatusSelectedSkus.delete(sku);
    const rows = filteredProducts();
    renderBulkStatusBar(rows);
    syncBulkStatusMaster(rows);
  }

  function setBulkStatusSelectionForRows(rows, selected) {
    rows.forEach((product) => {
      if (selected) state.bulkStatusSelectedSkus.add(product.sku);
      else state.bulkStatusSelectedSkus.delete(product.sku);
    });
    renderTrackerTable();
  }

  function renderFilters() {
    $("categoryFilter").innerHTML = state.categoryOptions
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
      .join("");
    $("categoryFilter").value = state.category;

    $("statusFilter").innerHTML = [
      `<option value="all">ทุกสถานะ</option>`,
      ...state.statusOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`),
    ].join("");
    $("statusFilter").value = state.status;
  }

  function renderStats() {
    const bill = billCalc();
    const ready = state.products.filter((product) => product.status === "passed").length;
    const linked = state.products.filter((product) => product.packhai?.matched).length;
    $("linkedCount").textContent = `${linked}/${state.products.length} SKU matched`;
    $("summary").innerHTML = [
      ["SKU", `${fmtQty.format(state.products.length)} รายการ`],
      ["จำนวนสั่งรวม", `${fmtQty.format(bill.qty)} ชิ้น`],
      ["ยอดสั่งซื้อทั้งบิล", fmtMoney.format(bill.totalCost)],
      ["ยอดขายคาดการณ์", fmtMoney.format(bill.revenueTotal)],
      ["กำไรรวมทั้งบิล", fmtMoney.format(bill.profitTotal)],
      ["ผ่าน", `${fmtQty.format(ready)} SKU`],
    ]
      .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`)
      .join("");
  }

  function renderTable() {
    const rows = filteredProducts();
    $("tableSubtitle").textContent = `${fmtQty.format(rows.length)} จาก ${fmtQty.format(state.products.length)} SKU`;
    $("productRows").innerHTML = rows.length
      ? rows.map((product) => {
          const done = completion(product);
          const status = statusMeta(product.status);
          const calc = lineCalc(product);
          return `
            <tr class="${product.sku === state.selectedSku ? "selected" : ""}" data-sku="${escapeHtml(product.sku)}">
              <td>
                <div class="product-cell">
                  <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />
                  <div>
                    <strong>${escapeHtml(product.sku)}</strong>
                    <span>${escapeHtml(product.name)}</span>
                    <em>${escapeHtml(categoryLabel(product.category))}</em>
                  </div>
                </div>
              </td>
              <td class="num">
                <strong>${fmtUsd.format(calc.purchaseUnitCostUsd)}</strong>
                <small>${fmtMoney.format(calc.purchaseUnitCost)} · ขาย ${fmtMoney.format(calc.saleUnitPrice)}</small>
              </td>
              <td class="num">
                <strong>${fmtMoney.format(calc.shippingUnit)}</strong>
                <small>${calc.chargeBasis} · ${escapeHtml(calc.rate.modeLabel)}</small>
              </td>
              <td class="num ${calc.profitUnit < 0 ? "danger-text" : "good-text"}">
                <strong>${fmtMoney.format(calc.profitUnit)}</strong>
                <small>${fmtMoney.format(calc.profitTotal)} รวม</small>
              </td>
              <td class="num">${fmtQty.format(calc.qty)}</td>
              <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
              <td>
                <div class="completion"><span style="width:${done.percent}%"></span></div>
                <small>${done.completed}/${done.total}</small>
              </td>
            </tr>`;
        }).join("")
      : `<tr><td class="empty-state" colspan="7">ไม่พบสินค้า</td></tr>`;
  }

  function renderBulkSelectionCell(product, index, checked) {
    return `
      <td class="row-index">
        <label class="bulk-row-check">
          <input class="bulk-checkbox" data-bulk-status-row="${escapeHtml(product.sku)}" type="checkbox" ${checked} aria-label="เลือก ${escapeHtml(product.sku)}" />
          <span>${fmtQty.format(index + 1)}</span>
        </label>
      </td>`;
  }

  function renderProductImagePairs(product) {
    const ktwImages = ktwImagesFor(product);
    const plainImages = assetsFor(product, "product_images");
    const highestVersionedAngle = Math.max(0, ...plainImages.map(assetAngleIndex));
    const pairCount = Math.max(1, ktwImages.length, legacyProductImageAssets(product).length, highestVersionedAngle);
    return `
      <div class="product-image-pairs">
        ${Array.from({ length: pairCount }).map((_, index) => {
          const ktwImage = ktwImages[index] || ktwImages[0] || {};
          const plainImage = plainImageAssetFor(product, index);
          return `
            <article class="product-image-pair ${plainImage ? "matched" : "missing"}">
              <strong>มุม ${fmtQty.format(index + 1)}</strong>
              <div class="product-image-pair-columns">
                <div>
                  <span>KTW</span>
                  ${ktwImage.url
                    ? imagePreviewButton(ktwImage.url, ktwImage.alt || product.name, `KTW มุม ${fmtQty.format(index + 1)}`, ktwImage.alt || product.name)
                    : `<div class="product-image-missing">ไม่มีรูป KTW</div>`}
                </div>
                <div>
                  <span>PLAIN</span>
                  ${plainImage?.publicUrl
                    ? imagePreviewButton(plainImage.publicUrl, plainImage.fileName, `PLAIN มุม ${fmtQty.format(index + 1)}`, plainImage.fileName)
                    : `<div class="product-image-missing"><b>รอรูป PLAIN</b><em>${fmtQty.format(index + 1)}</em></div>`}
                  ${renderPlainImageVersionControls(product, index)}
                </div>
              </div>
            </article>`;
        }).join("")}
      </div>`;
  }

  function renderAccountingProductRow(product, index) {
    const calc = lineCalc(product);
    const bulkChecked = state.bulkStatusSelectedSkus.has(product.sku) ? "checked" : "";
    return `
      <tr class="${product.sku === state.selectedSku ? "selected" : ""}" data-sku="${escapeHtml(product.sku)}">
        ${renderBulkSelectionCell(product, index, bulkChecked)}
        <td class="product-image-cell">
          ${renderTableCoverImage(product)}
        </td>
        <td>
          <span class="table-product-name">${escapeHtml(product.name)}</span>
          <small class="table-product-sku">SKU ${escapeHtml(product.sku)}</small>
        </td>
        <td class="num"><strong>${fmtMoney.format(calc.saleUnitPrice)}</strong><small>ราคา Plain</small></td>
        <td class="num">
          <label class="table-cost-editor">
            <span class="table-cost-input-wrap">
              <span class="table-cost-currency" aria-hidden="true">$</span>
              <input class="table-cost-input" data-table-usd="${escapeHtml(product.sku)}" type="number" min="0" step="0.0001" inputmode="decimal" value="${escapeHtml(trackerCostInputValue(calc))}" placeholder="0.0000" aria-label="ต้นทุนสินค้า USD ${escapeHtml(product.sku)}" />
            </span>
            <small data-table-cell="purchaseUnitCost">${fmtMoney.format(calc.purchaseUnitCost)}</small>
          </label>
        </td>
        <td class="num" data-table-cell="shippingUnit">
          <strong>${fmtMoney.format(calc.shippingUnit)}</strong>
          <small>${fmtMoney.format(calc.shippingTotal)} รวม</small>
        </td>
        <td class="num ${calc.profitUnit < 0 ? "danger-text" : "good-text"}" data-table-cell="profitUnit">
          <strong>${fmtMoney.format(calc.profitUnit)}</strong>
          <small>${fmtMoney.format(calc.profitTotal)} รวม</small>
        </td>
        <td class="num"><strong>${fmtQty.format(calc.qty)}</strong><small>ใบ</small></td>
        <td class="num"><strong>${fmtMoney.format(calc.revenueTotal)}</strong></td>
        <td class="num ${calc.profitTotal < 0 ? "danger-text" : "good-text"}"><strong>${fmtMoney.format(calc.profitTotal)}</strong></td>
      </tr>`;
  }

  function renderDesignerProductRow(product, index) {
    const status = statusMeta(product.status);
    const bulkChecked = state.bulkStatusSelectedSkus.has(product.sku) ? "checked" : "";
    return `
      <tr class="designer-product-row ${product.sku === state.selectedSku ? "selected" : ""}" data-sku="${escapeHtml(product.sku)}">
        ${renderBulkSelectionCell(product, index, bulkChecked)}
        <td>
          <span class="table-product-name">${escapeHtml(product.name)}</span>
          <small class="table-product-sku">SKU ${escapeHtml(product.sku)}</small>
          <small class="table-product-meta">${escapeHtml(categoryLabel(product.category))}</small>
          <div class="designer-row-version-slot">${renderRowPlainVersionControls(product)}</div>
        </td>
        <td class="image-pairs-cell">${renderProductImagePairs(product)}</td>
        <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
        <td class="num">${assetPill(product, "product_images")}</td>
        <td class="num">${assetPill(product, "packaging_images")}</td>
        <td class="num">${assetPill(product, "factory_files")}</td>
      </tr>`;
  }

  function renderCombinedProductRow(product, index) {
    const status = statusMeta(product.status);
    const calc = lineCalc(product);
    const bulkChecked = state.bulkStatusSelectedSkus.has(product.sku) ? "checked" : "";
    return `
      <tr class="${product.sku === state.selectedSku ? "selected" : ""}" data-sku="${escapeHtml(product.sku)}">
        ${renderBulkSelectionCell(product, index, bulkChecked)}
        <td class="product-image-cell">
          ${renderTableCoverImage(product)}
        </td>
        <td>
          <span class="table-product-name">${escapeHtml(product.name)}</span>
          <small class="table-product-sku">SKU ${escapeHtml(product.sku)}</small>
          <small class="table-product-meta">${escapeHtml(categoryLabel(product.category))} · ${fmtUsd.format(calc.purchaseUnitCostUsd)} / ${fmtMoney.format(calc.purchaseUnitCost)}</small>
        </td>
        <td class="num"><strong>${fmtMoney.format(product.ktwPrice || 0)}</strong></td>
        <td class="num">
          <label class="table-cost-editor">
            <span class="table-cost-input-wrap">
              <span class="table-cost-currency" aria-hidden="true">$</span>
              <input class="table-cost-input" data-table-usd="${escapeHtml(product.sku)}" type="number" min="0" step="0.0001" inputmode="decimal" value="${escapeHtml(trackerCostInputValue(calc))}" placeholder="0.0000" aria-label="ต้นทุนสินค้า USD ${escapeHtml(product.sku)}" />
            </span>
            <small data-table-cell="purchaseUnitCost">${fmtMoney.format(calc.purchaseUnitCost)}</small>
          </label>
        </td>
        <td class="num" data-table-cell="shippingUnit">
          <strong>${fmtMoney.format(calc.shippingUnit)}</strong>
          <small>${fmtMoney.format(calc.shippingTotal)} รวม</small>
        </td>
        <td class="num ${calc.profitUnit < 0 ? "danger-text" : "good-text"}" data-table-cell="profitUnit">
          <strong>${fmtMoney.format(calc.profitUnit)}</strong>
          <small>${fmtMoney.format(calc.profitTotal)} รวม</small>
        </td>
        <td class="num"><strong>${fmtQty.format(calc.qty)}</strong><small>ใบ</small></td>
        <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
        <td class="num">${assetPill(product, "product_images")}</td>
        <td class="num">${assetPill(product, "packaging_images")}</td>
        <td class="num">${assetPill(product, "factory_files")}</td>
      </tr>`;
  }

  function renderTrackerTable() {
    const rows = filteredProducts();
    const mode = normalizeProductTableMode(state.productTableMode);
    state.productTableMode = mode;
    const table = document.querySelector(".product-table");
    if (table) {
      table.classList.remove("accounting-mode", "designer-mode", "combined-mode");
      table.classList.add(`${mode}-mode`);
    }
    pruneBulkStatusSelection(rows);
    renderProductTableHead();
    renderBulkStatusBar(rows);
    $("tableSubtitle").textContent = `รวม ${fmtQty.format(rows.length)} จาก ${fmtQty.format(state.products.length)} รายการ`;
    const renderRow = mode === "accounting"
      ? renderAccountingProductRow
      : mode === "designer"
        ? renderDesignerProductRow
        : renderCombinedProductRow;
    $("productRows").innerHTML = rows.length
      ? rows.map((product, index) => renderRow(product, index)).join("")
      : `<tr><td class="empty-state" colspan="${productTableColspan(mode)}">ไม่พบสินค้า</td></tr>`;
    syncBulkStatusMaster(rows);
  }

  function fileSize(value) {
    const size = Number(value || 0);
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fieldValue(product, field) {
    return Number.isFinite(Number(product[field])) ? String(product[field]) : "";
  }

  function renderDetail() {
    const product = selectedProduct();
    if (!product) {
      $("design").innerHTML = `<div class="empty-state">เลือกสินค้าเพื่อดูรายละเอียด</div>`;
      return;
    }
    const status = statusMeta(product.status);
    const packhai = product.packhai || {};
    const calc = lineCalc(product);
    $("design").innerHTML = `
      <div class="detail-header">
        <span>${escapeHtml(product.sku)}</span>
        <h2>${escapeHtml(product.name)}</h2>
      </div>
      <div class="source-card">
        <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" />
        <div>
          <span>ราคา KTW</span>
          <strong>${fmtMoney.format(product.ktwPrice || 0)}</strong>
          <small>จำนวนสั่ง ${fmtQty.format(product.orderQuantity || 0)} ชิ้น</small>
          <a href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noreferrer">เปิดหน้า KTW</a>
        </div>
      </div>
      <div class="packhai-card">
        <div>
          <span>Packhai Stock Link</span>
          <strong>${packhai.matched ? `${fmtQty.format(packhai.quantity || 0)} ชิ้น` : "ไม่พบ SKU"}</strong>
          <small>${packhai.matched ? `${fmtQty.format(packhai.stockRows || 0)} แถวคลัง · ${fmtMoney.format(packhai.inventoryValue || 0)}` : "พร้อมเชื่อมเมื่อ Packhai มี SKU นี้"}</small>
          <a href="${escapeHtml(packhai.url || `../#inventory-detail?sku=${encodeURIComponent(product.sku)}`)}">ค้นใน Packhai</a>
        </div>
      </div>
      <section class="calc-card" id="itemCalculator">
        <div class="mini-heading">
          <div>
            <h3>คำนวณรายชิ้น</h3>
            <span>ต้นทุน USD แปลงเป็นบาทด้วยเรต Google Finance แล้วคำนวณต่อกับ Momocargo</span>
          </div>
          <button class="ghost-button" id="saveCommercial" type="button">บันทึกตัวเลข</button>
        </div>
        ${renderExchangeCard("compact")}
        <div class="calc-grid">
          ${numberInput("orderQuantity", "จำนวนสั่ง", fieldValue(product, "orderQuantity"), "1")}
          ${numberInput("purchaseUnitCostUsd", "ต้นทุน USD/ชิ้น", displayPurchaseUnitCostUsd(product), "0.0001")}
          ${numberInput("saleUnitPrice", "ราคาขาย/ชิ้น", fieldValue(product, "saleUnitPrice"), "0.01")}
          ${numberInput("packagingUnitCost", "แพคเกจ/ชิ้น", fieldValue(product, "packagingUnitCost"), "0.01")}
          ${numberInput("otherUnitCost", "ค่าอื่น/ชิ้น", fieldValue(product, "otherUnitCost"), "0.01")}
          <label class="field">
            <span>ขนส่ง</span>
            <select id="cargoMode">
              <option value="truck" ${product.cargoMode === "truck" ? "selected" : ""}>ทางรถ</option>
              <option value="sea" ${product.cargoMode === "sea" ? "selected" : ""}>ทางเรือ</option>
            </select>
          </label>
          <label class="field">
            <span>ประเภทสินค้า</span>
            <select id="cargoType">
              ${["A", "M", "O", "X", "Z"].map((type) => {
                const mode = MOMO_RATES[product.cargoMode] ? product.cargoMode : "truck";
                return `<option value="${type}" ${product.cargoType === type ? "selected" : ""}>${escapeHtml(MOMO_RATES[mode][type].label)}</option>`;
              }).join("")}
            </select>
          </label>
          ${numberInput("widthCm", "กว้าง/ชิ้น (ซม.)", fieldValue(product, "widthCm"), "0.01")}
          ${numberInput("lengthCm", "ยาว/ชิ้น (ซม.)", fieldValue(product, "lengthCm"), "0.01")}
          ${numberInput("heightCm", "สูง/ชิ้น (ซม.)", fieldValue(product, "heightCm"), "0.01")}
          ${numberInput("unitWeightKg", "น้ำหนัก/ชิ้น (กก.)", fieldValue(product, "unitWeightKg"), "0.01")}
        </div>
        <div class="calc-result" id="itemCalcResult">
          ${renderCalcResult(calc)}
        </div>
      </section>
      <label class="field">
        <span>สถานะงาน</span>
        <select id="detailStatus">
          ${state.statusOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === product.status ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>หมายเหตุทีม/โรงงาน</span>
        <textarea id="detailNotes" rows="4">${escapeHtml(product.notes || "")}</textarea>
      </label>
      <button class="ghost-button" id="saveNotes" type="button">บันทึกหมายเหตุ</button>
      <div class="upload-stack" id="factory">
        ${state.assetGroups.map((group) => renderDesignUploadGroup(product, group)).join("")}
      </div>`;
    bindDetailEvents(product);
  }

  function renderDesignDetail() {
    const product = selectedProduct();
    if (!product) {
      $("design").innerHTML = `<div class="empty-state">เลือกสินค้าเพื่อดูรายละเอียด</div>`;
      return;
    }
    const status = statusMeta(product.status);
    const packhai = product.packhai || {};
    const calc = lineCalc(product);
    $("design").innerHTML = `
      <div class="detail-toolbar">
        <strong>รายละเอียดสินค้า</strong>
        <div class="detail-toolbar-actions">
          <span>${escapeHtml(status.label)}</span>
          <button class="detail-panel-collapse-button" data-detail-panel-collapse type="button" aria-controls="design" aria-expanded="true">ซ่อน</button>
        </div>
      </div>
      <section class="detail-product-card">
        <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" />
        <div>
          <span>SKU</span>
          <div class="detail-sku-line">
            <strong>${escapeHtml(product.sku)}</strong>
            <a class="detail-ktw-source-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noreferrer">ดูต้นฉบับจาก KTW</a>
          </div>
          <span>ชื่อสินค้า</span>
          <p>${escapeHtml(product.name)}</p>
        </div>
      </section>
      <section class="detail-kpis">
        <article>
          <span>ราคา KTW</span>
          <strong>${fmtMoney.format(product.ktwPrice || 0)}</strong>
        </article>
        <article>
          <span>จำนวนสั่งซื้อ</span>
          <strong>${fmtQty.format(product.orderQuantity || 0)} ใบ</strong>
        </article>
        <label class="field">
          <span>สถานะรีดีไซน์</span>
          <select id="detailStatus">
            ${state.statusOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === product.status ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
      </section>
      ${renderImageComparison(product)}
      <div class="upload-stack" id="factory">
        ${state.assetGroups.map((group) => renderDesignUploadGroup(product, group)).join("")}
      </div>
      <section class="source-card ktw-reference">
        <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" />
        <div>
          <span>ข้อมูลอ้างอิงจาก KTW</span>
          <strong>${fmtMoney.format(product.ktwPrice || 0)}</strong>
          <small>จำนวนสั่งซื้อ ${fmtQty.format(product.orderQuantity || 0)} ใบ</small>
          <small>${escapeHtml(shippingMeasureSummary(product))}</small>
        </div>
      </section>
      <section class="packhai-card">
        <div>
          <span>Packhai Stock Link</span>
          <strong>${packhai.matched ? `${fmtQty.format(packhai.quantity || 0)} ชิ้น` : "ไม่พบ SKU"}</strong>
          <small>${packhai.matched ? `${fmtQty.format(packhai.stockRows || 0)} แถวคลัง · ${fmtMoney.format(packhai.inventoryValue || 0)}` : "พร้อมเชื่อมเมื่อ Packhai มี SKU นี้"}</small>
          <a href="${escapeHtml(packhai.url || `../#inventory-detail?sku=${encodeURIComponent(product.sku)}`)}">ค้นใน Packhai</a>
        </div>
      </section>
      <section class="calc-card" id="itemCalculator">
        <div class="mini-heading">
          <div>
            <h3>คำนวณต้นทุนรายชิ้น</h3>
            <span>ต้นทุน USD แปลงเป็นบาทด้วยเรต Google Finance</span>
          </div>
          <button class="ghost-button" id="saveCommercial" type="button">บันทึก</button>
        </div>
        ${renderExchangeCard("compact")}
        ${renderKtwLogisticsStrip(product)}
        <div class="calc-grid">
          ${numberInput("orderQuantity", "จำนวนสั่ง", fieldValue(product, "orderQuantity"), "1")}
          ${numberInput("purchaseUnitCostUsd", "ต้นทุน USD/ชิ้น", displayPurchaseUnitCostUsd(product), "0.0001")}
          ${numberInput("saleUnitPrice", "ราคาขาย/ชิ้น", fieldValue(product, "saleUnitPrice"), "0.01")}
          ${numberInput("packagingUnitCost", "แพคเกจ/ชิ้น", fieldValue(product, "packagingUnitCost"), "0.01")}
          ${numberInput("otherUnitCost", "ค่าอื่น/ชิ้น", fieldValue(product, "otherUnitCost"), "0.01")}
          <label class="field">
            <span>ขนส่ง</span>
            <select id="cargoMode">
              <option value="truck" ${product.cargoMode === "truck" ? "selected" : ""}>ทางรถ</option>
              <option value="sea" ${product.cargoMode === "sea" ? "selected" : ""}>ทางเรือ</option>
            </select>
          </label>
          <label class="field">
            <span>ประเภทสินค้า</span>
            <select id="cargoType">
              ${["A", "M", "O", "X", "Z"].map((type) => {
                const mode = MOMO_RATES[product.cargoMode] ? product.cargoMode : "truck";
                return `<option value="${type}" ${product.cargoType === type ? "selected" : ""}>${escapeHtml(MOMO_RATES[mode][type].label)}</option>`;
              }).join("")}
            </select>
          </label>
          ${numberInput("widthCm", "กว้าง/ชิ้น (ซม.)", fieldValue(product, "widthCm"), "0.01")}
          ${numberInput("lengthCm", "ยาว/ชิ้น (ซม.)", fieldValue(product, "lengthCm"), "0.01")}
          ${numberInput("heightCm", "สูง/ชิ้น (ซม.)", fieldValue(product, "heightCm"), "0.01")}
          ${numberInput("unitWeightKg", "น้ำหนัก/ชิ้น (กก.)", fieldValue(product, "unitWeightKg"), "0.01")}
        </div>
        <div class="calc-result" id="itemCalcResult">
          ${renderCalcResult(calc)}
        </div>
      </section>
      <label class="field">
        <span>หมายเหตุทีม/โรงงาน</span>
        <textarea id="detailNotes" rows="4">${escapeHtml(product.notes || "")}</textarea>
      </label>
      <button class="ghost-button" id="saveNotes" type="button">บันทึกหมายเหตุ</button>`;
    bindDetailEvents(product);
  }

  function numberInput(id, label, value, step) {
    if (id === "saleUnitPrice") return lockedSalePriceField(selectedProduct() || {});
    return `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input id="${escapeHtml(id)}" type="number" min="0" step="${escapeHtml(step)}" value="${escapeHtml(value)}" />
      </label>`;
  }

  function lockedSalePriceField(product) {
    const source = product.ktwPriceSourceLabel || "shop.ktw.co.th";
    return `
      <label class="field locked-price-field">
        <span>ราคาขาย PLAIN/ชิ้น</span>
        <input type="text" value="${escapeHtml(fmtMoney.format(product.ktwPrice || 0))}" readonly />
        <small>ใช้ราคา KTW จาก ${escapeHtml(source)} เท่านั้น</small>
      </label>`;
  }

  function exchangeRateLabel() {
    const rate = numberValue(state.exchangeRate.rate);
    return rate > 0 ? `1 USD = ${fmtMoney.format(rate)}` : "ยังไม่มีเรต";
  }

  function exchangeRateTimeLabel() {
    if (!state.exchangeRate.fetchedAt) return "กำลังรอ sync จาก Google";
    return new Date(state.exchangeRate.fetchedAt).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function renderExchangeCard(variant = "") {
    const status = state.exchangeRate.loading
      ? "กำลัง sync..."
      : state.exchangeRate.error
      ? `ใช้ค่าล่าสุด · ${state.exchangeRate.error}`
      : state.exchangeRate.stale
      ? "ใช้ cache ล่าสุด"
      : "sync จาก Google Finance";
    return `
      <article class="exchange-card ${escapeHtml(variant)}">
        <div>
          <span>USD → THB</span>
          <strong>${escapeHtml(exchangeRateLabel())}</strong>
          <small>${escapeHtml(status)} · ${escapeHtml(exchangeRateTimeLabel())}</small>
        </div>
        <button class="ghost-button" data-refresh-exchange type="button">Sync เรต</button>
      </article>`;
  }

  function renderCalcResult(calc) {
    return [
      ["ต้นทุน USD", fmtUsd.format(calc.purchaseUnitCostUsd)],
      ["ต้นทุน THB", fmtMoney.format(calc.purchaseUnitCost)],
      ["เรต USD/THB", exchangeRateLabel()],
      ["คิวรวม", `${fmtMeasure.format(calc.totalCbm)} CBM`],
      ["น้ำหนักรวม", `${fmtMeasure.format(calc.totalWeightKg)} KG`],
      ["ค่าส่งก่อนลด", fmtMoney.format(calc.momoBaseShipping)],
      ["ค่าส่งหลังลด", fmtMoney.format(calc.shippingTotal)],
      ["ค่าส่ง/ชิ้น", fmtMoney.format(calc.shippingUnit)],
      ["ต้นทุนรวม/ชิ้น", fmtMoney.format(calc.unitCost)],
      ["กำไร/ชิ้น", fmtMoney.format(calc.profitUnit)],
      ["กำไรรวม", fmtMoney.format(calc.profitTotal)],
    ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function collectCommercialFields() {
    const product = selectedProduct() || {};
    const purchaseUnitCostUsd = numberValue($("purchaseUnitCostUsd")?.value);
    const purchaseUnitCost =
      state.exchangeRate.rate > 0 && purchaseUnitCostUsd > 0
        ? moneyValue(purchaseUnitCostUsd * state.exchangeRate.rate)
        : 0;
    return {
      orderQuantity: numberValue($("orderQuantity")?.value),
      purchaseUnitCostUsd,
      purchaseUnitCost,
      purchaseUnitCostCleared: purchaseUnitCostUsd <= 0,
      packagingUnitCost: numberValue($("packagingUnitCost")?.value),
      otherUnitCost: numberValue($("otherUnitCost")?.value),
      widthCm: numberValue($("widthCm")?.value),
      lengthCm: numberValue($("lengthCm")?.value),
      heightCm: numberValue($("heightCm")?.value),
      unitWeightKg: numberValue($("unitWeightKg")?.value),
      cargoMode: $("cargoMode")?.value || "truck",
      cargoType: $("cargoType")?.value || "A",
    };
  }

  function updateLocalProduct(sku, updates) {
    state.products = state.products.map((product) => product.sku === sku ? normalizeProduct({ ...product, ...updates }) : product);
  }

  async function savePlainImageRowVersionSelection(sku, version) {
    const product = state.products.find((item) => item.sku === sku);
    if (!product) return;
    const normalizedVersion = normalizePlainImageVersion(version);
    const angleCount = Math.max(1, assetTarget(product, "product_images"));
    const plainImageVersionSelections = {
      ...normalizePlainImageVersionSelections(product.plainImageVersionSelections),
      ...Object.fromEntries(Array.from({ length: angleCount }, (_, index) => [index + 1, normalizedVersion])),
    };
    updateLocalProduct(sku, { plainImageVersionSelections });
    renderTrackerTable();
    renderDesignDetail();
    await updateProduct(sku, { plainImageVersionSelections });
  }

  async function savePlainImageVersionSelection(sku, angleIndex, version) {
    const product = state.products.find((item) => item.sku === sku);
    const normalizedAngleIndex = normalizePlainImageAngleIndex(angleIndex);
    if (!product || !normalizedAngleIndex) return;
    const plainImageVersionSelections = {
      ...normalizePlainImageVersionSelections(product.plainImageVersionSelections),
      [normalizedAngleIndex]: normalizePlainImageVersion(version),
    };
    updateLocalProduct(sku, { plainImageVersionSelections });
    renderTrackerTable();
    renderDesignDetail();
    await updateProduct(sku, { plainImageVersionSelections });
  }

  function mergeAiImageRevisionResult(result) {
    if (!result?.sku) return;
    state.products = state.products.map((product) => {
      if (product.sku !== result.sku) return product;
      return normalizeProduct({
        ...product,
        ...result.product,
        assets: result.product?.assets || [result.asset, ...(product.assets || [])].filter(Boolean),
      });
    });
  }

  function bulkAiDesignTargets() {
    return state.products
      .filter((product) => state.bulkStatusSelectedSkus.has(product.sku))
      .flatMap((product) => {
        const angleCount = Math.max(1, assetTarget(product, "product_images"));
        return Array.from({ length: angleCount }, (_, index) => ({
          sku: product.sku,
          name: product.name,
          angleIndex: index + 1,
          version: plainImageVersionSelection(product, index),
        }));
      });
  }

  async function requestBulkAiDesign() {
    const prompt = String(state.bulkAiPrompt || "").trim();
    const targets = bulkAiDesignTargets();
    if (!targets.length) {
      showMessage("เลือก SKU ที่ต้องการสั่ง AI Bulk ก่อน", true);
      return;
    }
    if (!prompt) {
      showMessage("ใส่คำสั่ง AI Bulk ก่อน", true);
      document.querySelector("[data-bulk-ai-prompt]")?.focus();
      return;
    }
    if (state.bulkAiRequest?.running) return;
    const confirmText = `จะสั่ง AI ออกแบบ ${fmtQty.format(targets.length)} รูป จาก ${fmtQty.format(state.bulkStatusSelectedSkus.size)} SKU ที่เลือก ต้องการเริ่มไหม?`;
    if (typeof window.confirm === "function" && !window.confirm(confirmText)) return;

    state.bulkAiRequest = { running: true, total: targets.length, done: 0, failed: 0, current: "", errors: [] };
    renderBulkStatusBar();
    try {
      for (const target of targets) {
        state.bulkAiRequest.current = `${target.sku} มุม ${fmtQty.format(target.angleIndex)}`;
        renderBulkStatusBar();
        try {
          const result = await api("/api/plain-design/ai-image-edit", {
            method: "POST",
            body: JSON.stringify({
              sku: target.sku,
              angleIndex: target.angleIndex,
              version: target.version,
              prompt,
              referenceImages: state.bulkAiReferenceImages,
            }),
          });
          mergeAiImageRevisionResult(result);
          state.bulkAiRequest.done += 1;
        } catch (error) {
          state.bulkAiRequest.failed += 1;
          state.bulkAiRequest.errors.push(`${target.sku} มุม ${fmtQty.format(target.angleIndex)}: ${error.message}`);
        }
        renderTrackerTable();
        renderDesignDetail();
      }
      const { done, failed } = state.bulkAiRequest;
      showMessage(`AI Bulk เสร็จ ${fmtQty.format(done)} รูป${failed ? `, พลาด ${fmtQty.format(failed)} รูป` : ""}`, failed > 0);
    } finally {
      state.bulkAiRequest = null;
      renderTrackerTable();
      renderDesignDetail();
    }
  }

  async function requestPlainImageAiEdit(sku, angleIndex, version) {
    const normalizedAngleIndex = normalizePlainImageAngleIndex(angleIndex);
    const normalizedVersion = normalizePlainImageVersion(version);
    const command = document.querySelector(
      `[data-ai-image-command="${escapeCss(sku)}"][data-angle-index="${escapeCss(normalizedAngleIndex)}"][data-version="${escapeCss(normalizedVersion)}"]`
    );
    const prompt = String(command?.value || "").trim();
    if (!prompt) {
      showMessage("ใส่คำสั่งให้ AI ก่อน", true);
      command?.focus();
      return;
    }
    const requestKey = aiImageRequestKey(sku, normalizedAngleIndex, normalizedVersion);
    if (state.aiImageRequests.has(requestKey)) return;
    state.aiImageRequests.set(requestKey, true);
    renderTrackerTable();
    renderDesignDetail();
    try {
      showMessage("รับคำสั่งแล้ว กำลังให้ AI ออกแบบรูป");
      const result = await api("/api/plain-design/ai-image-edit", {
        method: "POST",
        body: JSON.stringify({
          sku,
          angleIndex: normalizedAngleIndex,
          version: normalizedVersion,
          prompt,
          referenceImages: referenceImagesForAiRequest(requestKey),
        }),
      });
      mergeAiImageRevisionResult(result);
      state.aiImageReferenceUploads.delete(requestKey);
      showMessage(`AI สร้างรูป PLAIN V${plainVersionLabel(result.newVersion)} แล้ว`);
      render();
    } catch (error) {
      showMessage(`AI ยังสร้างรูปไม่ได้: ${error.message}`, true);
      render();
    } finally {
      state.aiImageRequests.delete(requestKey);
      renderTrackerTable();
      renderDesignDetail();
    }
  }

  function queueProductCommercialSave(sku, updates) {
    if (!queueProductCommercialSave.timers) queueProductCommercialSave.timers = new Map();
    const timers = queueProductCommercialSave.timers;
    window.clearTimeout(timers.get(sku));
    timers.set(sku, window.setTimeout(async () => {
      try {
        const updated = await api("/api/plain-design/product", {
          method: "POST",
          body: JSON.stringify({ sku, ...updates }),
        });
        state.products = state.products.map((product) => product.sku === sku ? normalizeProduct({ ...product, ...updated }) : product);
        showMessage("บันทึกแล้ว");
        refreshPoRealtime();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        timers.delete(sku);
      }
    }, 550));
  }

  function ensureImageLightbox() {
    let modal = $("imageLightbox");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "imageLightbox";
    modal.className = "image-lightbox";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "ดูรูปสินค้า");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="image-lightbox-backdrop" data-close-image></div>
      <figure class="image-lightbox-dialog">
        <button class="image-lightbox-close" type="button" data-close-image aria-label="ปิดรูป">ปิด</button>
        <div class="image-lightbox-stage">
          <button class="image-lightbox-nav previous" type="button" data-gallery-prev aria-label="รูปก่อนหน้า">‹</button>
          <img class="image-lightbox-main-image" id="imageLightboxImage" alt="" />
          <button class="image-lightbox-nav next" type="button" data-gallery-next aria-label="รูปถัดไป">›</button>
        </div>
        <figcaption>
          <strong id="imageLightboxTitle"></strong>
          <span id="imageLightboxCaption"></span>
          <small id="imageLightboxCounter"></small>
        </figcaption>
        <div class="image-lightbox-thumbs" id="imageLightboxThumbs" aria-label="เลือกรูปสินค้า"></div>
      </figure>`;
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-image]")) closeImageLightbox();
      const previous = event.target.closest("[data-gallery-prev]");
      if (previous) setImageLightboxSlide(imageLightboxSlideIndex - 1);
      const next = event.target.closest("[data-gallery-next]");
      if (next) setImageLightboxSlide(imageLightboxSlideIndex + 1);
      const thumb = event.target.closest("[data-gallery-index]");
      if (thumb) setImageLightboxSlide(Number(thumb.dataset.galleryIndex || 0));
    });
    document.addEventListener("keydown", (event) => {
      if ($("imageLightbox")?.hidden) return;
      if (event.key === "Escape") closeImageLightbox();
      if (event.key === "ArrowLeft") setImageLightboxSlide(imageLightboxSlideIndex - 1);
      if (event.key === "ArrowRight") setImageLightboxSlide(imageLightboxSlideIndex + 1);
    });
    document.body.appendChild(modal);
    return modal;
  }

  function openProductImageGallery(sku, mode = state.productImageMode) {
    const product = state.products.find((item) => item.sku === sku);
    if (!product) return;
    const slides = tableImageGalleryFor(product, mode);
    if (!slides.length) return;
    const modal = ensureImageLightbox();
    imageLightboxLastFocus = document.activeElement;
    imageLightboxSlides = slides;
    setImageLightboxSlide(0);
    modal.hidden = false;
    document.body.classList.add("image-lightbox-open");
    modal.querySelector(".image-lightbox-close")?.focus();
  }

  function setImageLightboxSlide(index) {
    if (!imageLightboxSlides.length) return;
    const total = imageLightboxSlides.length;
    imageLightboxSlideIndex = ((Number(index) || 0) + total) % total;
    const slide = imageLightboxSlides[imageLightboxSlideIndex];
    $("imageLightboxImage").src = slide.src;
    $("imageLightboxImage").alt = slide.alt || slide.title || slide.caption || "รูปสินค้า";
    $("imageLightboxTitle").textContent = slide.title || "รูปสินค้า";
    $("imageLightboxCaption").textContent = slide.caption || "";
    $("imageLightboxCounter").textContent = `${fmtQty.format(imageLightboxSlideIndex + 1)} / ${fmtQty.format(total)}`;
    document.querySelectorAll("[data-gallery-prev], [data-gallery-next]").forEach((button) => {
      button.disabled = total <= 1;
    });
    $("imageLightboxThumbs").innerHTML = imageLightboxSlides.map((item, itemIndex) => `
      <button class="image-lightbox-thumb ${itemIndex === imageLightboxSlideIndex ? "active" : ""}" type="button" data-gallery-index="${itemIndex}" aria-label="ดูรูปที่ ${fmtQty.format(itemIndex + 1)}">
        <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || item.title || "")}" loading="lazy" />
      </button>`).join("");
  }

  function openImageLightbox({ src, title, caption }) {
    if (!src) return;
    const modal = ensureImageLightbox();
    imageLightboxLastFocus = document.activeElement;
    imageLightboxSlides = [{
      src,
      alt: title || caption || "รูปสินค้า",
      title: title || "รูปสินค้า",
      caption: caption || "",
    }];
    setImageLightboxSlide(0);
    modal.hidden = false;
    document.body.classList.add("image-lightbox-open");
    modal.querySelector(".image-lightbox-close")?.focus();
  }

  function closeImageLightbox() {
    const modal = $("imageLightbox");
    if (!modal) return;
    modal.hidden = true;
    $("imageLightboxImage").removeAttribute("src");
    $("imageLightboxThumbs").innerHTML = "";
    imageLightboxSlides = [];
    imageLightboxSlideIndex = 0;
    document.body.classList.remove("image-lightbox-open");
    if (imageLightboxLastFocus?.focus) imageLightboxLastFocus.focus();
    imageLightboxLastFocus = null;
  }

  function bindDetailEvents(product) {
    document.querySelector("[data-detail-panel-collapse]")?.addEventListener("click", () => setDetailPanelCollapsed(true));
    $("detailStatus").addEventListener("change", (event) => updateProduct(product.sku, { status: event.target.value }));
    $("saveNotes").addEventListener("click", () => updateProduct(product.sku, { notes: $("detailNotes").value }));
    $("saveCommercial").addEventListener("click", () => updateProduct(product.sku, collectCommercialFields()));
    document.querySelectorAll("[data-refresh-exchange]").forEach((button) => {
      button.addEventListener("click", () => loadExchangeRate(true));
    });
    $("itemCalculator").addEventListener("input", () => {
      updateLocalProduct(product.sku, collectCommercialFields());
      const nextProduct = selectedProduct();
      $("itemCalcResult").innerHTML = renderCalcResult(lineCalc(nextProduct));
      renderStats();
      renderTrackerTable();
      renderPoPanel();
    });
    $("cargoMode").addEventListener("change", () => {
      updateLocalProduct(product.sku, collectCommercialFields());
      renderDesignDetail();
      renderStats();
      renderTrackerTable();
      renderPoPanel();
    });
    state.assetGroups.forEach((group) => {
      const input = $(`${group.id}-input`);
      input?.addEventListener("change", () => {
        uploadFiles(product.sku, group.id, Array.from(input.files || []));
        input.value = "";
      });
    });
    const detailRoot = $("design");
    detailRoot?.querySelectorAll("[data-plain-image-version]").forEach((button) => {
      button.addEventListener("click", () => savePlainImageVersionSelection(
        button.dataset.plainImageVersion,
        button.dataset.angleIndex,
        button.dataset.version
      ));
    });
    detailRoot?.querySelectorAll("[data-plain-image-version-upload]").forEach((input) => {
      input.addEventListener("change", () => {
        uploadFiles(input.dataset.plainImageVersionUpload, "product_images", Array.from(input.files || []), {
          angleIndex: input.dataset.angleIndex,
          version: input.dataset.version,
        });
        input.value = "";
      });
    });
    detailRoot?.querySelectorAll("[data-ai-image-reference-upload]").forEach((input) => {
      input.addEventListener("change", () => setAiReferenceUploadFromInput(input));
    });
    detailRoot?.querySelectorAll("[data-ai-image-reference-clear]").forEach((button) => {
      button.addEventListener("click", () => clearAiReferenceUpload(
        button.dataset.aiImageReferenceClear,
        button.dataset.angleIndex,
        button.dataset.version
      ));
    });
    detailRoot?.querySelectorAll("[data-ai-image-submit]").forEach((button) => {
      button.addEventListener("click", () => requestPlainImageAiEdit(
        button.dataset.aiImageSubmit,
        button.dataset.angleIndex,
        button.dataset.version
      ));
    });
    document.querySelectorAll("[data-delete-asset]").forEach((button) => {
      button.addEventListener("click", () => deleteAsset(product.sku, button.dataset.deleteAsset));
    });
    document.querySelectorAll("[data-open-image]").forEach((button) => {
      button.addEventListener("click", () => openImageLightbox({
        src: button.dataset.openImage,
        title: button.dataset.imageTitle,
        caption: button.dataset.imageCaption,
      }));
    });
  }

  function renderUploadGroup(product, group) {
    const assets = assetsFor(product, group.id);
    return `
      <section class="upload-group">
        <div class="upload-title">
          <div>
            <strong>${escapeHtml(group.label)}</strong>
            <span>${escapeHtml(group.description)}</span>
          </div>
          <label class="mini-upload" for="${escapeHtml(group.id)}-input">เพิ่มไฟล์</label>
        </div>
        <label class="drop-zone" for="${escapeHtml(group.id)}-input">
          <span>${assets.length ? `${assets.length} ไฟล์แล้ว` : "เลือกหลายไฟล์ได้"}</span>
        </label>
        <input id="${escapeHtml(group.id)}-input" type="file" multiple accept="${escapeHtml(group.accept || "")}" />
        <div class="asset-list">
          ${assets.map((asset) => `
            <article class="asset-chip">
              ${String(asset.mimeType || "").startsWith("image/")
                ? `<img src="${escapeHtml(asset.publicUrl)}" alt="${escapeHtml(asset.fileName)}" loading="lazy" />`
                : `<span class="file-icon">FILE</span>`}
              <div>
                <a href="${escapeHtml(asset.publicUrl)}" target="_blank" rel="noreferrer">${escapeHtml(asset.fileName)}</a>
                <small>${fileSize(asset.fileSize)}</small>
              </div>
              <button type="button" data-delete-asset="${escapeHtml(asset.id)}" aria-label="ลบไฟล์">x</button>
            </article>`).join("")}
        </div>
      </section>`;
  }

  function renderDesignUploadGroup(product, group) {
    const assets = assetsFor(product, group.id);
    const progress = assetProgress(product, group.id);
    return `
      <section class="upload-group design-upload-group">
        <div class="upload-title">
          <div>
            <strong>${escapeHtml(group.label)}</strong>
            <span>${escapeHtml(group.description)}</span>
          </div>
          <span class="upload-count">${fmtQty.format(progress.count)}/${fmtQty.format(progress.target)} ไฟล์</span>
        </div>
        <div class="upload-grid">
          <label class="drop-zone" for="${escapeHtml(group.id)}-input">
            <strong>ลากไฟล์มาวางที่นี่</strong>
            <span>หรือ</span>
            <b>เลือกไฟล์</b>
          </label>
          <input id="${escapeHtml(group.id)}-input" type="file" multiple accept="${escapeHtml(group.accept || "")}" />
          <div class="asset-list">
            ${assets.length
              ? assets.map((asset) => `
                <article class="asset-chip">
                  ${String(asset.mimeType || "").startsWith("image/")
                    ? `<img src="${escapeHtml(asset.publicUrl)}" alt="${escapeHtml(asset.fileName)}" loading="lazy" />`
                    : `<span class="file-icon">FILE</span>`}
                  <div>
                    <a href="${escapeHtml(asset.publicUrl)}" target="_blank" rel="noreferrer">${escapeHtml(asset.fileName)}</a>
                    <small>${fileSize(asset.fileSize)}</small>
                  </div>
                  <span class="asset-status ok">OK</span>
                  <button type="button" data-delete-asset="${escapeHtml(asset.id)}" aria-label="ลบไฟล์">ลบ</button>
                </article>`).join("")
              : `<div class="asset-empty">ยังไม่มีไฟล์</div>`}
          </div>
        </div>
      </section>`;
  }

  function renderPoPanelLegacy() {
    const bill = billCalc();
    const margin = bill.revenueTotal > 0 ? bill.profitTotal / bill.revenueTotal : 0;
    $("purchase-order").innerHTML = `
      <div class="section-heading">
        <div>
          <h2>ใบสั่งซื้อและกำไรทั้งบิล</h2>
          <span>ค่าส่งคำนวณตามหลัก Momocargo: เทียบค่าคิวกับค่าน้ำหนัก แล้วใช้ค่าที่สูงกว่า</span>
        </div>
        <button class="primary-button" id="printPo" type="button">พิมพ์ใบสั่งซื้อ</button>
      </div>
      <div class="po-controls">
        ${renderExchangeCard()}
        <label class="field">
          <span>เลขที่ PO</span>
          <input id="poNumber" type="text" value="${escapeHtml(state.poNumber)}" />
        </label>
        <label class="field">
          <span>วันที่</span>
          <input id="poDate" type="date" value="${escapeHtml(state.poDate)}" />
        </label>
        <label class="field">
          <span>ผู้ขาย/โรงงาน</span>
          <input id="supplierName" type="text" value="${escapeHtml(state.supplierName)}" />
        </label>
        <label class="field">
          <span>ส่วนลด Fast Cargo (%)</span>
          <input id="fastCargoDiscount" type="number" min="0" max="100" step="1" value="${escapeHtml(state.fastCargoDiscount)}" />
        </label>
      </div>
      <div class="po-summary">
        ${[
          ["ยอดขายคาดการณ์", fmtMoney.format(bill.revenueTotal)],
          ["ต้นทุนสินค้า", fmtMoney.format(bill.productCostTotal)],
          ["แพคเกจ+อื่น ๆ", fmtMoney.format(bill.packagingTotal + bill.otherTotal)],
          ["ค่าส่งหลังลด", fmtMoney.format(bill.shippingTotal)],
          ["ยอดสั่งซื้อทั้งบิล", fmtMoney.format(bill.totalCost)],
          ["กำไรรวม", fmtMoney.format(bill.profitTotal)],
          ["Margin", fmtPercent.format(margin)],
        ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("")}
      </div>
      <div class="table-wrap">
        <table class="po-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>รายการ</th>
              <th class="num">จำนวน</th>
              <th class="num">ต้นทุน USD</th>
              <th class="num">ต้นทุน THB</th>
              <th class="num">ค่าส่ง/ชิ้น</th>
              <th class="num">ต้นทุนรวม</th>
              <th class="num">ราคาขายรวม</th>
              <th class="num">กำไรรวม</th>
            </tr>
          </thead>
          <tbody>
            ${bill.lines.map(({ product, calc }) => `
              <tr>
                <td><strong>${escapeHtml(product.sku)}</strong></td>
                <td>${escapeHtml(product.name)}<small>${escapeHtml(calc.rate.modeLabel)} · ${escapeHtml(calc.rate.label)} · ฐาน ${calc.chargeBasis}</small></td>
                <td class="num">${fmtQty.format(calc.qty)}</td>
                <td class="num">${fmtUsd.format(calc.purchaseUnitCostUsd)}</td>
                <td class="num">${fmtMoney.format(calc.purchaseUnitCost)}</td>
                <td class="num">${fmtMoney.format(calc.shippingUnit)}</td>
                <td class="num">${fmtMoney.format(calc.totalCost)}</td>
                <td class="num">${fmtMoney.format(calc.revenueTotal)}</td>
                <td class="num ${calc.profitTotal < 0 ? "danger-text" : "good-text"}">${fmtMoney.format(calc.profitTotal)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    bindPoEvents();
  }

  function activePlainHash() {
    const hash = window.location.hash || "#products";
    return hash === "#purchase-order" ? "#purchase-order" : "#products";
  }

  function syncActiveNav() {
    const activeHash = activePlainHash();
    document.querySelectorAll(".plain-nav a").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === activeHash);
    });
    syncActiveView();
  }

  function syncActiveView() {
    const activeHash = activePlainHash();
    const isPurchaseOrderView = activeHash === "#purchase-order";
    $("purchase-order").hidden = !isPurchaseOrderView;
    $("products").hidden = isPurchaseOrderView;
    $("plainMainGrid").hidden = isPurchaseOrderView;
  }

  function applyReferenceCopy() {
    const title = document.querySelector(".topbar h1");
    if (title) title.textContent = "งานออกแบบรีดีไซน์สินค้า PLAIN (KTW Source)";
    const navLabels = ["รายการสินค้า", "ใบสั่งซื้อ"];
    document.querySelectorAll(".plain-nav a").forEach((link, index) => {
      if (navLabels[index]) link.textContent = navLabels[index];
    });
    const productHeading = document.querySelector(".product-panel .section-heading h2");
    if (productHeading) productHeading.textContent = "รายการสินค้า";
    const search = $("searchInput");
    if (search) search.placeholder = "ค้นหา SKU หรือชื่อสินค้า...";
  }

  function bindPoEventsLegacy() {
    $("printPo")?.addEventListener("click", () => window.print());
    document.querySelectorAll("#purchase-order [data-refresh-exchange]").forEach((button) => {
      button.addEventListener("click", () => loadExchangeRate(true));
    });
    $("fastCargoDiscount")?.addEventListener("input", (event) => {
      state.fastCargoDiscount = clamp(event.target.value, 0, 100);
      localStorage.setItem("plainFastCargoDiscount", String(state.fastCargoDiscount));
      renderStats();
      renderTrackerTable();
      renderDesignDetail();
      renderPoPanel();
    });
    [["poNumber", "plainPoNumber"], ["poDate", "plainPoDate"], ["supplierName", "plainSupplierName"]].forEach(([id, key]) => {
      $(id)?.addEventListener("input", (event) => {
        state[id] = event.target.value;
        localStorage.setItem(key, event.target.value);
      });
    });
  }

  function renderPoSummaryCards(bill) {
    const margin = bill.revenueTotal > 0 ? bill.profitTotal / bill.revenueTotal : 0;
    return [
      ["จำนวนรวม", `${fmtQty.format(bill.qty)} ชิ้น`],
      ["ยอดขายรวม", fmtMoney.format(bill.revenueTotal)],
      ["ต้นทุนสินค้า", fmtMoney.format(bill.productCostTotal)],
      ["แพคเกจ + อื่น ๆ", fmtMoney.format(bill.packagingTotal + bill.otherTotal)],
      ["ค่าขนส่งหลังลด", fmtMoney.format(bill.shippingTotal)],
      ["ยอดสั่งซื้อทั้งบิล", fmtMoney.format(bill.totalCost)],
      ["กำไรรวม", fmtMoney.format(bill.profitTotal), bill.profitTotal < 0 ? "danger" : "good"],
      ["Margin", fmtPercent.format(margin), margin < 0 ? "danger" : "good"],
    ].map(([label, value, tone]) => `<article class="${tone ? `po-summary-${tone}` : ""}"><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function renderPoBillList() {
    return state.purchaseOrders.map((order, index) => {
      const bill = billCalc(order);
      const active = order.id === state.activePurchaseOrderId;
      return `
        <button class="po-bill-card ${active ? "active" : ""}" data-po-bill="${escapeHtml(order.id)}" type="button">
          <span class="po-bill-index">บิลที่ ${fmtQty.format(index + 1)}</span>
          <strong>${escapeHtml(order.number)}</strong>
          <small>${escapeHtml(order.poDate)} | ${fmtQty.format(bill.qty)} ชิ้น</small>
          <span class="po-bill-meta">
            <b>${fmtMoney.format(bill.totalCost)}</b>
            <em class="${bill.profitTotal < 0 ? "danger-text" : "good-text"}">${fmtMoney.format(bill.profitTotal)}</em>
          </span>
        </button>`;
    }).join("");
  }

  function renderPoRows(bill) {
    if (!bill.lines.length) {
      return `<tr><td class="empty-state" colspan="12">ยังไม่มีสินค้าในใบสั่งซื้อ เลือก SKU แล้วกดเพิ่มรายการสินค้า</td></tr>`;
    }
    return bill.lines.map(({ product, calc }, index) => {
      const status = statusMeta(product.status);
      return `
        <tr data-po-row="${escapeHtml(product.sku)}" class="${calc.qty <= 0 ? "line-muted" : ""}">
          <td class="row-index">${fmtQty.format(index + 1)}</td>
          <td class="product-image-cell">
            ${renderTableCoverImage(product)}
          </td>
          <td>
            <span class="table-product-name">${escapeHtml(product.name)}</span>
            <small class="table-product-sku">SKU ${escapeHtml(product.sku)}</small>
            <small class="table-product-meta">${escapeHtml(categoryLabel(product.category))} · ${escapeHtml(calc.rate.modeLabel)} | ${escapeHtml(calc.rate.label)} | ฐาน ${calc.chargeBasis}</small>
          </td>
          <td class="num">
            <strong>${fmtMoney.format(product.ktwPrice || 0)}</strong>
            <small data-po-cell="revenueTotal">${fmtMoney.format(calc.revenueTotal)} รวม</small>
          </td>
          <td class="num">
            <label class="table-cost-editor">
              <span class="table-cost-input-wrap">
                <span class="table-cost-currency" aria-hidden="true">$</span>
                <input class="table-cost-input po-usd-input" data-po-usd="${escapeHtml(product.sku)}" type="number" min="0" step="0.0001" inputmode="decimal" value="${calc.purchaseUnitCostUsd > 0 ? escapeHtml(calc.purchaseUnitCostUsd) : ""}" placeholder="0.0000" aria-label="ต้นทุนสินค้า USD ${escapeHtml(product.sku)}" />
              </span>
              <small data-po-cell="purchaseUnitCost">${fmtMoney.format(calc.purchaseUnitCost)}</small>
            </label>
          </td>
          <td class="num" data-po-cell="shippingUnit">
            <strong>${fmtMoney.format(calc.shippingUnit)}</strong>
            <small>${fmtMoney.format(calc.shippingTotal)} รวม</small>
          </td>
          <td class="num ${calc.profitUnit < 0 ? "danger-text" : "good-text"}" data-po-cell="profitUnit">
            <strong>${fmtMoney.format(calc.profitUnit)}</strong>
            <small>${fmtMoney.format(calc.profitTotal)} รวม</small>
          </td>
          <td class="num">
            <input class="po-qty-input" data-po-qty="${escapeHtml(product.sku)}" type="number" min="0" step="1" inputmode="numeric" value="${calc.qty > 0 ? escapeHtml(calc.qty) : ""}" placeholder="0" aria-label="จำนวนในบิล ${escapeHtml(product.sku)}" />
            <small>ใบ</small>
            <button class="po-line-delete-button" type="button" data-po-remove-line="${escapeHtml(product.sku)}">ลบรายการ</button>
          </td>
          <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
          <td class="num">${assetPill(product, "product_images")}</td>
          <td class="num">${assetPill(product, "packaging_images")}</td>
          <td class="num">${assetPill(product, "factory_files")}</td>
        </tr>`;
    }).join("");
  }

  function refreshPoRealtime() {
    const order = activePurchaseOrder();
    const bill = billCalc(order);
    if ($("poSummary")) $("poSummary").innerHTML = renderPoSummaryCards(bill);
    if ($("poBillList")) $("poBillList").innerHTML = renderPoBillList();
    if ($("activeBillTitle")) $("activeBillTitle").textContent = order?.number || "-";
    if ($("activeBillMeta")) $("activeBillMeta").textContent = `${fmtQty.format(bill.qty)} ชิ้น | ยอดสั่งซื้อ ${fmtMoney.format(bill.totalCost)} | กำไร ${fmtMoney.format(bill.profitTotal)}`;
    if ($("activeBillQty")) $("activeBillQty").textContent = `${fmtQty.format(bill.qty)} ชิ้น`;
    if ($("activeBillCost")) $("activeBillCost").textContent = fmtMoney.format(bill.totalCost);
    if ($("activeBillProfit")) {
      $("activeBillProfit").textContent = fmtMoney.format(bill.profitTotal);
      $("activeBillProfit").className = bill.profitTotal < 0 ? "danger-text" : "good-text";
    }
    const rowsBySku = new Map(bill.tableRows.map((line) => [line.product.sku, line]));
    document.querySelectorAll("#purchase-order [data-po-row]").forEach((row) => {
      const line = rowsBySku.get(row.dataset.poRow);
      if (!line) return;
      const { calc } = line;
      row.classList.toggle("line-muted", calc.qty <= 0);
      const qtyInput = row.querySelector("[data-po-qty]");
      if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = calc.qty > 0 ? String(calc.qty) : "";
      const usdInput = row.querySelector("[data-po-usd]");
      if (usdInput && document.activeElement !== usdInput) usdInput.value = calc.purchaseUnitCostUsd > 0 ? String(calc.purchaseUnitCostUsd) : "";
      const purchaseCell = row.querySelector('[data-po-cell="purchaseUnitCost"]');
      if (purchaseCell) purchaseCell.textContent = fmtMoney.format(calc.purchaseUnitCost);
      const revenueCell = row.querySelector('[data-po-cell="revenueTotal"]');
      if (revenueCell) revenueCell.textContent = `${fmtMoney.format(calc.revenueTotal)} รวม`;
      const shippingCell = row.querySelector('[data-po-cell="shippingUnit"]');
      if (shippingCell) {
        shippingCell.innerHTML = `<strong>${fmtMoney.format(calc.shippingUnit)}</strong><small>${fmtMoney.format(calc.shippingTotal)} รวม</small>`;
      }
      const profitCell = row.querySelector('[data-po-cell="profitUnit"]');
      if (profitCell) {
        profitCell.innerHTML = `<strong>${fmtMoney.format(calc.profitUnit)}</strong><small>${fmtMoney.format(calc.profitTotal)} รวม</small>`;
        profitCell.classList.toggle("danger-text", calc.profitUnit < 0);
        profitCell.classList.toggle("good-text", calc.profitUnit >= 0);
      }
    });
  }

  function refreshTrackerCommercialRow(sku) {
    const product = state.products.find((item) => item.sku === sku);
    if (!product) return;
    const row = Array.from(document.querySelectorAll("#productRows [data-sku]")).find((item) => item.dataset.sku === sku);
    if (!row) return;
    const calc = lineCalc(product);
    const usdInput = row.querySelector("[data-table-usd]");
    if (usdInput && document.activeElement !== usdInput) usdInput.value = trackerCostInputValue(calc);
    const purchaseCell = row.querySelector('[data-table-cell="purchaseUnitCost"]');
    if (purchaseCell) purchaseCell.textContent = fmtMoney.format(calc.purchaseUnitCost);
    const shippingCell = row.querySelector('[data-table-cell="shippingUnit"]');
    if (shippingCell) {
      shippingCell.innerHTML = `<strong>${fmtMoney.format(calc.shippingUnit)}</strong><small>${fmtMoney.format(calc.shippingTotal)} รวม</small>`;
    }
    const profitCell = row.querySelector('[data-table-cell="profitUnit"]');
    if (profitCell) {
      profitCell.innerHTML = `<strong>${fmtMoney.format(calc.profitUnit)}</strong><small>${fmtMoney.format(calc.profitTotal)} รวม</small>`;
      profitCell.classList.toggle("danger-text", calc.profitUnit < 0);
      profitCell.classList.toggle("good-text", calc.profitUnit >= 0);
    }
  }

  function renderPoPanel() {
    const order = activePurchaseOrder() || makePurchaseOrder(plannedOrderLines());
    const bill = billCalc(order);
    const availableProducts = poAvailableProducts(order);
    const defaultAddQty = Math.max(1, numberValue(availableProducts[0]?.orderQuantity) || 1);
    $("purchase-order").innerHTML = `
      <div class="section-heading">
        <div>
          <h2>ระบบใบสั่งซื้อ</h2>
          <span>แยกเป็นแต่ละบิล แก้จำนวนแล้วคำนวณยอดรวม ต้นทุน ค่าขนส่ง และกำไรแบบ Realtime</span>
        </div>
        <div class="po-actions">
          <button class="secondary-button" id="newPurchaseOrder" type="button">+ สร้างบิลใหม่</button>
          <button class="danger-button" id="deletePurchaseOrder" type="button" data-delete-purchase-order="${escapeHtml(order.id)}">ลบบิลนี้</button>
          <button class="primary-button" id="printPo" type="button">พิมพ์ใบสั่งซื้อ</button>
        </div>
      </div>
      <div class="po-system-layout">
        <aside class="po-bill-sidebar">
          <div class="po-bill-sidebar-head">
            <div>
              <strong>รายการบิล</strong>
              <span>${fmtQty.format(state.purchaseOrders.length)} บิล</span>
            </div>
          </div>
          <div class="po-bill-list" id="poBillList">${renderPoBillList()}</div>
        </aside>
        <div class="po-workspace">
          <div class="po-workspace-head">
            <div>
              <span>บิลที่เลือก</span>
              <h3 id="activeBillTitle">${escapeHtml(order.number)}</h3>
              <small id="activeBillMeta">${fmtQty.format(bill.qty)} ชิ้น | ยอดสั่งซื้อ ${fmtMoney.format(bill.totalCost)} | กำไร ${fmtMoney.format(bill.profitTotal)}</small>
            </div>
            <div class="po-live-strip">
              <span>จำนวน <b id="activeBillQty">${fmtQty.format(bill.qty)} ชิ้น</b></span>
              <span>ยอดบิล <b id="activeBillCost">${fmtMoney.format(bill.totalCost)}</b></span>
              <span>กำไร <b id="activeBillProfit" class="${bill.profitTotal < 0 ? "danger-text" : "good-text"}">${fmtMoney.format(bill.profitTotal)}</b></span>
            </div>
          </div>
          <div class="po-controls">
            ${renderExchangeCard()}
            <label class="field">
              <span>เลขที่ PO</span>
              <input id="poNumber" type="text" value="${escapeHtml(order.number)}" />
            </label>
            <label class="field">
              <span>วันที่</span>
              <input id="poDate" type="date" value="${escapeHtml(order.poDate)}" />
            </label>
            <label class="field">
              <span>ผู้ขาย/โรงงาน</span>
              <input id="supplierName" type="text" value="${escapeHtml(order.supplierName)}" />
            </label>
            <label class="field">
              <span>ส่วนลด Fast Cargo (%)</span>
              <input id="fastCargoDiscount" type="number" min="0" max="100" step="1" value="${escapeHtml(order.fastCargoDiscount)}" />
            </label>
          </div>
          <div class="po-summary" id="poSummary">${renderPoSummaryCards(bill)}</div>
          <div class="po-line-toolbar">
            <label class="field po-product-picker">
              <span>เพิ่มรายการสินค้าสั่งซื้อ</span>
              <select id="poProductSelect" ${availableProducts.length ? "" : "disabled"}>
                ${availableProducts.length
                  ? availableProducts.map((product) => `<option value="${escapeHtml(product.sku)}">${escapeHtml(product.sku)} - ${escapeHtml(product.name)}</option>`).join("")
                  : `<option value="">เพิ่มสินค้าครบทุก SKU แล้ว</option>`}
              </select>
            </label>
            <label class="field po-add-qty">
              <span>จำนวนเริ่มต้น</span>
              <input id="poAddQuantity" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(defaultAddQty)}" ${availableProducts.length ? "" : "disabled"} />
            </label>
            <button class="secondary-button" id="addPoProductLine" type="button" ${availableProducts.length ? "" : "disabled"}>+ เพิ่มรายการสินค้า</button>
          </div>
          <div class="table-wrap">
            <table class="product-table po-table po-product-table combined-mode">
              <thead>
                <tr>
                  <th class="row-index">ลำดับ</th>
                  <th>รูปสินค้า</th>
                  <th>ชื่อสินค้า</th>
                  <th class="num">ราคา KTW</th>
                  <th class="num">ต้นทุนสินค้า</th>
                  <th class="num">ต้นทุนขนส่ง</th>
                  <th class="num">กำไร</th>
                  <th class="num">จำนวนในบิล</th>
                  <th>สถานะรีดีไซน์</th>
                  <th class="num">รูปสินค้า</th>
                  <th class="num">รูปแพคเกจจิ้ง</th>
                  <th class="num">ไฟล์โรงงาน</th>
                </tr>
              </thead>
              <tbody id="poTableBody">${renderPoRows(bill)}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    bindPoEvents();
  }

  function bindPoEvents() {
    $("printPo")?.addEventListener("click", () => window.print());
    $("newPurchaseOrder")?.addEventListener("click", createPurchaseOrder);
    $("deletePurchaseOrder")?.addEventListener("click", (event) => deletePurchaseOrder(event.currentTarget.dataset.deletePurchaseOrder));
    document.querySelectorAll("#purchase-order [data-refresh-exchange]").forEach((button) => {
      button.addEventListener("click", () => loadExchangeRate(true));
    });
    $("poBillList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-po-bill]");
      if (button) setActivePurchaseOrder(button.dataset.poBill);
    });
    $("poProductSelect")?.addEventListener("change", (event) => {
      const product = state.products.find((item) => item.sku === event.target.value);
      const qtyInput = $("poAddQuantity");
      if (qtyInput) qtyInput.value = String(Math.max(1, numberValue(product?.orderQuantity) || 1));
    });
    $("addPoProductLine")?.addEventListener("click", () => {
      addPurchaseOrderLine($("poProductSelect")?.value || "", $("poAddQuantity")?.value || "");
    });
    $("fastCargoDiscount")?.addEventListener("input", (event) => {
      updateActivePurchaseOrder({ fastCargoDiscount: clamp(event.target.value, 0, 100) });
      renderStats();
      renderTrackerTable();
      renderDesignDetail();
      refreshPoRealtime();
    });
    [["poNumber", "number"], ["poDate", "poDate"], ["supplierName", "supplierName"]].forEach(([id, field]) => {
      $(id)?.addEventListener("input", (event) => {
        updateActivePurchaseOrder({ [field]: event.target.value });
        refreshPoRealtime();
      });
    });
    $("poTableBody")?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-po-qty]");
      if (input) {
        updateActivePurchaseOrderLine(input.dataset.poQty, input.value);
        return;
      }
      const usdInput = event.target.closest("[data-po-usd]");
      if (usdInput) {
        const updates = poUsdCostUpdates(usdInput.dataset.poUsd, usdInput.value);
        updateLocalProduct(usdInput.dataset.poUsd, updates);
        queueProductCommercialSave(usdInput.dataset.poUsd, updates);
        renderStats();
        renderTrackerTable();
        renderDesignDetail();
        refreshPoRealtime();
      }
    });
    $("poTableBody")?.addEventListener("click", (event) => {
      const galleryButton = event.target.closest("[data-open-gallery-sku]");
      if (galleryButton) {
        openProductImageGallery(galleryButton.dataset.openGallerySku, galleryButton.dataset.openGalleryMode);
        return;
      }
      const button = event.target.closest("[data-po-remove-line]");
      if (button) removePurchaseOrderLine(button.dataset.poRemoveLine);
    });
    $("poTableBody")?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-po-usd]");
      if (input) updateProduct(input.dataset.poUsd, poUsdCostUpdates(input.dataset.poUsd, input.value));
    });
  }

  async function clearBulkSelectedCosts() {
    const skus = [...state.bulkStatusSelectedSkus].filter((sku) => state.products.some((product) => product.sku === sku));
    if (!skus.length) {
      showMessage("เลือก SKU ที่ต้องการลบราคาต้นทุนก่อน", true);
      return;
    }
    if (typeof window.confirm !== "function") {
      showMessage("ไม่สามารถเปิดหน้าต่างยืนยันได้ กรุณาลองใหม่ในเบราว์เซอร์", true);
      return;
    }
    if (!window.confirm(`ลบราคาต้นทุนสินค้า ${fmtQty.format(skus.length)} SKU ที่เลือกใช่ไหม?`)) return;
    const previousProducts = state.products;
    const previousSelection = new Set(state.bulkStatusSelectedSkus);
    try {
      state.saving = true;
      state.products = state.products.map((product) => (
        skus.includes(product.sku) ? normalizeProduct({ ...product, purchaseUnitCostUsd: 0, purchaseUnitCost: 0, purchaseUnitCostCleared: true }) : product
      ));
      state.bulkStatusSelectedSkus.clear();
      render();
      showMessage(`กำลังลบราคาต้นทุน ${fmtQty.format(skus.length)} SKU`);
      const updatedProducts = await Promise.all(
        skus.map((sku) => api("/api/plain-design/product", {
          method: "POST",
          body: JSON.stringify({ sku, purchaseUnitCostUsd: 0, purchaseUnitCost: 0, purchaseUnitCostCleared: true }),
        }))
      );
      const updatedBySku = new Map(updatedProducts.map((product) => [product.sku, normalizeProduct(product)]));
      state.products = state.products.map((product) => updatedBySku.get(product.sku) || product);
      render();
      showMessage(`ลบราคาต้นทุน ${fmtQty.format(skus.length)} SKU แล้ว`);
    } catch (error) {
      state.products = previousProducts;
      state.bulkStatusSelectedSkus = previousSelection;
      render();
      showMessage(`ลบราคาต้นทุนไม่สำเร็จ: ${error.message}`, true);
    } finally {
      state.saving = false;
    }
  }

  async function applyBulkRedesignStatus() {
    const status = state.bulkStatusTarget;
    const skus = [...state.bulkStatusSelectedSkus].filter((sku) => state.products.some((product) => product.sku === sku));
    if (!skus.length) {
      showMessage("เลือก SKU ที่ต้องการเปลี่ยนสถานะก่อน", true);
      return;
    }
    if (!statusOptionExists(status)) {
      showMessage("เลือกสถานะใหม่ก่อน", true);
      return;
    }
    const previousProducts = state.products;
    const statusLabel = statusMeta(status).label;
    try {
      state.saving = true;
      state.products = state.products.map((product) => (
        skus.includes(product.sku) ? normalizeProduct({ ...product, status }) : product
      ));
      state.bulkStatusSelectedSkus.clear();
      render();
      showMessage(`กำลังอัปเดตสถานะ ${fmtQty.format(skus.length)} SKU`);
      const updatedProducts = await Promise.all(
        skus.map((sku) => api("/api/plain-design/product", {
          method: "POST",
          body: JSON.stringify({ sku, status }),
        }))
      );
      const updatedBySku = new Map(updatedProducts.map((product) => [product.sku, normalizeProduct(product)]));
      state.products = state.products.map((product) => updatedBySku.get(product.sku) || product);
      showMessage(`อัปเดตสถานะ ${fmtQty.format(skus.length)} SKU เป็น ${statusLabel}`);
      render();
    } catch (error) {
      state.products = previousProducts;
      render();
      showMessage(`อัปเดตสถานะไม่สำเร็จ: ${error.message}`, true);
    } finally {
      state.saving = false;
    }
  }

  async function updateProduct(sku, updates) {
    try {
      state.saving = true;
      const updated = await api("/api/plain-design/product", {
        method: "POST",
        body: JSON.stringify({ sku, ...updates }),
      });
      state.products = state.products.map((product) => product.sku === sku ? normalizeProduct({ ...product, ...updated }) : product);
      showMessage("บันทึกแล้ว");
      render();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      state.saving = false;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result,
      });
      reader.onerror = () => reject(reader.error || new Error("อ่านไฟล์ไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }

  async function readAiReferenceFiles(files) {
    const candidates = Array.from(files || []);
    const imageFiles = candidates.filter((file) => {
      const type = String(file.type || "").toLowerCase();
      return type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
    });
    if (imageFiles.length !== candidates.length) {
      showMessage("แนบได้เฉพาะไฟล์รูปภาพสำหรับคำสั่ง AI", true);
    }
    const limitedFiles = imageFiles.slice(0, MAX_AI_REFERENCE_IMAGES);
    if (imageFiles.length > MAX_AI_REFERENCE_IMAGES) {
      showMessage(`แนบรูปอ้างอิงได้สูงสุด ${MAX_AI_REFERENCE_IMAGES} รูปต่อคำสั่ง`, true);
    }
    const tooLarge = limitedFiles.find((file) => file.size > MAX_AI_REFERENCE_IMAGE_BYTES);
    if (tooLarge) {
      showMessage(`รูปอ้างอิง ${tooLarge.name} ใหญ่เกิน 5 MB`, true);
      return [];
    }
    return Promise.all(limitedFiles.map(readFileAsDataUrl));
  }

  async function setAiReferenceUploadFromInput(input) {
    const requestKey = aiImageRequestKey(
      input.dataset.aiImageReferenceUpload,
      input.dataset.angleIndex,
      input.dataset.version
    );
    const referenceImages = await readAiReferenceFiles(input.files);
    if (referenceImages.length) {
      state.aiImageReferenceUploads.set(requestKey, referenceImages);
      showMessage(`แนบรูปอ้างอิง ${fmtQty.format(referenceImages.length)} รูปแล้ว`);
    } else {
      state.aiImageReferenceUploads.delete(requestKey);
    }
    input.value = "";
    renderTrackerTable();
    renderDesignDetail();
  }

  async function setBulkAiReferenceUploadFromInput(input) {
    const referenceImages = await readAiReferenceFiles(input.files);
    state.bulkAiReferenceImages = referenceImages;
    input.value = "";
    if (referenceImages.length) showMessage(`แนบรูปอ้างอิง Bulk ${fmtQty.format(referenceImages.length)} รูปแล้ว`);
    renderBulkStatusBar(filteredProducts());
  }

  function clearAiReferenceUpload(sku, angleIndex, version) {
    state.aiImageReferenceUploads.delete(aiImageRequestKey(sku, angleIndex, version));
    renderTrackerTable();
    renderDesignDetail();
  }

  function clearBulkAiReferenceUpload() {
    state.bulkAiReferenceImages = [];
    renderBulkStatusBar(filteredProducts());
  }

  async function uploadFiles(sku, group, files, metadata = {}) {
    if (!files.length) return;
    try {
      showMessage(`กำลังอัปโหลด ${files.length} ไฟล์`);
      const payloadFiles = await Promise.all(files.map(readFileAsDataUrl));
      const angleIndex = normalizePlainImageAngleIndex(metadata.angleIndex);
      const version = normalizePlainImageVersion(metadata.version);
      const payload = { sku, group, files: payloadFiles };
      if (group === "product_images" && angleIndex > 0) {
        payload.angleIndex = angleIndex;
        payload.version = version;
      }
      const created = await api("/api/plain-design/upload", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.products = state.products.map((product) => {
        if (product.sku !== sku) return product;
        const plainImageVersionSelections = angleIndex > 0
          ? { ...normalizePlainImageVersionSelections(product.plainImageVersionSelections), [angleIndex]: version }
          : product.plainImageVersionSelections;
        return normalizeProduct({ ...product, plainImageVersionSelections, assets: [...created, ...(product.assets || [])] });
      });
      showMessage(`อัปโหลด ${created.length} ไฟล์แล้ว`);
      render();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function deleteAsset(sku, assetId) {
    try {
      await api("/api/plain-design/delete-asset", {
        method: "POST",
        body: JSON.stringify({ sku, assetId }),
      });
      state.products = state.products.map((product) => {
        if (product.sku !== sku) return product;
        return { ...product, assets: (product.assets || []).filter((asset) => asset.id !== assetId) };
      });
      showMessage("ลบไฟล์แล้ว");
      render();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function render() {
    renderFilters();
    renderStats();
    renderProductTableModeToggle();
    renderProductImageModeToggle();
    renderDetailPanelShell();
    renderTrackerTable();
    renderDesignDetail();
    renderPoPanel();
  }

  function bindEvents() {
    $("refreshState").addEventListener("click", loadState);
    window.addEventListener("hashchange", syncActiveNav);
    $("searchInput").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderTrackerTable();
    });
    $("clearFilters")?.addEventListener("click", () => {
      state.query = "";
      state.category = "all";
      state.status = "all";
      $("searchInput").value = "";
      render();
    });
    $("categoryFilter").addEventListener("change", (event) => {
      state.category = event.target.value;
      render();
    });
    $("statusFilter").addEventListener("change", (event) => {
      state.status = event.target.value;
      render();
    });
    $("detailPanelExpandButton")?.addEventListener("click", () => setDetailPanelCollapsed(false));
    $("productTableModeToggle")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-product-table-mode]");
      if (!button) return;
      const mode = normalizeProductTableMode(button.dataset.productTableMode);
      if (state.productTableMode === mode) return;
      state.productTableMode = mode;
      localStorage.setItem("plainProductTableMode", mode);
      renderProductTableModeToggle();
      renderProductImageModeToggle();
      renderTrackerTable();
    });
    $("productImageModeToggle")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-product-image-mode]");
      if (!button) return;
      const mode = button.dataset.productImageMode === "plain" ? "plain" : "ktw";
      if (state.productImageMode === mode) return;
      state.productImageMode = mode;
      localStorage.setItem("plainProductImageMode", mode);
      renderProductImageModeToggle();
      renderTrackerTable();
    });
    $("bulkStatusBar")?.addEventListener("change", (event) => {
      const referenceUpload = event.target.closest("[data-bulk-ai-reference-upload]");
      if (referenceUpload) {
        setBulkAiReferenceUploadFromInput(referenceUpload);
        return;
      }
      const select = event.target.closest("[data-bulk-status-select]");
      if (!select) return;
      state.bulkStatusTarget = select.value;
      renderBulkStatusBar(filteredProducts());
    });
    $("bulkStatusBar")?.addEventListener("input", (event) => {
      const prompt = event.target.closest("[data-bulk-ai-prompt]");
      if (!prompt) return;
      state.bulkAiPrompt = prompt.value;
      refreshBulkAiDesignStartButton();
    });
    $("bulkStatusBar")?.addEventListener("click", (event) => {
      if (event.target.closest("[data-bulk-status-apply]")) {
        applyBulkRedesignStatus();
        return;
      }
      if (event.target.closest("[data-bulk-cost-clear]")) {
        clearBulkSelectedCosts();
        return;
      }
      if (event.target.closest("[data-bulk-status-clear]")) {
        state.bulkStatusSelectedSkus.clear();
        renderTrackerTable();
        return;
      }
      if (event.target.closest("[data-bulk-ai-design-start]")) {
        requestBulkAiDesign();
        return;
      }
      if (event.target.closest("[data-bulk-ai-reference-clear]")) {
        clearBulkAiReferenceUpload();
        return;
      }
    });
    document.querySelector(".product-table")?.addEventListener("change", (event) => {
      const toggleAll = event.target.closest("[data-bulk-status-toggle-all]");
      if (toggleAll) {
        setBulkStatusSelectionForRows(filteredProducts(), toggleAll.checked);
        return;
      }
      const rowCheckbox = event.target.closest("[data-bulk-status-row]");
      if (rowCheckbox) {
        setBulkStatusSelection(rowCheckbox.dataset.bulkStatusRow, rowCheckbox.checked);
      }
    });
    $("productRows").addEventListener("input", (event) => {
      const tableCostInput = event.target.closest("[data-table-usd]");
      if (!tableCostInput) return;
      const updates = poUsdCostUpdates(tableCostInput.dataset.tableUsd, tableCostInput.value);
      updateLocalProduct(tableCostInput.dataset.tableUsd, updates);
      queueProductCommercialSave(tableCostInput.dataset.tableUsd, updates);
      renderStats();
      renderDesignDetail();
      refreshTrackerCommercialRow(tableCostInput.dataset.tableUsd);
      refreshPoRealtime();
    });
    $("productRows").addEventListener("change", (event) => {
      const versionUpload = event.target.closest("[data-plain-image-version-upload]");
      if (versionUpload) {
        uploadFiles(versionUpload.dataset.plainImageVersionUpload, "product_images", Array.from(versionUpload.files || []), {
          angleIndex: versionUpload.dataset.angleIndex,
          version: versionUpload.dataset.version,
        });
        versionUpload.value = "";
        return;
      }
      const aiReferenceUpload = event.target.closest("[data-ai-image-reference-upload]");
      if (aiReferenceUpload) {
        setAiReferenceUploadFromInput(aiReferenceUpload);
        return;
      }
      const tableCostInput = event.target.closest("[data-table-usd]");
      if (tableCostInput) updateProduct(tableCostInput.dataset.tableUsd, poUsdCostUpdates(tableCostInput.dataset.tableUsd, tableCostInput.value));
    });
    $("productRows").addEventListener("click", (event) => {
      const galleryButton = event.target.closest("[data-open-gallery-sku]");
      if (galleryButton) {
        openProductImageGallery(galleryButton.dataset.openGallerySku, galleryButton.dataset.openGalleryMode);
        return;
      }
      const imageButton = event.target.closest("[data-open-image]");
      if (imageButton) {
        openImageLightbox({
          src: imageButton.dataset.openImage,
          title: imageButton.dataset.imageTitle,
          caption: imageButton.dataset.imageCaption,
        });
        return;
      }
      const rowVersionButton = event.target.closest("[data-row-plain-version]");
      if (rowVersionButton) {
        savePlainImageRowVersionSelection(
          rowVersionButton.dataset.rowPlainVersion,
          rowVersionButton.dataset.version
        );
        return;
      }
      const versionButton = event.target.closest("[data-plain-image-version]");
      if (versionButton) {
        savePlainImageVersionSelection(
          versionButton.dataset.plainImageVersion,
          versionButton.dataset.angleIndex,
          versionButton.dataset.version
        );
        return;
      }
      const aiImageSubmit = event.target.closest("[data-ai-image-submit]");
      if (aiImageSubmit) {
        requestPlainImageAiEdit(
          aiImageSubmit.dataset.aiImageSubmit,
          aiImageSubmit.dataset.angleIndex,
          aiImageSubmit.dataset.version
        );
        return;
      }
      const aiReferenceClear = event.target.closest("[data-ai-image-reference-clear]");
      if (aiReferenceClear) {
        clearAiReferenceUpload(
          aiReferenceClear.dataset.aiImageReferenceClear,
          aiReferenceClear.dataset.angleIndex,
          aiReferenceClear.dataset.version
        );
        return;
      }
      if (event.target.closest("[data-table-usd], button, a, input, select, textarea, label")) return;
      const row = event.target.closest("[data-sku]");
      if (!row) return;
      state.selectedSku = row.dataset.sku;
      render();
      if (!state.detailPanelCollapsed) document.getElementById("design")?.scrollIntoView({ block: "nearest" });
    });
  }

  applyReferenceCopy();
  bindEvents();
  syncActiveNav();
  loadState();
  loadExchangeRate(false);
  window.setInterval(() => loadExchangeRate(false), EXCHANGE_RATE_REFRESH_MS);
})();
