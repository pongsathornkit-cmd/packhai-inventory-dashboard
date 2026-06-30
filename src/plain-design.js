(function () {
  const embedded = window.__PLAIN_DESIGN__ || {};
  const state = {
    products: embedded.products || [],
    statusOptions: embedded.statusOptions || [],
    categoryOptions: embedded.categoryOptions || [],
    assetGroups: embedded.assetGroups || [],
    selectedSku: "",
    query: "",
    category: "all",
    status: "all",
    saving: false,
  };

  const $ = (id) => document.getElementById(id);
  const fmtQty = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const fmtMoney = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  async function loadState() {
    try {
      const payload = await api("/api/plain-design/state");
      state.products = payload.products || state.products;
      state.statusOptions = payload.statusOptions || state.statusOptions;
      state.categoryOptions = payload.categoryOptions || state.categoryOptions;
      state.assetGroups = payload.assetGroups || state.assetGroups;
      state.selectedSku = state.selectedSku || state.products[0]?.sku || "";
    } catch (error) {
      showMessage(`ใช้ข้อมูล fallback: ${error.message}`, true);
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
    const totalQty = state.products.reduce((sum, product) => sum + Number(product.orderQuantity || 0), 0);
    const totalValue = state.products.reduce((sum, product) => sum + Number(product.orderQuantity || 0) * Number(product.ktwPrice || 0), 0);
    const ready = state.products.filter((product) => product.status === "factory_ready").length;
    const linked = state.products.filter((product) => product.packhai?.matched).length;
    const missingFiles = state.products.filter((product) => completion(product).completed < state.assetGroups.length).length;
    $("linkedCount").textContent = `${linked}/${state.products.length} SKU matched`;
    $("summary").innerHTML = [
      ["SKU", `${fmtQty.format(state.products.length)} รายการ`],
      ["จำนวนสั่งรวม", `${fmtQty.format(totalQty)} ใบ`],
      ["มูลค่า KTW", fmtMoney.format(totalValue)],
      ["พร้อมส่งโรงงาน", `${fmtQty.format(ready)} SKU`],
      ["ยังขาดไฟล์", `${fmtQty.format(missingFiles)} SKU`],
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
          const packhai = product.packhai || {};
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
              <td class="num">${fmtMoney.format(product.ktwPrice || 0)}</td>
              <td class="num">${fmtQty.format(product.orderQuantity || 0)}</td>
              <td>${packhai.matched ? `${fmtQty.format(packhai.quantity || 0)} ชิ้น` : "ยังไม่เจอ"}</td>
              <td><span class="status-badge ${escapeHtml(status.tone || "")}">${escapeHtml(status.label)}</span></td>
              <td>
                <div class="completion"><span style="width:${done.percent}%"></span></div>
                <small>${done.completed}/${done.total}</small>
              </td>
            </tr>`;
        }).join("")
      : `<tr><td class="empty-state" colspan="6">ไม่พบสินค้า</td></tr>`;
  }

  function fileSize(value) {
    const size = Number(value || 0);
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderDetail() {
    const product = selectedProduct();
    if (!product) {
      $("design").innerHTML = `<div class="empty-state">เลือกสินค้าเพื่อดูรายละเอียด</div>`;
      return;
    }
    const status = statusMeta(product.status);
    const packhai = product.packhai || {};
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
          <small>จำนวนสั่ง ${fmtQty.format(product.orderQuantity || 0)} ใบ</small>
          <a href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noreferrer">เปิดหน้า KTW</a>
        </div>
      </div>
      <div class="packhai-card">
        <div>
          <span>Packhai Stock Link</span>
          <strong>${packhai.matched ? `${fmtQty.format(packhai.quantity || 0)} ชิ้น` : "ไม่พบ SKU"}</strong>
          <small>${packhai.matched ? `${fmtQty.format(packhai.stockRows || 0)} แถวคลัง ยท ${fmtMoney.format(packhai.inventoryValue || 0)}` : "พร้อมเชื่อมเมื่อ Packhai มี SKU นี้"}</small>
          <a href="${escapeHtml(packhai.url || `../#inventory-detail?sku=${encodeURIComponent(product.sku)}`)}">ค้นใน Packhai</a>
        </div>
      </div>
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
    $("detailStatus").addEventListener("change", (event) => updateProduct(product.sku, { status: event.target.value }));
    $("saveNotes").addEventListener("click", () => updateProduct(product.sku, { notes: $("detailNotes").value }));
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

  async function updateProduct(sku, updates) {
    try {
      state.saving = true;
      const updated = await api("/api/plain-design/product", {
        method: "POST",
        body: JSON.stringify({ sku, ...updates }),
      });
      state.products = state.products.map((product) => product.sku === sku ? { ...product, ...updated } : product);
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
