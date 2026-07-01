(function () {
  const embedded = window.__PLAIN_DESIGN__ || {};
  const EXCHANGE_RATE_REFRESH_MS = 5 * 60 * 1000;
  const PURCHASE_ORDERS_STORAGE_KEY = "plainPurchaseOrdersV2";
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    return {
      ...product,
      orderQuantity: numberValue(product.orderQuantity),
      purchaseUnitCostUsd: numberValue(product.purchaseUnitCostUsd),
      purchaseUnitCost: numberValue(product.purchaseUnitCost || ktwPrice),
      saleUnitPrice: numberValue(product.saleUnitPrice || ktwPrice),
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
    refreshPoRealtime();
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
    const usd = numberValue(product.purchaseUnitCostUsd);
    const rate = numberValue(state.exchangeRate.rate);
    if (usd > 0 && rate > 0) return moneyValue(usd * rate);
    return numberValue(product.purchaseUnitCost || product.ktwPrice);
  }

  function displayPurchaseUnitCostUsd(product) {
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

  function assetTarget(product, groupId) {
    if (groupId === "product_images") return Math.max(1, ktwImagesFor(product).length || 0);
    return groupId === "factory_files" ? 2 : 2;
  }

  function assetProgress(product, groupId) {
    const count = assetsFor(product, groupId).length;
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

  function renderPlainImagePane(asset, index) {
    if (!asset) {
      return `
        <label class="image-compare-empty" for="product_images-input">
          <strong>รอรูป PLAIN</strong>
          <span>อัปโหลดรูปมุมที่ ${fmtQty.format(index + 1)}</span>
        </label>`;
    }
    return `
      <a class="image-compare-image" href="${escapeHtml(asset.publicUrl)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(asset.publicUrl)}" alt="${escapeHtml(asset.fileName)}" loading="lazy" />
      </a>`;
  }

  function renderImageComparison(product) {
    const ktwImages = ktwImagesFor(product);
    const plainImages = assetsFor(product, "product_images");
    const progress = assetProgress(product, "product_images");
    const pairs = ktwImages.map((ktwImage, index) => ({ ktwImage, plainImage: plainImages[index] || null }));
    const extraPlain = plainImages.slice(ktwImages.length);
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
                  <a class="image-compare-image" href="${escapeHtml(ktwImage.url)}" target="_blank" rel="noreferrer">
                    <img src="${escapeHtml(ktwImage.url)}" alt="${escapeHtml(ktwImage.alt || product.name)}" loading="lazy" />
                  </a>
                </div>
                <div class="compare-pane">
                  <span>PLAIN</span>
                  ${renderPlainImagePane(plainImage, index)}
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

  function renderProductTableHead() {
    const header = document.querySelector(".product-table thead tr");
    if (!header) return;
    header.innerHTML = `
      <th>ลำดับ</th>
      <th>รูปสินค้า</th>
      <th>SKU</th>
      <th>ชื่อสินค้า</th>
      <th class="num">ราคา KTW</th>
      <th class="num">จำนวนสั่งซื้อ</th>
      <th>สถานะรีดีไซน์</th>
      <th class="num">รูปสินค้า</th>
      <th class="num">รูปแพคเกจจิ้ง</th>
      <th class="num">ไฟล์โรงงาน</th>`;
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
    const ready = state.products.filter((product) => product.status === "factory_ready").length;
    const linked = state.products.filter((product) => product.packhai?.matched).length;
    $("linkedCount").textContent = `${linked}/${state.products.length} SKU matched`;
    $("summary").innerHTML = [
      ["SKU", `${fmtQty.format(state.products.length)} รายการ`],
      ["จำนวนสั่งรวม", `${fmtQty.format(bill.qty)} ชิ้น`],
      ["ยอดสั่งซื้อทั้งบิล", fmtMoney.format(bill.totalCost)],
      ["ยอดขายคาดการณ์", fmtMoney.format(bill.revenueTotal)],
      ["กำไรรวมทั้งบิล", fmtMoney.format(bill.profitTotal)],
      ["พร้อมส่งโรงงาน", `${fmtQty.format(ready)} SKU`],
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

  function renderTrackerTable() {
    const rows = filteredProducts();
    renderProductTableHead();
    $("tableSubtitle").textContent = `รวม ${fmtQty.format(rows.length)} จาก ${fmtQty.format(state.products.length)} รายการ`;
    $("productRows").innerHTML = rows.length
      ? rows.map((product, index) => {
          const status = statusMeta(product.status);
          const calc = lineCalc(product);
          return `
            <tr class="${product.sku === state.selectedSku ? "selected" : ""}" data-sku="${escapeHtml(product.sku)}">
              <td class="row-index">${fmtQty.format(index + 1)}</td>
              <td class="product-image-cell">
                <img class="table-product-image" src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />
              </td>
              <td><strong class="sku-code">${escapeHtml(product.sku)}</strong></td>
              <td>
                <span class="table-product-name">${escapeHtml(product.name)}</span>
                <small>${escapeHtml(categoryLabel(product.category))} · ${fmtUsd.format(calc.purchaseUnitCostUsd)} / ${fmtMoney.format(calc.purchaseUnitCost)}</small>
              </td>
              <td class="num"><strong>${fmtMoney.format(product.ktwPrice || 0)}</strong></td>
              <td class="num"><strong>${fmtQty.format(calc.qty)}</strong><small>ใบ</small></td>
              <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
              <td class="num">${assetPill(product, "product_images")}</td>
              <td class="num">${assetPill(product, "packaging_images")}</td>
              <td class="num">${assetPill(product, "factory_files")}</td>
            </tr>`;
        }).join("")
      : `<tr><td class="empty-state" colspan="10">ไม่พบสินค้า</td></tr>`;
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
        <span>${escapeHtml(status.label)}</span>
      </div>
      <section class="detail-product-card">
        <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" />
        <div>
          <span>SKU</span>
          <strong>${escapeHtml(product.sku)}</strong>
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
      <div class="upload-stack" id="factory">
        ${state.assetGroups.map((group) => renderDesignUploadGroup(product, group)).join("")}
      </div>
      ${renderImageComparison(product)}
      <section class="source-card ktw-reference">
        <img src="${escapeHtml(product.sourceImageUrl)}" alt="${escapeHtml(product.name)}" />
        <div>
          <span>ข้อมูลอ้างอิงจาก KTW</span>
          <strong>${fmtMoney.format(product.ktwPrice || 0)}</strong>
          <small>จำนวนสั่งซื้อ ${fmtQty.format(product.orderQuantity || 0)} ใบ</small>
          <small>${escapeHtml(shippingMeasureSummary(product))}</small>
          <a href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noreferrer">ดูต้นฉบับจาก KTW</a>
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
    return `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input id="${escapeHtml(id)}" type="number" min="0" step="${escapeHtml(step)}" value="${escapeHtml(value)}" />
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
        : numberValue(product.purchaseUnitCost || product.ktwPrice);
    return {
      orderQuantity: numberValue($("orderQuantity")?.value),
      purchaseUnitCostUsd,
      purchaseUnitCost,
      saleUnitPrice: numberValue($("saleUnitPrice")?.value),
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

  function bindDetailEvents(product) {
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
    document.querySelectorAll("[data-delete-asset]").forEach((button) => {
      button.addEventListener("click", () => deleteAsset(product.sku, button.dataset.deleteAsset));
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

  function syncActiveNav() {
    const activeHash = window.location.hash || "#products";
    document.querySelectorAll(".plain-nav a").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === activeHash);
    });
  }

  function applyReferenceCopy() {
    const title = document.querySelector(".topbar h1");
    if (title) title.textContent = "งานออกแบบรีดีไซน์สินค้า PLAIN (KTW Source)";
    const navLabels = ["รายการสินค้า", "งานออกแบบ", "ใบสั่งซื้อ", "ไฟล์โรงงาน", "สรุปสถานะ"];
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
    return bill.tableRows.map(({ product, calc }) => `
      <tr data-po-row="${escapeHtml(product.sku)}" class="${calc.qty <= 0 ? "line-muted" : ""}">
        <td><strong>${escapeHtml(product.sku)}</strong></td>
        <td>${escapeHtml(product.name)}<small>${escapeHtml(calc.rate.modeLabel)} | ${escapeHtml(calc.rate.label)} | ฐาน ${calc.chargeBasis}</small></td>
        <td class="num">
          <input class="po-qty-input" data-po-qty="${escapeHtml(product.sku)}" type="number" min="0" step="1" inputmode="numeric" value="${calc.qty > 0 ? escapeHtml(calc.qty) : ""}" placeholder="0" />
        </td>
        <td class="num" data-po-cell="purchaseUnitCostUsd">${fmtUsd.format(calc.purchaseUnitCostUsd)}</td>
        <td class="num" data-po-cell="purchaseUnitCost">${fmtMoney.format(calc.purchaseUnitCost)}</td>
        <td class="num" data-po-cell="shippingUnit">${fmtMoney.format(calc.shippingUnit)}</td>
        <td class="num" data-po-cell="totalCost">${fmtMoney.format(calc.totalCost)}</td>
        <td class="num" data-po-cell="revenueTotal">${fmtMoney.format(calc.revenueTotal)}</td>
        <td class="num ${calc.profitTotal < 0 ? "danger-text" : "good-text"}" data-po-cell="profitTotal">${fmtMoney.format(calc.profitTotal)}</td>
      </tr>`).join("");
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
      const cells = {
        purchaseUnitCostUsd: fmtUsd.format(calc.purchaseUnitCostUsd),
        purchaseUnitCost: fmtMoney.format(calc.purchaseUnitCost),
        shippingUnit: fmtMoney.format(calc.shippingUnit),
        totalCost: fmtMoney.format(calc.totalCost),
        revenueTotal: fmtMoney.format(calc.revenueTotal),
        profitTotal: fmtMoney.format(calc.profitTotal),
      };
      Object.entries(cells).forEach(([name, value]) => {
        const cell = row.querySelector(`[data-po-cell="${name}"]`);
        if (cell) cell.textContent = value;
      });
      const profitCell = row.querySelector('[data-po-cell="profitTotal"]');
      if (profitCell) {
        profitCell.classList.toggle("danger-text", calc.profitTotal < 0);
        profitCell.classList.toggle("good-text", calc.profitTotal >= 0);
      }
    });
  }

  function renderPoPanel() {
    const order = activePurchaseOrder() || makePurchaseOrder(plannedOrderLines());
    const bill = billCalc(order);
    $("purchase-order").innerHTML = `
      <div class="section-heading">
        <div>
          <h2>ระบบใบสั่งซื้อ</h2>
          <span>แยกเป็นแต่ละบิล แก้จำนวนแล้วคำนวณยอดรวม ต้นทุน ค่าขนส่ง และกำไรแบบ Realtime</span>
        </div>
        <div class="po-actions">
          <button class="secondary-button" id="newPurchaseOrder" type="button">+ สร้างบิลใหม่</button>
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
          <div class="table-wrap">
            <table class="po-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>รายการ</th>
                  <th class="num">จำนวนในบิล</th>
                  <th class="num">ต้นทุน USD</th>
                  <th class="num">ต้นทุน THB</th>
                  <th class="num">ขนส่ง/ชิ้น</th>
                  <th class="num">ต้นทุนรวม</th>
                  <th class="num">ยอดขายรวม</th>
                  <th class="num">กำไรรวม</th>
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
    document.querySelectorAll("#purchase-order [data-refresh-exchange]").forEach((button) => {
      button.addEventListener("click", () => loadExchangeRate(true));
    });
    $("poBillList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-po-bill]");
      if (button) setActivePurchaseOrder(button.dataset.poBill);
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
      if (input) updateActivePurchaseOrderLine(input.dataset.poQty, input.value);
    });
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

  async function uploadFiles(sku, group, files) {
    if (!files.length) return;
    try {
      showMessage(`กำลังอัปโหลด ${files.length} ไฟล์`);
      const payloadFiles = await Promise.all(files.map(readFileAsDataUrl));
      const created = await api("/api/plain-design/upload", {
        method: "POST",
        body: JSON.stringify({ sku, group, files: payloadFiles }),
      });
      state.products = state.products.map((product) => {
        if (product.sku !== sku) return product;
        return { ...product, assets: [...created, ...(product.assets || [])] };
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
    $("productRows").addEventListener("click", (event) => {
      const row = event.target.closest("[data-sku]");
      if (!row) return;
      state.selectedSku = row.dataset.sku;
      render();
      document.getElementById("design")?.scrollIntoView({ block: "nearest" });
    });
  }

  applyReferenceCopy();
  bindEvents();
  syncActiveNav();
  loadState();
  loadExchangeRate(false);
  window.setInterval(() => loadExchangeRate(false), EXCHANGE_RATE_REFRESH_MS);
})();
