(function () {
  const embedded = window.__PLAIN_DESIGN__ || {};
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
    };
  }

  async function loadState() {
    try {
      const payload = await api("/api/plain-design/state");
      state.products = (payload.products || state.products).map(normalizeProduct);
      state.statusOptions = payload.statusOptions || state.statusOptions;
      state.categoryOptions = payload.categoryOptions || state.categoryOptions;
      state.assetGroups = payload.assetGroups || state.assetGroups;
      state.selectedSku = state.selectedSku || state.products[0]?.sku || "";
    } catch (error) {
      showMessage(`ใช้ข้อมูล fallback: ${error.message}`, true);
      state.products = state.products.map(normalizeProduct);
      state.selectedSku = state.selectedSku || state.products[0]?.sku || "";
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

  function lineCalc(product, discountPercent = state.fastCargoDiscount) {
    const qty = numberValue(product.orderQuantity);
    const purchaseUnitCost = numberValue(product.purchaseUnitCost || product.ktwPrice);
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

  function billCalc() {
    const lines = state.products
      .map((product) => ({ product, calc: lineCalc(product) }))
      .filter((line) => line.calc.qty > 0);
    return lines.reduce(
      (total, line) => {
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
    const completed = state.assetGroups.filter((group) => assetsFor(product, group.id).length > 0).length;
    const total = Math.max(1, state.assetGroups.length);
    return { completed, total, percent: Math.round((completed / total) * 100) };
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
                <strong>${fmtMoney.format(calc.purchaseUnitCost)}</strong>
                <small>ขาย ${fmtMoney.format(calc.saleUnitPrice)}</small>
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
            <span>อิงหลัก Momocargo แล้วหัก Fast Cargo ${fmtQty.format(state.fastCargoDiscount)}%</span>
          </div>
          <button class="ghost-button" id="saveCommercial" type="button">บันทึกตัวเลข</button>
        </div>
        <div class="calc-grid">
          ${numberInput("orderQuantity", "จำนวนสั่ง", fieldValue(product, "orderQuantity"), "1")}
          ${numberInput("purchaseUnitCost", "ต้นทุน/ชิ้น", fieldValue(product, "purchaseUnitCost"), "0.01")}
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
        ${state.assetGroups.map((group) => renderUploadGroup(product, group)).join("")}
      </div>`;
    bindDetailEvents(product);
  }

  function numberInput(id, label, value, step) {
    return `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input id="${escapeHtml(id)}" type="number" min="0" step="${escapeHtml(step)}" value="${escapeHtml(value)}" />
      </label>`;
  }

  function renderCalcResult(calc) {
    return [
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
    return {
      orderQuantity: numberValue($("orderQuantity")?.value),
      purchaseUnitCost: numberValue($("purchaseUnitCost")?.value),
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
    $("itemCalculator").addEventListener("input", () => {
      updateLocalProduct(product.sku, collectCommercialFields());
      const nextProduct = selectedProduct();
      $("itemCalcResult").innerHTML = renderCalcResult(lineCalc(nextProduct));
      renderStats();
      renderTable();
      renderPoPanel();
    });
    $("cargoMode").addEventListener("change", () => {
      updateLocalProduct(product.sku, collectCommercialFields());
      renderDetail();
      renderStats();
      renderTable();
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

  function renderPoPanel() {
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
              <th class="num">ต้นทุน/ชิ้น</th>
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

  function bindPoEvents() {
    $("printPo")?.addEventListener("click", () => window.print());
    $("fastCargoDiscount")?.addEventListener("input", (event) => {
      state.fastCargoDiscount = clamp(event.target.value, 0, 100);
      localStorage.setItem("plainFastCargoDiscount", String(state.fastCargoDiscount));
      renderStats();
      renderTable();
      renderDetail();
      renderPoPanel();
    });
    [["poNumber", "plainPoNumber"], ["poDate", "plainPoDate"], ["supplierName", "plainSupplierName"]].forEach(([id, key]) => {
      $(id)?.addEventListener("input", (event) => {
        state[id] = event.target.value;
        localStorage.setItem(key, event.target.value);
      });
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
    renderTable();
    renderDetail();
    renderPoPanel();
  }

  function bindEvents() {
    $("refreshState").addEventListener("click", loadState);
    $("searchInput").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderTable();
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

  bindEvents();
  loadState();
})();
