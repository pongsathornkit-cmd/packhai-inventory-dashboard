(function () {
  const data = window.__PACKHAI_DASHBOARD__;
  const rows = data.rows || [];
  let stockRows = rows.filter((row) => Number(row.quantity || 0) > 0);
  const websiteStockTransactions = data.websiteStockTransactions || [];
  const supabaseConfig = window.__PACKHAI_SUPABASE__ || {};
  let stockMovementRows = data.stockMovements || [];
  const stockMovementsByStockShopId = new Map();
  let stockMovementLoadState = stockMovementRows.length ? "loaded" : "idle";
  let stockMovementLoadError = "";
  let stockMovementLoadPromise = null;
  let activeDetailRow = null;
  let activeStockAdjustRow = null;
  const rowByDetailId = new Map();
  const detailIdByIdentity = new Map();
  function productIdentity(row) {
    return [
      row?.stockSource || "",
      row?.warehouseId ?? "",
      row?.rowNo ?? "",
      row?.sku || "",
      row?.quantity ?? "",
      row?.inventoryValue ?? "",
    ].join("|");
  }
  rows.forEach((row, index) => {
    row.detailId = `item-${index}`;
    rowByDetailId.set(row.detailId, row);
    detailIdByIdentity.set(productIdentity(row), row.detailId);
  });
  const pageSize = 50;
  const state = {
    query: "",
    source: "All",
    warehouse: "All",
    sort: "valueDesc",
    page: 1,
  };

  const sourceColors = {
    Shopee: "Shopee",
    Lazada: "Lazada",
    KTW: "KTW",
    Missing: "Missing",
  };

  const fmtInt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const fmtQty = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  const fmtBaht = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  });
  const fmtBaht2 = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const fmtPercent = new Intl.NumberFormat("th-TH", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function productImage(row, variant = "table") {
    const label = `รูปสินค้า ${row.sku || row.name || ""}`.trim();
    if (!row.imageUrl) {
      return `<div class="product-thumb ${variant} missing" aria-label="ไม่มีรูป"></div>`;
    }
    return `
      <div class="product-thumb ${variant}" title="${escapeHtml(row.imageSource || row.priceSource || "")}">
        <img src="${escapeHtml(row.imageUrl)}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('missing'); this.remove();" />
      </div>`;
  }

  function compactText(value) {
    return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function sourceLabel(source) {
    if (source === "Shopee") return "Shopee";
    if (source === "Lazada") return "Lazada";
    if (source === "KTW") return "KTW";
    return "ไม่พบราคา";
  }

  function safePercent(value) {
    return Number.isFinite(value) ? fmtPercent.format(value) : "0.0%";
  }

  function normalizeSkuValue(value) {
    return String(value || "").trim().replace(/^'+/, "").replace(/\.0$/, "").toUpperCase();
  }

  function numberValue(value) {
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[,\s]|THB/gi, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function moneyValue(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function rowInventoryValue(row) {
    const quantity = numberValue(row.quantity);
    const price = numberValue(row.price);
    return moneyValue(quantity * price);
  }

  function refreshDerivedInventoryData() {
    rows.forEach((row) => {
      row.quantity = numberValue(row.quantity);
      row.waiting = numberValue(row.waiting);
      row.waitImport = numberValue(row.waitImport);
      row.available = numberValue(row.available ?? row.quantity);
      row.stockForValue = row.quantity;
      row.inventoryValue = rowInventoryValue(row);
      row.availableValue = moneyValue(row.available * numberValue(row.price));
      row.waitingValue = moneyValue(row.waiting * numberValue(row.price));
    });
    stockRows = rows.filter((row) => Number(row.quantity || 0) > 0);

    const sourceMap = new Map();
    const warehouseMap = new Map();
    for (const row of rows) {
      const quantity = numberValue(row.quantity);
      const value = numberValue(row.inventoryValue);
      const price = numberValue(row.price);
      const source = row.priceSource || "Missing";
      const warehouseId = row.warehouseId ?? "";
      const warehouseGroupKey = warehouseKey(row);

      if (!sourceMap.has(source)) {
        sourceMap.set(source, {
          source,
          rowCount: 0,
          positiveStockRows: 0,
          valuedPositiveRows: 0,
          quantity: 0,
          value: 0,
        });
      }
      const sourceItem = sourceMap.get(source);
      sourceItem.rowCount += 1;
      sourceItem.quantity += quantity;
      sourceItem.value += value;
      if (quantity > 0) sourceItem.positiveStockRows += 1;
      if (quantity > 0 && price > 0) sourceItem.valuedPositiveRows += 1;

      if (!warehouseMap.has(warehouseGroupKey)) {
        warehouseMap.set(warehouseGroupKey, {
          stockSource: row.stockSource || "",
          warehouseId,
          warehouseName: row.warehouseName || row.stockSourceLabel || row.stockSource || "-",
          stockSourceLabel: row.stockSourceLabel || row.stockSource || "",
          rowCount: 0,
          positiveStockRows: 0,
          quantity: 0,
          value: 0,
        });
      }
      const warehouseItem = warehouseMap.get(warehouseGroupKey);
      warehouseItem.rowCount += 1;
      warehouseItem.quantity += quantity;
      warehouseItem.value += value;
      if (quantity > 0) warehouseItem.positiveStockRows += 1;
    }

    const positiveStockRows = stockRows.length;
    const valuedPositiveRows = stockRows.filter((row) => numberValue(row.price) > 0).length;
    const totalQuantity = stockRows.reduce((sum, row) => sum + numberValue(row.quantity), 0);
    const totalInventoryValue = stockRows.reduce((sum, row) => sum + numberValue(row.inventoryValue), 0);
    const totalWaiting = stockRows.reduce((sum, row) => sum + numberValue(row.waiting), 0);
    const totalWaitingValue = stockRows.reduce((sum, row) => sum + numberValue(row.waitingValue), 0);
    const missingRows = stockRows.filter((row) => numberValue(row.price) <= 0);

    data.summary = {
      ...(data.summary || {}),
      totalRows: rows.length,
      positiveStockRows,
      valuedPositiveRows,
      missingPositiveRows: missingRows.length,
      totalQuantity,
      totalInventoryValue: moneyValue(totalInventoryValue),
      totalWaiting,
      totalWaitingValue: moneyValue(totalWaitingValue),
    };
    data.sourceBreakdown = [...sourceMap.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity);
    data.warehouseBreakdown = [...warehouseMap.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity);
    data.topProducts = [...stockRows]
      .sort((a, b) => numberValue(b.inventoryValue) - numberValue(a.inventoryValue) || numberValue(b.quantity) - numberValue(a.quantity))
      .slice(0, 30);
  }

  function getOwnerAnalytics() {
    const summary = data.summary || {};
    const totalValue =
      Number(summary.totalInventoryValue || 0) ||
      stockRows.reduce((sum, row) => sum + Number(row.inventoryValue || 0), 0);
    const positiveRows = Number(summary.positiveStockRows || stockRows.length || 0);
    const valuedRows = Number(summary.valuedPositiveRows || 0);
    const coverage = positiveRows ? valuedRows / positiveRows : 0;
    const topRows = [...stockRows].sort((a, b) => b.inventoryValue - a.inventoryValue || b.quantity - a.quantity);
    const top10Value = topRows.slice(0, 10).reduce((sum, row) => sum + Number(row.inventoryValue || 0), 0);
    const top10Share = totalValue ? top10Value / totalValue : 0;
    const top1Value = topRows[0]?.inventoryValue || 0;
    const top1Share = totalValue ? top1Value / totalValue : 0;
    const missingSource = (data.sourceBreakdown || []).find((item) => item.source === "Missing") || {};
    const warehouses = data.warehouseBreakdown || [];
    const mainWarehouse = warehouses.reduce((max, item) => (Number(item.value || 0) > Number(max.value || 0) ? item : max), warehouses[0] || {});
    const mainWarehouseShare = totalValue ? Number(mainWarehouse.value || 0) / totalValue : 0;
    const waitingValue =
      Number(summary.totalWaitingValue || 0) ||
      stockRows.reduce((sum, row) => sum + Number(row.waitingValue || 0), 0);
    const waitingQty =
      Number(summary.totalWaiting || 0) || stockRows.reduce((sum, row) => sum + Number(row.waiting || 0), 0);
    const avgValuePerSku = positiveRows ? totalValue / positiveRows : 0;
    return {
      totalValue,
      positiveRows,
      valuedRows,
      coverage,
      topRows,
      top10Value,
      top10Share,
      top1Value,
      top1Share,
      missingRows: Number(missingSource.positiveStockRows || 0),
      missingQty: Number(missingSource.quantity || 0),
      mainWarehouse,
      mainWarehouseShare,
      waitingValue,
      waitingQty,
      avgValuePerSku,
    };
  }

  function warehouseKey(item) {
    const warehouseId = item?.warehouseId ?? item?.warehouseName ?? "";
    return `${item?.stockSource || ""}|${warehouseId}`;
  }

  function warehouseLabel(item) {
    return item?.warehouseName || item?.stockSourceLabel || item?.stockSource || "-";
  }

  function selectedWarehouseLabel() {
    if (state.warehouse === "All") return "ทุกคลัง";
    const selected = (data.warehouseBreakdown || []).find((item) => warehouseKey(item) === state.warehouse);
    return warehouseLabel(selected);
  }

  function supabaseDirectConfigured() {
    return Boolean(
      supabaseConfig?.directWebsiteStock &&
        String(supabaseConfig.url || "").trim() &&
        String(supabaseConfig.anonKey || "").trim()
    );
  }

  function supabaseRpcUrl(functionName) {
    return `${String(supabaseConfig.url || "").replace(/\/+$/, "")}/rest/v1/rpc/${functionName}`;
  }

  async function callSupabaseRpc(functionName, body) {
    const key = String(supabaseConfig.anonKey || "").trim();
    const response = await fetch(supabaseRpcUrl(functionName), {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || payload.hint || payload.details || `Supabase status ${response.status}`);
    }
    return payload;
  }

  function websiteStockKey(sku, warehouseId) {
    return `${normalizeSkuValue(sku)}|${String(warehouseId || "")}`;
  }

  function fallbackWebsiteWarehouseName(warehouseId) {
    if (String(warehouseId) === "491661") return "\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08";
    if (String(warehouseId) === "491662") return "\u0e04\u0e25\u0e31\u0e07 \u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c";
    return `Warehouse ${warehouseId}`;
  }

  function findWebsiteStockRow(sku, warehouseId) {
    const key = websiteStockKey(sku, warehouseId);
    return rows.find((row) => isWebsiteStockWarehouse(row) && websiteStockKey(row.sku, row.warehouseId) === key);
  }

  function upsertWebsiteStockRow(item) {
    const sku = normalizeSkuValue(item.sku);
    const warehouseId = item.warehouseId ?? item.warehouse_id;
    if (!sku || !warehouseId) return null;
    const existing = findWebsiteStockRow(sku, warehouseId);
    const template = existing || rows.find((row) => normalizeSkuValue(row.sku) === sku) || {};
    const row =
      existing ||
      {
        ...template,
        detailId: "",
        sku,
        stockSource: "Website Stock",
        stockSourceLabel: "Website Stock",
        warehouseId,
        warehouseName: item.warehouseName || fallbackWebsiteWarehouseName(warehouseId),
        latestStockMovementAt: "",
        latestStockMovementAtLabel: "",
        latestStockMovementType: "",
        latestStockMovementDescription: "",
        latestStockMovementReferenceNo: "",
      };

    row.sku = sku;
    row.name = item.name || template.name || sku;
    row.barcode = item.barcode ?? template.barcode ?? "";
    row.prop = item.prop ?? template.prop ?? "";
    row.productId = item.productId ?? template.productId ?? "";
    row.productMasterId = item.productMasterId ?? template.productMasterId ?? "";
    row.stockSource = "Website Stock";
    row.stockSourceLabel = "Website Stock";
    row.warehouseId = warehouseId;
    row.warehouseName = item.warehouseName || row.warehouseName || fallbackWebsiteWarehouseName(warehouseId);
    row.quantity = numberValue(item.quantity);
    row.waiting = numberValue(item.waiting);
    row.waitImport = numberValue(item.waitImport ?? item.wait_import);
    row.available = numberValue(item.available ?? item.quantity);
    row.stockForValue = row.quantity;
    row.manualUpdateNote = item.manualUpdateNote || item.manual_update_note || "";
    row.lastTransactionId = item.lastTransactionId || item.last_transaction_id || "";
    row.sourceRef = item.source || row.sourceRef || "";
    row.updatedAt = item.updatedAt || item.updated_at || row.updatedAt || "";
    row.inventoryValue = rowInventoryValue(row);
    row.availableValue = moneyValue(row.available * numberValue(row.price));
    row.waitingValue = moneyValue(row.waiting * numberValue(row.price));

    if (!existing) rows.push(row);
    return row;
  }

  function normalizeWebsiteStockTransaction(item) {
    const warehouseId = item.warehouseId ?? item.warehouse_id;
    return {
      id: String(item.id || ""),
      createdAt: item.createdAt || item.created_at || "",
      sku: normalizeSkuValue(item.sku),
      warehouseId,
      warehouseName: item.warehouseName || item.warehouse_name || fallbackWebsiteWarehouseName(warehouseId),
      operation: item.operation || "set",
      beforeQuantity: numberValue(item.beforeQuantity ?? item.before_quantity),
      inputQuantity: numberValue(item.inputQuantity ?? item.input_quantity),
      afterQuantity: numberValue(item.afterQuantity ?? item.after_quantity),
      deltaQuantity: numberValue(item.deltaQuantity ?? item.delta_quantity),
      actor: item.actor || "Website",
      note: item.note || "",
      sourceText: item.sourceText || item.source_text || "",
      source: item.source || "Website Stock",
    };
  }

  function mergeWebsiteStockSnapshot(snapshot) {
    const liveRows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const seen = new Set();
    liveRows.forEach((item) => {
      const row = upsertWebsiteStockRow(item);
      if (row) seen.add(websiteStockKey(row.sku, row.warehouseId));
    });
    rows.forEach((row) => {
      if (!isWebsiteStockWarehouse(row)) return;
      if (seen.has(websiteStockKey(row.sku, row.warehouseId))) return;
      row.quantity = 0;
      row.available = 0;
      row.waiting = 0;
      row.waitImport = 0;
      row.inventoryValue = 0;
      row.availableValue = 0;
      row.waitingValue = 0;
    });

    const transactions = (Array.isArray(snapshot?.stockTransactions) ? snapshot.stockTransactions : [])
      .map(normalizeWebsiteStockTransaction)
      .filter((item) => item.id && item.sku)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    websiteStockTransactions.splice(0, websiteStockTransactions.length, ...transactions);
    data.websiteStockTransactions = websiteStockTransactions;
    refreshInventoryViews();
  }

  function refreshInventoryViews() {
    refreshDerivedInventoryData();
    renderKpis();
    renderOwnerCommand();
    renderOwnerAnalytics();
    renderDecisionSignals();
    renderSourceBars();
    renderWarehouseBars();
    renderWarehouseProductGroups();
    renderTopProducts();
    renderWarehouseFilters();
    renderFilters();
    renderTable();
  }

  async function loadLiveWebsiteStockFromSupabase() {
    if (!supabaseDirectConfigured()) return false;
    const snapshot = await callSupabaseRpc("website_stock_snapshot", { p_transaction_limit: 500 });
    mergeWebsiteStockSnapshot(snapshot);
    return true;
  }

  async function saveWebsiteStockAdjustment(payload) {
    if (supabaseDirectConfigured()) {
      const result = await callSupabaseRpc("adjust_website_stock", {
        p_payload: {
          ...payload,
          createdAt: new Date().toISOString(),
        },
      });
      await loadLiveWebsiteStockFromSupabase();
      return result;
    }
    const response = await fetch(expenseApiUrl("/api/supabase-stock/adjust"), expenseFetchOptions("POST", payload));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || `Status ${response.status}`);
    return result;
  }

  function valueOrDash(value) {
    if (value == null || value === "") return "-";
    return value;
  }

  function indexStockMovements(items) {
    stockMovementsByStockShopId.clear();
    (items || []).forEach((movement) => {
      const key = String(movement.stockShopId || "");
      if (!key) return;
      if (!stockMovementsByStockShopId.has(key)) stockMovementsByStockShopId.set(key, []);
      stockMovementsByStockShopId.get(key).push(movement);
    });
    stockMovementsByStockShopId.forEach((list) => {
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    });
  }

  function stockMovementFileUrl() {
    const file = data.metadata?.sources?.packhai?.stockMovement?.file || "stock-movements.json";
    const version = encodeURIComponent(data.metadata?.generatedAt || Date.now());
    return `${file}?v=${version}`;
  }

  function loadStockMovements() {
    if (stockMovementLoadState === "loaded") return Promise.resolve(stockMovementRows);
    if (stockMovementLoadPromise) return stockMovementLoadPromise;
    stockMovementLoadState = "loading";
    stockMovementLoadPromise = fetch(stockMovementFileUrl(), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`stock movements ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        stockMovementRows = payload.rows || [];
        indexStockMovements(stockMovementRows);
        stockMovementLoadState = "loaded";
        stockMovementLoadError = "";
        return stockMovementRows;
      })
      .catch((error) => {
        stockMovementLoadState = "error";
        stockMovementLoadError = error.message || String(error);
        return [];
      });
    return stockMovementLoadPromise;
  }

  indexStockMovements(stockMovementRows);

  function detailIdForRow(row) {
    if (row.detailId) {
      if (row.isSkuGroup || !rowByDetailId.has(row.detailId)) rowByDetailId.set(row.detailId, row);
      return row.detailId;
    }
    const matchedId = detailIdByIdentity.get(productIdentity(row));
    if (matchedId) {
      row.detailId = matchedId;
      return matchedId;
    }

    const fallback = rows.find(
      (item) =>
        item.sku === row.sku &&
        item.stockSource === row.stockSource &&
        String(item.warehouseId ?? "") === String(row.warehouseId ?? "") &&
        Number(item.quantity || 0) === Number(row.quantity || 0)
    );
    if (fallback?.detailId) {
      row.detailId = fallback.detailId;
      return fallback.detailId;
    }

    const detailId = `detail-${rowByDetailId.size}`;
    row.detailId = detailId;
    rowByDetailId.set(detailId, row);
    return detailId;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return "-";
    }
  }

  function movementDateValue(row) {
    const date = new Date(row?.latestStockMovementAt || "");
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function movementAgeText(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    if (days === 0) return "วันนี้";
    return `${fmtInt.format(days)} วันที่แล้ว`;
  }

  function movementSummary(row) {
    if (!row?.latestStockMovementAt) {
      return row?.stockSource === "Packhai" ? "ยังไม่พบประวัติจาก Packhai" : "ข้อมูล movement จาก Packhai เท่านั้น";
    }
    const reference = row.latestStockMovementReferenceNo ? ` · ${row.latestStockMovementReferenceNo}` : "";
    return `${formatDateTime(row.latestStockMovementAt)} · ${row.latestStockMovementType || "ปรับยอด"}${reference}`;
  }

  function movementCell(row) {
    if (!row.latestStockMovementAt) {
      const note = row.stockSource === "Packhai" ? "ยังไม่พบประวัติ" : "เฉพาะ Packhai";
      return `
        <div class="movement-cell muted">
          <strong>-</strong>
          <span>${escapeHtml(note)}</span>
        </div>`;
    }
    const reference = row.latestStockMovementReferenceNo ? `<span>${escapeHtml(row.latestStockMovementReferenceNo)}</span>` : "";
    return `
      <div class="movement-cell">
        <strong>${escapeHtml(formatDateTime(row.latestStockMovementAt))}</strong>
        <span>${escapeHtml(`${row.latestStockMovementType || "ปรับยอด"} · ${movementAgeText(row.latestStockMovementAt)}`)}</span>
        ${reference}
      </div>`;
  }

  function stockMovementsForRow(row) {
    const key = String(row?.stockShopId || "");
    return key ? stockMovementsByStockShopId.get(key) || [] : [];
  }

  function isWebsiteStockWarehouse(row) {
    return (
      row?.stockSource === "Website Stock" &&
      (String(row.warehouseId) === "491661" || String(row.warehouseId) === "491662")
    );
  }

  function stockAdjustButton(row, className = "") {
    if (!isWebsiteStockWarehouse(row)) return "";
    return `
      <button class="stock-adjust-button ${escapeHtml(className)}" type="button" data-stock-adjust-id="${escapeHtml(
        detailIdForRow(row)
      )}" title="ปรับจำนวน stock คงเหลือ">
        ปรับ
      </button>`;
  }

  function websiteStockTransactionsForRow(row) {
    const sku = String(row?.sku || "").trim().toUpperCase();
    if (!sku) return [];
    const warehouseIds = new Set(
      row?.isSkuGroup && Array.isArray(row.warehouseRows)
        ? row.warehouseRows.filter(isWebsiteStockWarehouse).map((item) => String(item.warehouseId))
        : isWebsiteStockWarehouse(row)
        ? [String(row.warehouseId)]
        : []
    );
    return websiteStockTransactions
      .filter((item) => {
        if (String(item.sku || "").trim().toUpperCase() !== sku) return false;
        return !warehouseIds.size || warehouseIds.has(String(item.warehouseId));
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function stockOperationText(operation) {
    if (operation === "set") return "ตั้งยอด";
    if (operation === "subtract") return "ลด";
    return "เพิ่ม";
  }

  function websiteStockTransactionTable(row) {
    const transactions = websiteStockTransactionsForRow(row).slice(0, 40);
    if (!transactions.length) {
      return `
        <section class="detail-block detail-wide movement-history-block">
          <div class="movement-history-head">
            <div>
              <h3>ประวัติการปรับ Website Stock</h3>
              <p>ยังไม่มี transaction ที่บันทึกจากเว็บไซต์สำหรับ SKU นี้</p>
            </div>
            <span>0 รายการ</span>
          </div>
        </section>`;
    }
    return `
      <section class="detail-block detail-wide movement-history-block">
        <div class="movement-history-head">
          <div>
            <h3>ประวัติการปรับ Website Stock</h3>
            <p>เก็บ transaction ทุกครั้งที่ปรับยอดคงเหลือของคลัง ซ.เจริญกิจ และ สุขสวัสดิ์</p>
          </div>
          <span>${fmtInt.format(transactions.length)} รายการล่าสุด</span>
        </div>
        <div class="movement-history-table-wrap">
          <table class="movement-history-table stock-transaction-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>คลัง</th>
                <th>รายการ</th>
                <th class="num">ก่อน</th>
                <th class="num">หลัง</th>
                <th class="num">เปลี่ยน</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              ${transactions
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${escapeHtml(formatDateTime(item.createdAt))}</strong><span>${escapeHtml(item.actor || "-")}</span></td>
                      <td>${escapeHtml(item.warehouseName || "-")}</td>
                      <td>${escapeHtml(stockOperationText(item.operation))}</td>
                      <td class="num">${fmtQty.format(item.beforeQuantity || 0)}</td>
                      <td class="num">${fmtQty.format(item.afterQuantity || 0)}</td>
                      <td class="num">${fmtQty.format(item.deltaQuantity || 0)}</td>
                      <td><span>${escapeHtml(item.note || item.sourceText || "-")}</span></td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function pricePriority(row) {
    const priority = Number(row?.priceSourcePriority);
    return Number.isFinite(priority) ? priority : 99;
  }

  function bestPriceRow(items) {
    return [...items].sort((a, b) => pricePriority(a) - pricePriority(b) || Number(b.price || 0) - Number(a.price || 0))[0] || {};
  }

  function newestMovementRow(items) {
    return [...items].sort((a, b) => movementDateValue(b) - movementDateValue(a))[0] || {};
  }

  function preferredProductRow(items) {
    return (
      [...items].sort(
        (a, b) =>
          Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) ||
          Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0) ||
          movementDateValue(b) - movementDateValue(a)
      )[0] || {}
    );
  }

  function sortInventoryRows(items) {
    const sorted = [...items];
    sorted.sort((a, b) => {
      if (state.sort === "qtyDesc") return Number(b.quantity || 0) - Number(a.quantity || 0) || Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0);
      if (state.sort === "priceDesc") return Number(b.price || 0) - Number(a.price || 0) || Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0);
      if (state.sort === "movementDesc") return movementDateValue(b) - movementDateValue(a) || Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0);
      if (state.sort === "nameAsc") return String(a.name || "").localeCompare(String(b.name || ""), "th") || String(a.sku || "").localeCompare(String(b.sku || ""), "en");
      if (state.sort === "sourceAsc") return pricePriority(a) - pricePriority(b) || Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0);
      return Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0) || Number(b.quantity || 0) - Number(a.quantity || 0);
    });
    return sorted;
  }

  function aggregateSkuRows(items) {
    const groups = new Map();
    items.forEach((row) => {
      const sku = compactText(row.sku);
      const key = sku ? `sku:${sku}` : `row:${detailIdForRow(row)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    return sortInventoryRows(
      [...groups.entries()].map(([key, groupRows], index) => {
        const warehouseRows = [...groupRows].sort(
          (a, b) =>
            Number(b.quantity || 0) - Number(a.quantity || 0) ||
            Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0) ||
            warehouseLabel(a).localeCompare(warehouseLabel(b), "th")
        );
        const base = preferredProductRow(warehouseRows);
        const priceRow = bestPriceRow(warehouseRows);
        const movementRow = newestMovementRow(warehouseRows);
        const stockMovements = warehouseRows
          .flatMap((item) => stockMovementsForRow(item))
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        const sum = (field) => warehouseRows.reduce((total, row) => total + Number(row[field] || 0), 0);
        const expectedStockMovementCount = stockMovements.length || sum("stockMovementCount");
        const isGrouped = warehouseRows.length > 1;
        return {
          ...base,
          detailId: isGrouped ? `sku-group-${index}-${key.replace(/[^a-z0-9_-]/gi, "-")}` : detailIdForRow(base),
          isSkuGroup: isGrouped,
          warehouseRows,
          stockMovements,
          stockMovementCount: expectedStockMovementCount,
          stockSource: isGrouped ? "รวม" : base.stockSource,
          warehouseName: isGrouped ? `${fmtInt.format(warehouseRows.length)} คลัง` : base.warehouseName,
          stockSourceLabel: isGrouped ? `รวม ${fmtInt.format(warehouseRows.length)} คลัง` : base.stockSourceLabel,
          quantity: sum("quantity"),
          waiting: sum("waiting"),
          waitImport: sum("waitImport"),
          available: sum("available"),
          stockForValue: sum("stockForValue"),
          inventoryValue: sum("inventoryValue"),
          availableValue: sum("availableValue"),
          waitingValue: sum("waitingValue"),
          price: Number(priceRow.price || 0),
          priceSource: priceRow.priceSource || base.priceSource,
          priceSourceLabel: priceRow.priceSourceLabel || base.priceSourceLabel,
          priceSourcePriority: priceRow.priceSourcePriority ?? base.priceSourcePriority,
          priceMatchType: priceRow.priceMatchType || base.priceMatchType,
          priceCandidateCount: priceRow.priceCandidateCount ?? base.priceCandidateCount,
          sourceSku: priceRow.sourceSku || base.sourceSku,
          sourceTitle: priceRow.sourceTitle || base.sourceTitle,
          sourceUrl: priceRow.sourceUrl || base.sourceUrl,
          sourceCapturedAt: priceRow.sourceCapturedAt || base.sourceCapturedAt,
          latestStockMovementAt: movementRow.latestStockMovementAt || "",
          latestStockMovementAtLabel: movementRow.latestStockMovementAtLabel || "",
          latestStockMovementType: movementRow.latestStockMovementType || "",
          latestStockMovementDescription: movementRow.latestStockMovementDescription || "",
          latestStockMovementReferenceNo: movementRow.latestStockMovementReferenceNo || "",
          latestStockMovementReferenceNo2: movementRow.latestStockMovementReferenceNo2 || "",
          latestStockMovementChannelName: movementRow.latestStockMovementChannelName || "",
        };
      })
    );
  }

  function warehouseCell(row) {
    if (!row.isSkuGroup) {
      return `
        <td class="warehouse-cell">
          <strong>${escapeHtml(row.stockSource || "-")}</strong>
          <span>${escapeHtml(row.warehouseName || "-")}</span>
          ${stockAdjustButton(row, "inline")}
        </td>`;
    }

    return `
      <td class="warehouse-cell grouped">
        <div class="warehouse-summary">
          <strong>\u0e23\u0e27\u0e21 ${fmtQty.format(row.quantity || 0)} \u0e2b\u0e19\u0e48\u0e27\u0e22</strong>
          <span>${fmtInt.format(row.warehouseRows.length)} \u0e04\u0e25\u0e31\u0e07</span>
        </div>
        <div class="warehouse-breakdown" aria-label="\u0e08\u0e33\u0e19\u0e27\u0e19\u0e41\u0e22\u0e01\u0e04\u0e25\u0e31\u0e07">
          ${row.warehouseRows
            .map(
              (item) => `
                <span class="warehouse-chip" title="${escapeHtml(warehouseChipTitle(item))}">
                  <span>${escapeHtml(shortWarehouseName(item))}</span>
                  <strong>${fmtQty.format(item.quantity || 0)}</strong>
                  ${stockAdjustButton(item, "chip")}
                </span>
                `
            )
            .join("")}
        </div>
      </td>`;
  }

  function shortWarehouseName(item) {
    return String(item?.warehouseName || item?.stockSourceLabel || item?.stockSource || "-")
      .replace(/^\u0e04\u0e25\u0e31\u0e07\s*/u, "")
      .replace(/PACKHAI\s+\u0e1a\u0e32\u0e07\u0e43\u0e2b\u0e0d\u0e48/iu, "Packhai")
      .trim();
  }

  function warehouseChipTitle(item) {
    return `${item?.warehouseName || item?.stockSourceLabel || "-"} - ${item?.stockSource || "-"} - ${fmtQty.format(item?.quantity || 0)} \u0e2b\u0e19\u0e48\u0e27\u0e22`;
  }

  function detailWarehouseBreakdown(row) {
    if (!row.isSkuGroup || !row.warehouseRows?.length) return "";
    return `
      <div class="detail-warehouse-breakdown">
        ${row.warehouseRows
          .map(
            (item) => `
              <article>
                <span>${escapeHtml(item.stockSource || "-")}</span>
                <strong>${escapeHtml(item.warehouseName || "-")}</strong>
                <div>${fmtQty.format(item.quantity || 0)} คงเหลือ · ${fmtQty.format(item.available || 0)} พร้อมขาย</div>
                <small>${fmtBaht.format(item.inventoryValue || 0)} · ${escapeHtml(movementSummary(item))}</small>
                ${stockAdjustButton(item, "detail")}
              </article>`
          )
          .join("")}
      </div>`;
  }

  function matchLabel(value) {
    if (value === "exact") return "ตรง SKU";
    if (value === "fallback") return "จับคู่สำรอง";
    if (value === "missing") return "ไม่พบราคา";
    return valueOrDash(value);
  }

  function detailField(label, value) {
    return `
      <div class="detail-field">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(valueOrDash(value))}</strong>
      </div>`;
  }

  function detailMetric(label, value, highlight = false) {
    return `
      <article class="detail-metric ${highlight ? "highlight" : ""}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(valueOrDash(value))}</strong>
      </article>`;
  }

  function detailMovementRows(row) {
    const sourceRows = row.isSkuGroup
      ? row.stockMovements?.length
        ? row.stockMovements
        : row.warehouseRows?.flatMap((item) => stockMovementsForRow(item)) || []
      : stockMovementsForRow(row);
    const seen = new Set();
    return sourceRows
      .filter(Boolean)
      .filter((movement) => {
        const key = [
          movement.stockShopId || "",
          movement.createdAt || "",
          movement.referenceNo || "",
          movement.platformOrderNo || "",
          movement.addQuantity || 0,
          movement.removeQuantity || 0,
          movement.totalQuantity || 0,
        ].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function movementPlatformLabel(movement) {
    return movement.platform || movement.channelName || "-";
  }

  function movementPaymentBadge(movement) {
    if (Number(movement.removeQuantity || 0) <= 0) {
      return `<span class="payment-badge neutral">ไม่ใช่ขายออก</span>`;
    }
    if (!["Shopee", "Lazada"].includes(movement.platform || "")) {
      return `<span class="payment-badge neutral">ไม่ใช่ Shopee/Lazada</span>`;
    }
    if (movement.platformPaymentStatus === "matched") {
      return `<span class="payment-badge matched">${escapeHtml(fmtBaht2.format(movement.platformPaymentAmount || 0))}</span>`;
    }
    return `<span class="payment-badge missing">ยังไม่มีข้อมูล Seller</span>`;
  }

  function movementPaymentDetail(movement) {
    if (movement.platformPaymentStatus === "matched") {
      const source = movement.platformPaymentSource || `${movement.platform} Seller Center`;
      const captured = movement.platformPaymentCapturedAt ? ` · ${formatDateTime(movement.platformPaymentCapturedAt)}` : "";
      return `${source}${captured}`;
    }
    if (Number(movement.removeQuantity || 0) > 0 && ["Shopee", "Lazada"].includes(movement.platform || "")) {
      return "รอข้อมูลยอดเงินจาก Seller platform เท่านั้น";
    }
    return "";
  }

  function movementQuantityText(movement) {
    const add = Number(movement.addQuantity || 0);
    const remove = Number(movement.removeQuantity || 0);
    if (add > 0 && remove > 0) return `+${fmtQty.format(add)} / -${fmtQty.format(remove)}`;
    if (add > 0) return `+${fmtQty.format(add)}`;
    if (remove > 0) return `-${fmtQty.format(remove)}`;
    return "0";
  }

  function stockMovementHistoryTable(row) {
    const movements = detailMovementRows(row);
    const expectedCount = Number(row.stockMovementCount || 0);
    if (!movements.length && expectedCount > 0 && stockMovementLoadState !== "loaded") {
      const message =
        stockMovementLoadState === "error"
          ? `โหลดประวัติเดิน stock ไม่สำเร็จ: ${stockMovementLoadError || "-"}`
          : "กำลังโหลดประวัติเดิน stock จาก Packhai...";
      return `
        <section class="detail-block detail-wide movement-history-block">
          <h3>ประวัติเดิน stock จาก Packhai</h3>
          <p>${escapeHtml(message)}</p>
        </section>`;
    }
    const saleOutRows = movements.filter((movement) => Number(movement.removeQuantity || 0) > 0);
    const matchedPaymentRows = saleOutRows.filter((movement) => movement.platformPaymentStatus === "matched");
    const summary = `${fmtInt.format(movements.length)} รายการ · ขายออก ${fmtInt.format(saleOutRows.length)} รายการ · พบยอด Seller ${fmtInt.format(matchedPaymentRows.length)} รายการ`;
    if (!movements.length) {
      return `
        <section class="detail-block detail-wide movement-history-block">
          <h3>ประวัติเดิน stock จาก Packhai</h3>
          <p>ยังไม่มีประวัติเดิน stock จาก shop.packhai.com สำหรับรายการนี้</p>
        </section>`;
    }
    return `
      <section class="detail-block detail-wide movement-history-block">
        <div class="movement-history-head">
          <div>
            <h3>ประวัติเดิน stock ทุก order จาก Packhai</h3>
            <p>${escapeHtml(summary)}</p>
          </div>
          <span>ยอดเงินใช้เฉพาะ Shopee/Lazada Seller</span>
        </div>
        <div class="movement-history-table-wrap">
          <table class="movement-history-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ช่องทาง / Order</th>
                <th>เดิน stock</th>
                <th>คงเหลือหลังรายการ</th>
                <th>ยอดเงินจาก platform</th>
              </tr>
            </thead>
            <tbody>
              ${movements
                .map(
                  (movement) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(formatDateTime(movement.createdAt))}</strong>
                        <span>${escapeHtml(movement.type || "-")}</span>
                      </td>
                      <td>
                        <strong>${escapeHtml(movementPlatformLabel(movement))}</strong>
                        <span>Packhai ${escapeHtml(movement.referenceNo || "-")}</span>
                        <span>Platform ${escapeHtml(movement.platformOrderNo || "-")}</span>
                      </td>
                      <td class="num">
                        <strong>${escapeHtml(movementQuantityText(movement))}</strong>
                        <span>${escapeHtml(movement.description || "")}</span>
                      </td>
                      <td class="num">${fmtQty.format(movement.totalQuantity || 0)}</td>
                      <td>
                        ${movementPaymentBadge(movement)}
                        <span>${escapeHtml(movementPaymentDetail(movement))}</span>
                      </td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function openProductDetailById(detailId) {
    const row = rowByDetailId.get(detailId);
    if (!row) return;
    openProductDetail(row);
  }

  function openProductDetail(row) {
    const modal = $("productDetailModal");
    const content = $("productDetailContent");
    if (!modal || !content) return;
    activeDetailRow = row;
    if (stockMovementLoadState === "idle" && Number(row.stockMovementCount || 0) > 0) {
      loadStockMovements().then(() => {
        if (activeDetailRow === row && !modal.hidden) openProductDetail(row);
      });
    }

    const sourceLink = row.sourceUrl
      ? `<a class="detail-source-link" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">เปิดแหล่งราคา</a>`
      : "";
    const priceText = row.price > 0 ? fmtBaht2.format(row.price) : "-";
    const inventoryText = fmtBaht.format(row.inventoryValue || 0);
    const availableText = fmtQty.format(row.available || 0);
    const movementText = row.latestStockMovementAt ? formatDateTime(row.latestStockMovementAt) : "-";

    content.innerHTML = `
      <div class="detail-hero">
        <div class="detail-image">${productImage(row, "detail")}</div>
        <div class="detail-title-block">
          <p class="detail-kicker">${escapeHtml(row.stockSourceLabel || `${row.stockSource || "-"} - ${row.warehouseName || "-"}`)}</p>
          <h2 id="detailTitle">${escapeHtml(row.name || "-")}</h2>
          <div class="detail-sku">
            <span>SKU ${escapeHtml(row.sku || "-")}</span>
            <span>Barcode ${escapeHtml(row.barcode || "-")}</span>
            <span class="badge ${sourceColors[row.priceSource] || "Missing"}">${sourceLabel(row.priceSource)}</span>
          </div>
        </div>
      </div>

      <div class="detail-metrics">
        ${detailMetric("มูลค่าคงเหลือ", inventoryText, true)}
        ${detailMetric("คงเหลือ", `${fmtQty.format(row.quantity || 0)} หน่วย`)}
        ${detailMetric("พร้อมขาย", `${availableText} หน่วย`)}
        ${detailMetric("ราคาขาย", priceText)}
        ${detailMetric("เดิน stock ล่าสุด", movementText)}
      </div>

      <div class="detail-sections">
        <section class="detail-block">
          <h3>คลังและจำนวน</h3>
          ${detailField("แหล่ง stock", row.stockSource || "-")}
          ${detailField("คลัง", row.warehouseName || "-")}
          ${detailField("รอจัด/รอส่ง", `${fmtQty.format(row.waiting || 0)} หน่วย`)}
          ${detailField("รอนำเข้า", `${fmtQty.format(row.waitImport || 0)} หน่วย`)}
          ${detailField("จำนวนที่ใช้ตีมูลค่า", `${fmtQty.format(row.stockForValue || row.quantity || 0)} หน่วย`)}
          ${detailWarehouseBreakdown(row)}
          ${detailField("รายการเดิน stock ล่าสุด", movementSummary(row))}
          ${detailField("รายละเอียดล่าสุด", row.latestStockMovementDescription || "-")}
        </section>

        <section class="detail-block">
          <h3>ราคาและแหล่งข้อมูล</h3>
          ${detailField("แหล่งราคา", row.priceSourceLabel || sourceLabel(row.priceSource))}
          ${detailField("วิธีจับคู่ราคา", matchLabel(row.priceMatchType))}
          ${detailField("SKU จากแหล่งราคา", row.sourceSku || "-")}
          ${detailField("จำนวนตัวเลือกที่พบ", row.priceCandidateCount != null ? fmtInt.format(row.priceCandidateCount) : "-")}
          ${detailField("อัปเดตราคา", formatDateTime(row.sourceCapturedAt))}
          ${sourceLink}
        </section>
      </div>

      ${stockMovementHistoryTable(row)}
      ${websiteStockTransactionTable(row)}

      <section class="detail-block detail-wide">
        <h3>ชื่อสินค้าจากแหล่งราคา</h3>
        <p>${escapeHtml(row.sourceTitle || row.name || "-")}</p>
      </section>

      ${
        row.note
          ? `<section class="detail-block detail-wide"><h3>หมายเหตุ</h3><p>${escapeHtml(row.note)}</p></section>`
          : ""
      }`;

    modal.hidden = false;
    document.body.classList.add("modal-open");
    $("closeProductDetail")?.focus();
  }

  function closeProductDetail() {
    const modal = $("productDetailModal");
    if (!modal) return;
    modal.hidden = true;
    activeDetailRow = null;
    document.body.classList.remove("modal-open");
  }

  function renderStockAdjustStatus(type, message) {
    const status = $("stockAdjustStatus");
    if (!status) return;
    status.hidden = !message;
    status.className = `stock-adjust-status ${type || ""}`;
    status.textContent = message || "";
  }

  function openStockAdjustModal(row) {
    if (!isWebsiteStockWarehouse(row)) return;
    activeStockAdjustRow = row;
    const modal = $("stockAdjustModal");
    const form = $("stockAdjustForm");
    if (!modal || !form) return;
    $("stockAdjustSku").textContent = row.sku || "-";
    $("stockAdjustWarehouse").textContent = row.warehouseName || "-";
    $("stockAdjustCurrent").textContent = `${fmtQty.format(row.quantity || 0)} หน่วย`;
    $("stockAdjustQuantity").value = Number(row.quantity || 0);
    $("stockAdjustNote").value = "";
    renderStockAdjustStatus("", "");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    $("stockAdjustQuantity")?.focus();
  }

  function closeStockAdjustModal() {
    const modal = $("stockAdjustModal");
    if (!modal) return;
    modal.hidden = true;
    activeStockAdjustRow = null;
    renderStockAdjustStatus("", "");
    const detailOpen = $("productDetailModal") && !$("productDetailModal").hidden;
    if (!detailOpen) document.body.classList.remove("modal-open");
  }

  async function submitStockAdjustment(event) {
    event.preventDefault();
    const row = activeStockAdjustRow;
    if (!isWebsiteStockWarehouse(row)) return;
    const quantityInput = $("stockAdjustQuantity");
    const noteInput = $("stockAdjustNote");
    const submitButton = $("stockAdjustSubmit");
    const nextQuantity = Number(quantityInput?.value);
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      renderStockAdjustStatus("failed", "กรุณาใส่จำนวน stock คงเหลือเป็นตัวเลข 0 ขึ้นไป");
      return;
    }
    if (!supabaseDirectConfigured() && !ensureRemoteSyncConfig("flowaccount")) {
      renderStockAdjustStatus("failed", "ยังบันทึกออนไลน์ไม่ได้ เพราะยังไม่มี Cloud/Supabase write server สำหรับบันทึก transaction");
      return;
    }
    if (submitButton) submitButton.disabled = true;
    renderStockAdjustStatus("running", "กำลังบันทึก transaction และ publish dashboard...");
    try {
      const payload = await saveWebsiteStockAdjustment({
        sku: row.sku,
        operation: "set",
        actor: "Website Stock UI",
        note: noteInput?.value || "",
        sourceText: `Manual row adjustment for ${row.sku} at ${row.warehouseName}`,
        allocations: [{ warehouseId: row.warehouseId, quantity: nextQuantity }],
      });
      renderStockAdjustStatus("passed", payload.message || "บันทึก stock สำเร็จ รอหน้าเว็บอัปเดตสักครู่");
      if (!supabaseDirectConfigured()) setTimeout(() => window.location.reload(), remoteSyncApiBase ? 25000 : 1200);
    } catch (error) {
      renderStockAdjustStatus("failed", `บันทึกไม่สำเร็จ: ${syncNetworkErrorMessage(error)}`);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  const syncLabels = {
    all: "ข้อมูลทั้งหมด",
    packhai: "คลัง Packhai",
    flowaccount: "Website Stock",
    seller: "ราคาขาย Seller",
    expenses: "ระบบค่าใช้จ่าย",
  };
  syncLabels["seller-payments"] = "ยอดเก็บเงิน Platform";
  let syncPollTimer = null;
  let syncStartedHere = false;
  const staticReportHost = window.location.protocol === "file:" || /(^|\.)github\.io$/i.test(window.location.hostname);
  const staticSyncStatusUrl = "sync-status.json";
  const githubSyncRunsApiUrl =
    "https://api.github.com/repos/pongsathornkit-cmd/packhai-inventory-dashboard/actions/workflows/sync-dashboard.yml/runs?per_page=1";
  let lastStaticSyncType = "all";
  let githubSyncStatusCache = null;
  let githubSyncStatusLoading = false;
  const syncDefaultTitles = {
    syncAll: "Sync Packhai, Website Stock and seller prices",
    syncPackhai: "Sync Packhai stock",
    syncFlowaccount: "Use Website Stock snapshot",
    syncSeller: "Sync Seller prices",
    syncSellerPayments: "Sync seller platform collection payments",
  };
  const rawEmbeddedSyncApiBase = normalizeSyncApiBase(window.__PACKHAI_SYNC_API_BASE__ || "");
  const rawStoredSyncApiBase = normalizeSyncApiBase(localStorage.getItem("packhaiSyncApiBase") || "");
  const embeddedSyncApiBase =
    staticReportHost && isEphemeralSyncApiBase(rawEmbeddedSyncApiBase) ? "" : rawEmbeddedSyncApiBase;
  const storedSyncApiBase = staticReportHost && isEphemeralSyncApiBase(rawStoredSyncApiBase) ? "" : rawStoredSyncApiBase;
  if (staticReportHost && isEphemeralSyncApiBase(rawStoredSyncApiBase)) {
    localStorage.removeItem("packhaiSyncApiBase");
  }
  let remoteSyncApiBase = embeddedSyncApiBase || storedSyncApiBase;
  if (remoteSyncApiBase) {
    localStorage.setItem("packhaiSyncApiBase", remoteSyncApiBase);
  }
  let syncApiUnavailable = staticReportHost && !remoteSyncApiBase;

  function normalizeSyncApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function isEphemeralSyncApiBase(value) {
    try {
      return /\.trycloudflare\.com$/i.test(new URL(value).hostname);
    } catch {
      return false;
    }
  }

  function syncApiUrl(path) {
    if (!staticReportHost) return path;
    return remoteSyncApiBase ? `${remoteSyncApiBase}${path}` : path;
  }

  function clearRemoteSyncApiBase() {
    const failedBase = remoteSyncApiBase;
    remoteSyncApiBase = "";
    localStorage.removeItem("packhaiSyncApiBase");
    syncApiUnavailable = staticReportHost;
    setStaticSyncMode(true);
    return failedBase;
  }

  function renderSyncApiBaseFailure(type, error) {
    const failedBase = clearRemoteSyncApiBase();
    renderSyncStatus(
      {
        ok: false,
        warning: true,
        type,
        message: `Sync API URL ติดต่อไม่ได้: ${failedBase || "ยังไม่ได้ตั้งค่า"} (${error.message}) ลบ URL เก่าแล้ว กด Sync อีกครั้งเพื่อใส่ URL ใหม่ หรือเปิด cloud sync server ให้ online`,
        steps: [],
      },
      true
    );
  }

  function syncFetchOptions(method = "GET") {
    const headers = {};
    const key = localStorage.getItem("packhaiSyncApiKey") || "";
    if (key) headers["X-Sync-Key"] = key;
    return { method, cache: "no-store", headers };
  }

  function setStaticSyncMode(enabled) {
    syncButtons().forEach((button) => {
      button.classList.toggle("is-static", enabled);
      if (enabled) {
        button.title = "ดูสถานะ Auto Sync ล่าสุด ปุ่มนี้ไม่ได้เริ่ม Sync ใหม่ทันที";
        button.setAttribute("aria-label", `${button.textContent.trim()} - Auto Sync status`);
      } else {
        button.title = syncDefaultTitles[button.id] || button.title;
        button.removeAttribute("aria-label");
      }
    });
  }

  function githubSyncWorkflowHint(type) {
    if (type === "seller-payments") return "ระบบอัปเดตยอดเก็บเงิน Platform อัตโนมัติ และไล่ย้อนหลังต่อเนื่องจนกว่าจะครบ";
    if (type === "flowaccount") return "ระบบใช้ข้อมูล Website Stock ของคลัง ซ.เจริญกิจ / สุขสวัสดิ์ ที่เก็บบนเว็บไซต์นี้";
    if (type === "packhai") return "ระบบอัปเดตคลัง Packhai และ stock movement อัตโนมัติ";
    if (type === "seller") return "ระบบอัปเดตราคาขาย Shopee/Lazada อัตโนมัติ";
    return "ระบบ Sync ทั้งหมดอัตโนมัติ: Packhai, Website Stock, ราคาขาย และยอดเก็บเงิน Platform";
  }

  function githubRunLabel(run) {
    if (!run) return "ยังไม่ได้อ่านสถานะล่าสุด";
    const timeText = formatSyncTime(run.updated_at || run.run_started_at || run.created_at);
    if (run.status !== "completed") return `กำลังรันบน Cloud · ${timeText || "กำลังประมวลผล"}`;
    if (run.warning) return `ล่าสุดสำเร็จบางส่วน · ${timeText}`;
    if (run.conclusion === "success") return `ล่าสุดสำเร็จ · ${timeText}`;
    if (run.conclusion === "cancelled") return `ล่าสุดถูกยกเลิก · ${timeText}`;
    return `ล่าสุดไม่สำเร็จ · ${timeText}`;
  }

  function githubRunClass(run) {
    if (!run) return "warning";
    if (run.status !== "completed") return "running";
    if (run.warning) return "warning";
    if (run.conclusion === "success") return "passed";
    if (run.conclusion === "cancelled") return "warning";
    return "failed";
  }

  function bindStaticSyncActions() {
    $("syncStatus")?.querySelector("[data-sync-run-refresh]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "กำลังตรวจสถานะ...";
      loadGitHubSyncStatus(lastStaticSyncType, true);
    });
    $("syncStatus")?.querySelector("[data-dashboard-refresh]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "กำลังโหลดข้อมูล...";
      const freshUrl = `${window.location.pathname}?v=${Date.now()}${window.location.hash || ""}`;
      window.location.href = freshUrl;
    });
  }

  function renderStaticSyncNotice(type = "all", run = githubSyncStatusCache) {
    const el = $("syncStatus");
    if (!el) return;
    lastStaticSyncType = type;
    setStaticSyncMode(true);
    el.hidden = false;
    el.className = `sync-status ${githubSyncStatusLoading ? "running" : githubRunClass(run)}`;
    const label = syncLabels[type] || "Sync data";
    const runStatus = githubSyncStatusLoading ? "กำลังอ่านสถานะ Auto Sync..." : githubRunLabel(run);
    const runMessage = run?.warning && run?.message ? ` · ${run.message}` : "";
    el.innerHTML = `
      <div>
        <strong>Auto Sync เปิดใช้งาน · ${escapeHtml(label)}</strong>
        <span>ระบบ Sync ข้อมูลทั้งหมดอัตโนมัติบน Cloud ทุก 2 ชั่วโมงช่วง 09:00-19:00 ไม่ต้องเปิดเครื่องนี้ทิ้งไว้</span>
        <span>ตอนนี้ปุ่มบน GitHub Pages ใช้ดูสถานะและรีเฟรชข้อมูลล่าสุดเท่านั้น ยังไม่ได้เริ่ม Sync ใหม่ทันทีจาก browser</span>
        <small>${escapeHtml(githubSyncWorkflowHint(type))} · ${escapeHtml(runStatus)}${escapeHtml(runMessage)}</small>
      </div>
      <div class="sync-status-actions">
        <button class="sync-status-primary" type="button" data-dashboard-refresh>รีเฟรชข้อมูลล่าสุด</button>
        <button type="button" data-sync-run-refresh>${githubSyncStatusLoading ? "กำลังตรวจสถานะ..." : "ตรวจสถานะ Auto Sync"}</button>
      </div>`;
    bindStaticSyncActions();
    if (staticReportHost && !githubSyncStatusCache && !githubSyncStatusLoading) {
      loadGitHubSyncStatus(type, false);
    }
  }

  function normalizeStaticSyncStatus(data) {
    return {
      status: "completed",
      conclusion: data?.ok && !data?.warning ? "success" : "failure",
      warning: Boolean(data?.warning),
      message: String(data?.message || ""),
      updated_at: data?.generatedAt || data?.finishedAt || data?.updatedAt || new Date().toISOString(),
      steps: Array.isArray(data?.steps) ? data.steps : [],
    };
  }

  async function loadStaticSyncStatusFile() {
    const response = await fetch(`${staticSyncStatusUrl}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Sync status ${response.status}`);
    return normalizeStaticSyncStatus(await response.json());
  }

  async function loadGitHubSyncStatus(type = lastStaticSyncType, showLoading = false) {
    if (!staticReportHost || remoteSyncApiBase || githubSyncStatusLoading) return;
    try {
      githubSyncStatusLoading = true;
      if (showLoading) renderStaticSyncNotice(type, githubSyncStatusCache);
      try {
        githubSyncStatusCache = await loadStaticSyncStatusFile();
      } catch {
        const response = await fetch(githubSyncRunsApiUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`GitHub status ${response.status}`);
        const data = await response.json();
        githubSyncStatusCache = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] || null : null;
      }
      githubSyncStatusLoading = false;
      renderStaticSyncNotice(type, githubSyncStatusCache);
    } catch (error) {
      githubSyncStatusLoading = false;
      githubSyncStatusCache = {
        status: "completed",
        conclusion: "failure",
        updated_at: new Date().toISOString(),
      };
      renderStaticSyncNotice(type, githubSyncStatusCache);
    }
  }

  function openStaticSyncStatus(type) {
    renderStaticSyncNotice(type);
    loadGitHubSyncStatus(type, true);
    $("syncStatus")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderSyncReadiness(status) {
    if (!status?.config) return;
    const missing = Array.isArray(status.missingConfig) ? status.missingConfig : [];
    const ready = Boolean(status.ready);
    const type = status.type || "all";
    const message = ready
      ? "Sync server ออนไลน์และตั้งค่า token/session ครบแล้ว สามารถกด Sync จากเครื่องนี้ได้"
      : `Sync server ออนไลน์แล้ว แต่ยังขาด ${missing.join(", ") || "บางค่า"} จึงยัง Sync จริงไม่ครบ`;
    renderSyncStatus(
      {
        ...status,
        type,
        ok: ready ? true : false,
        warning: !ready,
        message,
        steps: [],
      },
      true
    );
  }

  function ensureRemoteSyncConfig(type) {
    if (!staticReportHost) return true;
    if (!remoteSyncApiBase) {
      syncApiUnavailable = true;
      renderStaticSyncNotice(type);
      return false;
    }
    setStaticSyncMode(false);
    return true;
  }

  function formatSyncTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function syncButtons() {
    return [$("syncAll"), $("syncPackhai"), $("syncFlowaccount"), $("syncSeller"), $("syncSellerPayments")].filter(Boolean);
  }

  function setSyncButtons(status) {
    const running = Boolean(status?.running);
    syncButtons().forEach((button) => {
      button.disabled = running;
      button.classList.toggle(
        "is-running",
        running &&
          ((status.type === "all" && button.id === "syncAll") ||
            (status.type === "packhai" && button.id === "syncPackhai") ||
            (status.type === "flowaccount" && button.id === "syncFlowaccount") ||
            (status.type === "seller" && button.id === "syncSeller") ||
            (status.type === "seller-payments" && button.id === "syncSellerPayments"))
      );
    });
  }

  function renderSyncStatus(status, showIdle = false) {
    const el = $("syncStatus");
    if (!el) return;
    setSyncButtons(status);
    if (!status || (!showIdle && !status.running && status.ok == null)) {
      el.hidden = true;
      return;
    }

    el.hidden = false;
    el.className = `sync-status ${
      status.running ? "running" : status.warning ? "warning" : status.ok === false ? "failed" : "passed"
    }`;
    const title = status.running
      ? "กำลัง Sync ข้อมูล"
      : status.warning && status.ok === false
      ? "ยัง Sync ไม่ได้"
      : status.warning
      ? "Sync ข้อมูลสำเร็จบางส่วน"
      : status.ok
      ? "Sync ข้อมูลสำเร็จ"
      : "Sync ข้อมูลไม่สำเร็จ";
    const label = syncLabels[status.type] || "Sync ข้อมูล";
    const stepText = status.steps?.length
      ? status.steps
          .map((step) => `${step.name}: ${step.skipped ? "Skipped" : step.code === 0 ? "OK" : "Error"}`)
          .join(" · ")
      : "รอเริ่มประมวลผล";
    const timeText = status.finishedAt
      ? `เสร็จ ${formatSyncTime(status.finishedAt)}`
      : status.startedAt
      ? `เริ่ม ${formatSyncTime(status.startedAt)}`
      : "";

    el.innerHTML = `
      <div>
        <strong>${escapeHtml(title)} · ${escapeHtml(label)}</strong>
        <span>${escapeHtml(status.message || "")}</span>
        <small>${escapeHtml(stepText)}</small>
      </div>
      <code>${escapeHtml(timeText)}</code>`;
  }

  async function getSyncStatus(showIdle = false) {
    if (syncApiUnavailable) {
      setStaticSyncMode(true);
      if (showIdle) renderStaticSyncNotice();
      return;
    }
    try {
      const response = await fetch(syncApiUrl("/api/sync/status"), syncFetchOptions("GET"));
      if (response.status === 401) {
        localStorage.removeItem("packhaiSyncApiKey");
        if (showIdle) {
          renderSyncStatus(
            {
              ok: false,
              warning: true,
              message: "Sync server ยังตั้งค่าให้ต้องใช้รหัสอยู่ กรุณาปิด SYNC_REQUIRE_KEY บน server",
              steps: [],
            },
            true
          );
        }
        return;
      }
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const status = await response.json();
      if (showIdle && !status.running && status.ok == null && status.config) {
        renderSyncReadiness(status);
      } else {
        renderSyncStatus(status, showIdle);
      }
      if (status.running) {
        clearTimeout(syncPollTimer);
        syncPollTimer = setTimeout(() => getSyncStatus(true), 1500);
      } else if (syncStartedHere && status.ok) {
        syncStartedHere = false;
        setTimeout(() => window.location.reload(), remoteSyncApiBase ? 25000 : 1200);
      }
    } catch (error) {
      if (staticReportHost && remoteSyncApiBase) {
        if (showIdle) renderSyncApiBaseFailure("all", error);
        else clearRemoteSyncApiBase();
        return;
      }
      if (!remoteSyncApiBase) {
        syncApiUnavailable = true;
        setStaticSyncMode(true);
      }
      if (!showIdle) return;
      renderSyncStatus(
        {
          ok: false,
          message: `ไม่สามารถอ่านสถานะ Sync ได้: ${error.message} (${remoteSyncApiBase || "local server"})`,
          steps: [],
        },
        true
      );
    }
  }

  async function startSync(type) {
    if (!ensureRemoteSyncConfig(type)) {
      if (staticReportHost) openStaticSyncStatus(type);
      return;
    }
    if (syncApiUnavailable) {
      renderStaticSyncNotice(type);
      return;
    }
    clearTimeout(syncPollTimer);
    syncStartedHere = true;
    renderSyncStatus({ running: true, type, message: "ส่งคำสั่ง Sync ไปที่ server แล้ว", steps: [] }, true);
    try {
      const response = await fetch(syncApiUrl(`/api/sync/${type}`), syncFetchOptions("POST"));
      if (!response.ok) {
        syncStartedHere = false;
        let message = `เริ่ม Sync ไม่ได้: Status ${response.status}`;
        if (response.status === 401) {
          localStorage.removeItem("packhaiSyncApiKey");
          message = "Sync server ยังตั้งค่าให้ต้องใช้รหัสอยู่ กรุณาปิด SYNC_REQUIRE_KEY บน server";
        }
        renderSyncStatus({ ok: false, warning: response.status === 401, type, message, steps: [] }, true);
        return;
      }
      const status = await response.json();
      renderSyncStatus(status, true);
      getSyncStatus(true);
    } catch (error) {
      syncStartedHere = false;
      if (staticReportHost && remoteSyncApiBase) {
        renderSyncApiBaseFailure(type, error);
        return;
      }
      renderSyncStatus(
        {
          ok: false,
          type,
          message: `เริ่ม Sync ไม่ได้: ${error.message} (${remoteSyncApiBase || "local server"})`,
          steps: [],
        },
        true
      );
    }
  }

  const expenseState = {
    month: new Date().toISOString().slice(0, 7),
    query: "",
    pndType: "All",
    expenses: [],
    summary: null,
    loading: false,
    loaded: false,
  };
  const assistantState = {
    messages: [
      {
        role: "assistant",
        text: "พิมพ์คำถามหรือคำสั่งได้เลย เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, หรือสร้าง draft ค่าใช้จ่าย",
        actions: [],
        attachments: [],
      },
    ],
    busy: false,
    attachments: [],
  };

  function expenseApiReady(showMessage = true) {
    if (!staticReportHost || remoteSyncApiBase) return true;
    if (showMessage) {
      renderExpenseStatus(
        "warning",
        "ยังใช้งานค่าใช้จ่ายออนไลน์ไม่ได้",
        "หน้า GitHub Pages ต้องเชื่อม Sync API URL ก่อนจึงจะบันทึกค่าใช้จ่ายและออก PDF ได้"
      );
    }
    return false;
  }

  function expenseFetchOptions(method = "GET", body = null) {
    const options = syncFetchOptions(method);
    if (body) {
      options.headers = { ...options.headers, "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
    return options;
  }

  function expenseApiUrl(path) {
    return syncApiUrl(path);
  }

  function syncNetworkErrorMessage(error) {
    if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message || "")) {
      const target = remoteSyncApiBase || "local server";
      return `Sync API ติดต่อไม่ได้ (${target}) กรุณาตรวจว่า sync server ยังออนไลน์อยู่ แล้วลองใหม่`;
    }
    return error.message || String(error);
  }

  function isExpenseRoute() {
    return (location.hash || "").replace(/^#/, "") === "expenses";
  }

  function updateRouteState() {
    const hash = location.hash || "#executive";
    const expensesPage = isExpenseRoute();
    const assistantPage = hash === "#ai-command";
    const expensesSection = $("expenses");
    if (expensesSection) {
      expensesSection.hidden = !expensesPage;
    }
    document.querySelectorAll(".sidebar-nav a").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === hash);
    });
    if (expensesPage) {
      if (!expenseState.loaded && !expenseState.loading) loadExpenses(true);
      window.requestAnimationFrame(() => expensesSection?.scrollIntoView({ block: "start" }));
    }
    if (assistantPage) openAssistantPanel(false);
  }

  function renderExpenseStatus(kind, title, message) {
    const el = $("expenseStatus");
    if (!el) return;
    if (!title && !message) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = `expense-status ${kind || "info"}`;
    el.innerHTML = `
      <strong>${escapeHtml(title || "")}</strong>
      <span>${escapeHtml(message || "")}</span>`;
  }

  function expensePreviewCalc() {
    const amountInput = Number($("expenseAmountInput")?.value || 0);
    const amountMode = $("expenseAmountMode")?.value || "exclusive";
    const vatMode = $("expenseVatMode")?.value || "vat7";
    const whtRate = Number($("expenseWhtRate")?.value || 0);
    let subtotal = amountInput;
    let vatAmount = 0;
    let grossAmount = amountInput;
    if (vatMode === "vat7") {
      if (amountMode === "inclusive") {
        grossAmount = amountInput;
        subtotal = Math.round((grossAmount / 1.07 + Number.EPSILON) * 100) / 100;
        vatAmount = Math.round((grossAmount - subtotal + Number.EPSILON) * 100) / 100;
      } else {
        vatAmount = Math.round((subtotal * 0.07 + Number.EPSILON) * 100) / 100;
        grossAmount = Math.round((subtotal + vatAmount + Number.EPSILON) * 100) / 100;
      }
    }
    const withholdingAmount = Math.round((subtotal * (whtRate / 100) + Number.EPSILON) * 100) / 100;
    return {
      subtotal,
      vatAmount,
      grossAmount,
      withholdingAmount,
      netPayable: Math.round((grossAmount - withholdingAmount + Number.EPSILON) * 100) / 100,
    };
  }

  function renderExpensePreview() {
    const el = $("expensePreview");
    if (!el) return;
    const preview = expensePreviewCalc();
    el.innerHTML = [
      ["ยอดก่อน VAT", fmtBaht2.format(preview.subtotal || 0)],
      ["VAT", fmtBaht2.format(preview.vatAmount || 0)],
      ["ยอดรวม", fmtBaht2.format(preview.grossAmount || 0)],
      ["หัก ณ ที่จ่าย", fmtBaht2.format(preview.withholdingAmount || 0)],
      ["สุทธิจ่าย", fmtBaht2.format(preview.netPayable || 0)],
    ]
      .map((item) => `<div><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong></div>`)
      .join("");
  }

  function renderExpenseKpis() {
    const el = $("expenseKpis");
    if (!el) return;
    const summary = expenseState.summary || {};
    const cards = [
      ["ค่าใช้จ่ายเดือนนี้", fmtBaht.format(summary.grossAmount || 0), `${fmtInt.format(summary.count || 0)} รายการ`],
      ["VAT ซื้อ", fmtBaht2.format(summary.vatAmount || 0), "สำหรับตรวจภาษีซื้อ"],
      ["หัก ณ ที่จ่าย", fmtBaht2.format(summary.withholdingAmount || 0), `${fmtInt.format(summary.pnd3Count || 0)} ภ.ง.ด.3 / ${fmtInt.format(summary.pnd53Count || 0)} ภ.ง.ด.53`],
      ["สุทธิจ่าย", fmtBaht.format(summary.netPayable || 0), "หลังหัก ณ ที่จ่าย"],
    ];
    el.innerHTML = cards
      .map(
        (card, index) => `
          <article class="expense-kpi ${index === 0 ? "primary" : ""}">
            <span>${escapeHtml(card[0])}</span>
            <strong>${escapeHtml(card[1])}</strong>
            <small>${escapeHtml(card[2])}</small>
          </article>`
      )
      .join("");
  }

  function updateExpenseExportLinks() {
    const month = encodeURIComponent(expenseState.month || "");
    const base = `/api/expenses/export.csv?month=${month}`;
    const all = $("expenseExportAll");
    const pnd3 = $("expenseExportPnd3");
    const pnd53 = $("expenseExportPnd53");
    if (all) all.href = expenseApiReady(false) ? expenseApiUrl(base) : "#expenses";
    if (pnd3) pnd3.href = expenseApiReady(false) ? expenseApiUrl(`${base}&pndType=PND3`) : "#expenses";
    if (pnd53) pnd53.href = expenseApiReady(false) ? expenseApiUrl(`${base}&pndType=PND53`) : "#expenses";
  }

  function expenseRowsForView() {
    const query = compactText(expenseState.query);
    return (expenseState.expenses || [])
      .filter((row) => !expenseState.month || String(row.paymentDate || "").startsWith(expenseState.month))
      .filter((row) => expenseState.pndType === "All" || row.pndType === expenseState.pndType)
      .filter((row) => {
        if (!query) return true;
        return compactText(`${row.expenseNo} ${row.whtNo} ${row.recipientName} ${row.invoiceNo} ${row.category} ${row.description}`).includes(query);
      })
      .sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")) || String(b.expenseNo || "").localeCompare(String(a.expenseNo || "")));
  }

  function renderExpenseRows() {
    const body = $("expenseRows");
    if (!body) return;
    const rowsForView = expenseRowsForView();
    $("expenseLedgerSubtitle").textContent = `แสดง ${fmtInt.format(rowsForView.length)} รายการ จากเดือน ${expenseState.month || "-"}`;
    updateExpenseExportLinks();
    if (!rowsForView.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty-cell">ยังไม่มีรายการค่าใช้จ่ายในเงื่อนไขนี้</td></tr>`;
      return;
    }
    body.innerHTML = rowsForView
      .map((row) => {
        const voucherUrl = expenseApiUrl(`/api/expenses/${encodeURIComponent(row.id)}/payment-voucher.pdf`);
        const whtUrl = expenseApiUrl(`/api/expenses/${encodeURIComponent(row.id)}/wht-certificate.pdf`);
        const whtAction =
          Number(row.withholdingAmount || 0) > 0
            ? `<a href="${escapeHtml(whtUrl)}" target="_blank" rel="noreferrer">50 ทวิ</a>`
            : `<span class="muted-action">ไม่มี WHT</span>`;
        const statusClass = row.status === "cancelled" ? "cancelled" : row.status === "draft" ? "draft" : "posted";
        return `
          <tr class="${statusClass === "cancelled" ? "is-cancelled" : ""}">
            <td>
              <strong>${escapeHtml(row.expenseNo || "-")}</strong>
              <span>${escapeHtml(row.paymentDate || "-")} · ${escapeHtml(row.whtNo || "ไม่มี 50 ทวิ")}</span>
              <em class="expense-status-pill ${statusClass}">${escapeHtml(row.status || "-")}</em>
            </td>
            <td>
              <strong>${escapeHtml(row.recipientName || "-")}</strong>
              <span>${escapeHtml(row.invoiceNo || row.category || "-")}</span>
            </td>
            <td>${escapeHtml(row.pndType || "-")}</td>
            <td class="num">${fmtBaht2.format(row.subtotal || 0)}</td>
            <td class="num">${fmtBaht2.format(row.vatAmount || 0)}</td>
            <td class="num">${fmtBaht2.format(row.withholdingAmount || 0)}</td>
            <td class="num"><strong>${fmtBaht2.format(row.netPayable || 0)}</strong></td>
            <td class="expense-actions">
              <a href="${escapeHtml(voucherUrl)}" target="_blank" rel="noreferrer">ใบสำคัญจ่าย</a>
              ${whtAction}
              ${
                row.status !== "cancelled"
                  ? `<button type="button" data-expense-cancel="${escapeHtml(row.id)}">ยกเลิก</button>`
                  : ""
              }
            </td>
          </tr>`;
      })
      .join("");
  }

  function renderExpenses() {
    renderExpenseKpis();
    renderExpenseRows();
  }

  async function loadExpenses(showErrors = false) {
    if (!expenseApiReady(showErrors)) {
      renderExpenseKpis();
      renderExpenseRows();
      expenseState.loaded = true;
      return;
    }
    expenseState.loading = true;
    try {
      const response = await fetch(expenseApiUrl(`/api/expenses?month=${encodeURIComponent(expenseState.month)}`), expenseFetchOptions("GET"));
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const payload = await response.json();
      expenseState.expenses = payload.expenses || [];
      expenseState.summary = payload.summary || null;
      renderExpenseStatus("", "", "");
      renderExpenses();
    } catch (error) {
      if (showErrors) renderExpenseStatus("failed", "โหลดค่าใช้จ่ายไม่สำเร็จ", error.message);
      renderExpenses();
    } finally {
      expenseState.loading = false;
      expenseState.loaded = true;
    }
  }

  function collectExpenseForm() {
    const form = $("expenseForm");
    const formData = new FormData(form);
    return {
      paymentDate: formData.get("paymentDate"),
      recipientType: formData.get("recipientType"),
      recipientName: formData.get("recipientName"),
      recipientTaxId: formData.get("recipientTaxId"),
      recipientAddress: formData.get("recipientAddress"),
      category: formData.get("category"),
      description: formData.get("description"),
      invoiceNo: formData.get("invoiceNo"),
      amountInput: Number(formData.get("amountInput") || 0),
      amountMode: formData.get("amountMode"),
      vatMode: formData.get("vatMode"),
      whtRate: Number(formData.get("whtRate") || 0),
      notes: formData.get("notes"),
      status: "posted",
    };
  }

  async function saveExpense(event) {
    event.preventDefault();
    if (!ensureRemoteSyncConfig("expenses")) return;
    try {
      renderExpenseStatus("running", "กำลังบันทึกค่าใช้จ่าย", "กำลังออกเลขเอกสารและคำนวณ VAT/WHT");
      const response = await fetch(expenseApiUrl("/api/expenses"), expenseFetchOptions("POST", collectExpenseForm()));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Status ${response.status}`);
      expenseState.expenses = payload.expenses || [];
      expenseState.summary = payload.summary || null;
      $("expenseForm").reset();
      initExpenseDefaults();
      renderExpenseStatus("passed", "บันทึกค่าใช้จ่ายสำเร็จ", `ออกเลข ${payload.record?.expenseNo || ""} แล้ว`);
      renderExpenses();
    } catch (error) {
      renderExpenseStatus("failed", "บันทึกค่าใช้จ่ายไม่สำเร็จ", error.message);
    }
  }

  async function cancelExpenseRecord(id) {
    if (!id || !window.confirm("ยืนยันยกเลิกรายการค่าใช้จ่ายนี้?")) return;
    if (!ensureRemoteSyncConfig("expenses")) return;
    try {
      const response = await fetch(expenseApiUrl(`/api/expenses/${encodeURIComponent(id)}/cancel`), expenseFetchOptions("POST"));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Status ${response.status}`);
      expenseState.expenses = payload.expenses || [];
      expenseState.summary = payload.summary || null;
      renderExpenseStatus("warning", "ยกเลิกรายการแล้ว", payload.record?.expenseNo || "");
      renderExpenses();
    } catch (error) {
      renderExpenseStatus("failed", "ยกเลิกรายการไม่สำเร็จ", error.message);
    }
  }

  function initExpenseDefaults() {
    const today = new Date().toISOString().slice(0, 10);
    if ($("expensePaymentDate")) $("expensePaymentDate").value = today;
    if ($("expenseMonth")) $("expenseMonth").value = expenseState.month;
    renderExpensePreview();
  }

  function bindExpenseEvents() {
    $("expenseForm")?.addEventListener("submit", saveExpense);
    ["expenseAmountInput", "expenseAmountMode", "expenseVatMode", "expenseWhtRate"].forEach((id) => {
      $(id)?.addEventListener("input", renderExpensePreview);
      $(id)?.addEventListener("change", renderExpensePreview);
    });
    $("expenseSearch")?.addEventListener("input", (event) => {
      expenseState.query = event.target.value;
      renderExpenseRows();
    });
    $("expenseMonth")?.addEventListener("change", (event) => {
      expenseState.month = event.target.value || new Date().toISOString().slice(0, 7);
      loadExpenses(true);
    });
    $("expensePndFilter")?.addEventListener("change", (event) => {
      expenseState.pndType = event.target.value || "All";
      renderExpenseRows();
    });
    $("expenseRows")?.addEventListener("click", (event) => {
      const cancelButton = event.target.closest("[data-expense-cancel]");
      if (!cancelButton) return;
      cancelExpenseRecord(cancelButton.dataset.expenseCancel);
    });
  }

  function setAssistantPanelOpen(open, focusInput = false) {
    const widget = $("ai-command");
    const panel = $("aiChatPanel");
    const fab = $("assistantFab");
    if (!widget || !panel || !fab) return;
    panel.hidden = !open;
    widget.classList.toggle("is-open", open);
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && focusInput) {
      window.requestAnimationFrame(() => $("assistantInput")?.focus());
    }
  }

  function openAssistantPanel(focusInput = true) {
    setAssistantPanelOpen(true, focusInput);
  }

  function closeAssistantPanel() {
    setAssistantPanelOpen(false);
    $("assistantFab")?.focus();
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
    return `${value} B`;
  }

  function renderAttachmentList(attachments = [], compact = false) {
    if (!attachments.length) return "";
    return `
      <div class="assistant-attachment-list ${compact ? "compact" : ""}">
        ${attachments
          .map(
            (item) => `
            <figure class="assistant-attachment-card">
              <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "แนบรูปภาพ")}" loading="lazy" />
              <figcaption>
                <strong>${escapeHtml(item.name || "รูปภาพ")}</strong>
                <span>${escapeHtml(formatFileSize(item.size))}</span>
              </figcaption>
            </figure>`
          )
          .join("")}
      </div>`;
  }

  function renderAssistantAttachments() {
    const target = $("assistantAttachmentPreview");
    if (!target) return;
    const attachments = assistantState.attachments || [];
    target.hidden = !attachments.length;
    if (!attachments.length) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = `
      <div class="attachment-preview-head">
        <strong>รูปที่แนบ ${fmtInt.format(attachments.length)} รูป</strong>
        <span>ส่งพร้อมข้อความถัดไป</span>
      </div>
      <div class="attachment-preview-grid">
        ${attachments
          .map(
            (item) => `
            <figure class="attachment-preview-card">
              <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "แนบรูปภาพ")}" />
              <figcaption>
                <strong>${escapeHtml(item.name || "รูปภาพ")}</strong>
                <span>${escapeHtml(formatFileSize(item.size))}</span>
              </figcaption>
              <button type="button" data-remove-attachment="${escapeHtml(item.id)}" aria-label="ลบรูปภาพ">×</button>
            </figure>`
          )
          .join("")}
      </div>`;
  }

  function renderAssistantThread() {
    const thread = $("assistantThread");
    if (!thread) return;
    thread.innerHTML = assistantState.messages
      .map(
        (message, messageIndex) => `
          <article class="assistant-message ${message.role}">
            <span>${message.role === "user" ? "คุณ" : "AI"}</span>
            <p>${escapeHtml(message.text || "").replace(/\n/g, "<br>")}</p>
            ${renderAttachmentList(message.attachments || [], true)}
            ${
              message.actions?.length
                ? `<div class="assistant-actions">
                    ${message.actions
                      .map(
                        (action, actionIndex) =>
                          `<button type="button" data-assistant-action="${messageIndex}:${actionIndex}">${escapeHtml(action.label || "ทำรายการ")}</button>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </article>`
      )
      .join("");
    thread.scrollTop = thread.scrollHeight;
  }

  function setAssistantBusy(busy) {
    assistantState.busy = busy;
    const submit = $("assistantSubmit");
    const input = $("assistantInput");
    const attach = $("assistantAttach");
    if (submit) submit.disabled = busy;
    if (input) input.disabled = busy;
    if (attach) attach.disabled = busy;
    if (submit) submit.textContent = busy ? "กำลังคิด..." : "ส่งคำสั่ง";
  }

  function pushAssistantMessage(role, text, actions = [], attachments = []) {
    assistantState.messages.push({ role, text, actions, attachments });
    renderAssistantThread();
  }

  function daysBetween(now, isoDate) {
    const end = new Date(now);
    const start = new Date(isoDate || "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
  }

  function assistantProductSummary(row, index, includeAge = false) {
    const age = includeAge && row.stockMovementAgeDays != null ? ` · ไม่เดิน ${fmtInt.format(row.stockMovementAgeDays)} วัน` : "";
    return `${index + 1}. ${row.sku || "-"} · ${row.name || "-"} · ${fmtBaht.format(row.inventoryValue || 0)} · คงเหลือ ${fmtQty.format(row.quantity || 0)}${age}`;
  }

  function buildClientAssistantContext() {
    const now = new Date().toISOString();
    const positiveRows = stockRows.filter((row) => Number(row.quantity || 0) > 0);
    const topProducts = [...positiveRows]
      .sort((a, b) => Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0) || Number(b.quantity || 0) - Number(a.quantity || 0))
      .slice(0, 20);
    const staleStock = positiveRows
      .map((row) => ({ ...row, stockMovementAgeDays: daysBetween(now, row.latestStockMovementAt) }))
      .filter((row) => row.stockMovementAgeDays != null)
      .sort((a, b) => Number(b.stockMovementAgeDays || 0) - Number(a.stockMovementAgeDays || 0) || Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0))
      .slice(0, 50);
    return { positiveRows, topProducts, staleStock };
  }

  function extractAssistantSearchQuery(message) {
    return String(message || "")
      .replace(/^(ช่วย)?\s*(ค้นหา|หา|search|ดู)\s*/i, "")
      .replace(/^(สินค้า|sku|รหัสสินค้า)\s*/i, "")
      .replace(/\s*(ใน)?\s*(ตาราง|คลัง|stock|inventory)\s*$/i, "")
      .trim();
  }

  const githubStockWarehouses = [
    {
      id: 491661,
      name: "\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08",
      label: "\u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08",
      pattern: /(?:\u0e04\u0e25\u0e31\u0e07\s*)?(?:\u0e0b\.?\s*\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08|\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08|charoen\s*kit|charoenkit)/giu,
    },
    {
      id: 491662,
      name: "\u0e04\u0e25\u0e31\u0e07 \u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c",
      label: "\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c",
      pattern: /(?:\u0e04\u0e25\u0e31\u0e07\s*)?(?:\u0e2a\u0e38\u0e02\s*\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c|\u0e2a\u0e38\u0e02\s*\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34|suk\s*sawat|suksawat)/giu,
    },
  ];

  function numberFromText(value) {
    const parsed = Number(String(value || "").replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function findAssistantWarehouseMatches(message) {
    const text = String(message || "");
    const matches = [];
    githubStockWarehouses.forEach((warehouse) => {
      warehouse.pattern.lastIndex = 0;
      let match;
      while ((match = warehouse.pattern.exec(text)) !== null) {
        matches.push({ warehouse, index: match.index, end: match.index + match[0].length });
      }
    });
    return matches.sort((a, b) => a.index - b.index);
  }

  function extractStockUpdateSku(message) {
    const text = String(message || "");
    const patterns = [
      /(?:\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32|\u0e40\u0e1e\u0e34\u0e48\u0e21\s*stock|\u0e25\u0e07\s*stock|add(?:\s+product|\s+sku|\s+stock)?|update(?:\s+sku)?)\s+([A-Z0-9][A-Z0-9._/-]{1,})/i,
      /(?:sku|\u0e23\u0e2b\u0e31\u0e2a\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{1,})/i,
      /\b[A-Z][A-Z0-9]*-[A-Z0-9._/-]+\b/i,
      /\b[A-Z]\d+[A-Z0-9._/-]*\b/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1] || match?.[0]) return String(match[1] || match[0]).trim().toUpperCase();
    }
    return "";
  }

  function stockUpdateOperation(message) {
    const text = compactText(message);
    if (/(subtract|remove|deduct|\u0e25\u0e14|\u0e15\u0e31\u0e14)/i.test(text)) return "subtract";
    if (/(set|replace|\u0e15\u0e31\u0e49\u0e07|\u0e1b\u0e23\u0e31\u0e1a\u0e40\u0e1b\u0e47\u0e19|\u0e41\u0e01\u0e49\u0e40\u0e1b\u0e47\u0e19|\u0e40\u0e1b\u0e47\u0e19\u0e08\u0e33\u0e19\u0e27\u0e19)/i.test(text)) return "set";
    return "add";
  }

  function hasStockUpdateIntent(message) {
    return /(?:add|update|set|insert|adjust|subtract|remove|deduct|\u0e40\u0e1e\u0e34\u0e48\u0e21|\u0e40\u0e15\u0e34\u0e21|\u0e25\u0e14|\u0e15\u0e31\u0e14|\u0e1b\u0e23\u0e31\u0e1a|\u0e15\u0e31\u0e49\u0e07|\u0e41\u0e01\u0e49|\u0e25\u0e07|\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01)/i.test(
      String(message || "")
    );
  }

  function extractStockUpdateQuantity(segment) {
    const match = String(segment || "").match(
      /(?:\u0e08\u0e33\u0e19\u0e27\u0e19|qty|quantity|=|:)?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:\u0e2d\u0e31\u0e19|\u0e0a\u0e34\u0e49\u0e19|\u0e2b\u0e19\u0e48\u0e27\u0e22|pcs?|units?)?/i
    );
    return match ? numberFromText(match[1]) : 0;
  }

  function parseClientStockUpdateCommand(message) {
    const text = String(message || "");
    const matches = findAssistantWarehouseMatches(text);
    if (!matches.length || !hasStockUpdateIntent(text)) return null;
    const sku = extractStockUpdateSku(text);
    if (!sku) return null;
    const allocations = [];
    matches.forEach((match, index) => {
      const next = matches[index + 1];
      const segment = text.slice(match.end, next ? next.index : text.length);
      const quantity = extractStockUpdateQuantity(segment);
      if (quantity <= 0) return;
      const existing = allocations.find((item) => item.warehouseId === match.warehouse.id);
      if (existing) existing.quantity += quantity;
      else {
        allocations.push({
          warehouseId: match.warehouse.id,
          warehouseName: match.warehouse.name,
          warehouseLabel: match.warehouse.label,
          quantity,
        });
      }
    });
    if (!allocations.length) return null;
    return { sku, operation: stockUpdateOperation(text), allocations, sourceText: text.trim().slice(0, 500) };
  }

  function stockOperationLabel(operation) {
    if (operation === "set") return "\u0e15\u0e31\u0e49\u0e07\u0e08\u0e33\u0e19\u0e27\u0e19\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d";
    if (operation === "subtract") return "\u0e25\u0e14\u0e08\u0e33\u0e19\u0e27\u0e19";
    return "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e08\u0e33\u0e19\u0e27\u0e19";
  }

  function formatClientStockUpdateReply(update) {
    const lines = update.allocations
      .map((item) => `- ${item.warehouseName}: ${fmtQty.format(item.quantity)} \u0e2b\u0e19\u0e48\u0e27\u0e22`)
      .join("\n");
    return (
      `\u0e1c\u0e21\u0e2d\u0e48\u0e32\u0e19\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e44\u0e14\u0e49\u0e40\u0e1b\u0e47\u0e19 ${stockOperationLabel(update.operation)} SKU ${update.sku}\n${lines}\n` +
      `\u0e01\u0e14\u0e1b\u0e38\u0e48\u0e21\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock \u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e40\u0e01\u0e47\u0e1a\u0e40\u0e02\u0e49\u0e32 Website Stock \u0e41\u0e25\u0e30 publish dashboard`
    );
  }

  function isAiSidebarMenuRemovalCommand(message) {
    const text = compactText(message);
    const mentionsSidebarMenu = /(\u0e41\u0e16\u0e1a\u0e40\u0e21\u0e19\u0e39|\u0e40\u0e21\u0e19\u0e39|sidebar|side bar|\u0e14\u0e49\u0e32\u0e19\u0e0b\u0e49\u0e32\u0e22|\u0e0b\u0e49\u0e32\u0e22|left menu)/.test(text);
    const mentionsAssistant = /(ai command|ai|\u0e41\u0e0a\u0e17|chat)/.test(text);
    const asksRemoval = /(\u0e15\u0e31\u0e14|\u0e40\u0e2d\u0e32\u0e2d\u0e2d\u0e01|\u0e25\u0e1a|\u0e0b\u0e48\u0e2d\u0e19|remove|hide)/.test(text);
    return mentionsSidebarMenu && mentionsAssistant && asksRemoval;
  }

  function runClientRuleAssistant(message, options = {}) {
    const text = compactText(message);
    const context = buildClientAssistantContext();
    const fallbackNote = "";
    const stockUpdate = parseClientStockUpdateCommand(message);

    if (!text) {
      return {
        reply: "พิมพ์คำถามหรือคำสั่งได้เลย เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, หรือค้นหา SKU",
        actions: [],
        source: "rule",
      };
    }

    if (stockUpdate) {
      return {
        reply: formatClientStockUpdateReply(stockUpdate),
        actions: [{ type: "stockUpdate", label: "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock", payload: stockUpdate }],
        source: "rule",
      };
    }

    if (isAiSidebarMenuRemovalCommand(message)) {
      return {
        reply:
          "\u0e15\u0e31\u0e14\u0e40\u0e21\u0e19\u0e39 AI Command \u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e41\u0e16\u0e1a\u0e40\u0e21\u0e19\u0e39\u0e14\u0e49\u0e32\u0e19\u0e0b\u0e49\u0e32\u0e22\u0e41\u0e25\u0e49\u0e27\u0e04\u0e23\u0e31\u0e1a \u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49\u0e43\u0e2b\u0e49\u0e40\u0e1b\u0e34\u0e14 AI \u0e08\u0e32\u0e01\u0e1b\u0e38\u0e48\u0e21 popup \u0e41\u0e17\u0e19 \u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e43\u0e2b\u0e49 sidebar \u0e40\u0e2b\u0e25\u0e37\u0e2d\u0e40\u0e09\u0e1e\u0e32\u0e30\u0e40\u0e21\u0e19\u0e39\u0e07\u0e32\u0e19\u0e2b\u0e25\u0e31\u0e01",
        actions: [{ type: "focusSection", label: "\u0e14\u0e39\u0e1b\u0e38\u0e48\u0e21 AI popup", selector: "#ai-command", autoRun: true }],
        source: "rule",
      };
    }

    if (/popup|ป๊อปอัพ|แชท|chat|ai/.test(text) && /ช่อง|หน้าต่าง|ลอย|website|เว็บ|เว็บไซต/.test(text)) {
      return {
        reply: `${fallbackNote}ตอนนี้ช่อง AI ถูกปรับเป็น popup ลอยบนหน้าเว็บแล้วครับ กดปุ่ม AI มุมขวาล่างเพื่อเปิด ใช้ปุ่มปิดหรือกด Esc เพื่อย่อกลับได้`,
        actions: [{ type: "focusSection", label: "ดูช่อง AI", selector: "#ai-command", autoRun: true }],
        source: "rule",
      };
    }

    if (/(มูลค่าคงเหลือ|kpi|summary|แถวบนสุด|บนสุด|ด้านบน|top row)/.test(text) && /(ย้าย|เลื่อน|เปิด|ดู|แสดง|ไป|อยู่)/.test(text)) {
      return {
        reply: "จัดให้แล้วครับ แถวสรุปมูลค่าคงเหลือรวมอยู่บนสุดของหน้าเว็บ และผมเลื่อนไปให้ดูทันที",
        actions: [{ type: "focusSection", label: "ดูมูลค่าคงเหลือบนสุด", selector: "#kpiGrid", hash: "", autoRun: true }],
        source: "rule",
      };
    }

    if (/(สินค้าแยกตามคลัง|แยกตามคลัง|แต่ละคลัง|warehouse)/.test(text) && /(เปิด|ดู|เลื่อน|ไป|แสดง)/.test(text)) {
      return {
        reply: "เปิดส่วนสินค้าแยกตามคลังให้แล้วครับ",
        actions: [{ type: "focusSection", label: "ดูสินค้าแยกตามคลัง", selector: "#warehouses", hash: "warehouses", autoRun: true }],
        source: "rule",
      };
    }

    if (/ไม่เดิน|movement|เคลื่อนไหว|เกิน\s*\d+\s*วัน/.test(text)) {
      const dayMatch = text.match(/(\d+)\s*วัน/);
      const minDays = dayMatch ? Number(dayMatch[1]) : 30;
      const matches = context.staleStock.filter((row) => Number(row.stockMovementAgeDays || 0) >= minDays).slice(0, 10);
      return {
        reply: matches.length
          ? `${fallbackNote}สินค้า stock ไม่เดินเกิน ${fmtInt.format(minDays)} วัน:\n${matches.map((row, index) => assistantProductSummary(row, index, true)).join("\n")}`
          : `${fallbackNote}ยังไม่พบสินค้าที่มีประวัติ stock ไม่เดินเกิน ${fmtInt.format(minDays)} วันในข้อมูล Packhai`,
        actions: [{ type: "filterInventory", label: "เปิดตารางสินค้า", query: "", sort: "movementDesc", hash: "inventory-detail", autoRun: true }],
        source: "rule",
      };
    }

    if (/มูลค่าสูงสุด|top|แพงสุด|มูลค่า.*สินค้า|เรียง.*มูลค่า/.test(text)) {
      return {
        reply: `${fallbackNote}สินค้ามูลค่าสูงสุดตอนนี้:\n${context.topProducts.slice(0, 10).map((row, index) => assistantProductSummary(row, index)).join("\n")}`,
        actions: [{ type: "filterInventory", label: "เรียงตารางตามมูลค่า", query: "", sort: "valueDesc", hash: "inventory-detail", autoRun: true }],
        source: "rule",
      };
    }

    if (/^(ช่วย)?\s*(ค้นหา|หา|search|ดู)\s+|sku|รหัสสินค้า/i.test(text)) {
      const query = extractAssistantSearchQuery(message);
      if (query) {
        const matchCount = stockRows.filter((row) => compactText(`${row.sku} ${row.name} ${row.warehouseName} ${row.stockSource}`).includes(compactText(query))).length;
        return {
          reply: `${fallbackNote}ค้นหา "${query}" ในตารางสินค้าให้แล้ว พบประมาณ ${fmtInt.format(matchCount)} แถว`,
          actions: [
            {
              type: "filterInventory",
              label: `ค้นหา ${query.slice(0, 24)}`,
              query,
              sort: "valueDesc",
              hash: "inventory-detail",
              autoRun: true,
            },
          ],
          source: "rule",
        };
      }
    }

    if (/คลัง packhai|ตาราง.*คลัง|เปิด.*สินค้า|inventory|stock/.test(text)) {
      return {
        reply: `${fallbackNote}เปิดตารางรายละเอียดสินค้าให้แล้วครับ สามารถค้นหา เรียงมูลค่า และดูแยกตามคลังต่อได้`,
        actions: [{ type: "filterInventory", label: "เปิดตารางสินค้า", query: "", sort: "valueDesc", hash: "inventory-detail", autoRun: true }],
        source: "rule",
      };
    }

    if (/ค่าใช้จ่าย|ภ\.ง\.ด|ภงด|หัก ณ ที่จ่าย|wht/.test(text)) {
      return {
        reply: `${fallbackNote}คำสั่งค่าใช้จ่ายต้องใช้ backend เพื่อบันทึกข้อมูลจริง แต่ผมเปิดหน้าค่าใช้จ่ายให้ตรวจหรือกรอกต่อได้ครับ`,
        actions: [{ type: "navigate", label: "เปิดหน้าค่าใช้จ่าย", hash: "expenses", autoRun: true }],
        source: "rule",
      };
    }

    return {
      reply: `${fallbackNote}ตอนนี้ผมช่วยคำสั่งหลักได้ เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, ค้นหา SKU, เปิดตารางสินค้า หรือเปิดหน้าค่าใช้จ่าย`,
      actions: [],
      source: "rule",
    };
  }

  function setSelectValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillExpenseForm(payload = {}) {
    const assign = (id, value) => {
      const el = $(id);
      if (el) el.value = value ?? "";
    };
    location.hash = "expenses";
    updateRouteState();
    assign("expensePaymentDate", payload.paymentDate || new Date().toISOString().slice(0, 10));
    setSelectValue("expenseRecipientType", payload.recipientType || "company");
    assign("expenseRecipientName", payload.recipientName || "");
    assign("expenseRecipientTaxId", payload.recipientTaxId || "");
    assign("expenseRecipientAddress", payload.recipientAddress || "");
    assign("expenseInvoiceNo", payload.invoiceNo || "");
    setSelectValue("expenseCategory", payload.category || "ค่าใช้จ่ายทั่วไป");
    assign("expenseDescription", payload.description || payload.category || "");
    assign("expenseAmountInput", payload.amountInput || "");
    setSelectValue("expenseAmountMode", payload.amountMode || "exclusive");
    setSelectValue("expenseVatMode", payload.vatMode || "none");
    setSelectValue("expenseWhtRate", String(payload.whtRate ?? 0));
    assign("expenseNotes", payload.notes || "");
    renderExpensePreview();
    $("expenseRecipientName")?.focus();
  }

  function applyInventoryFilterAction(action = {}) {
    location.hash = action.hash || "inventory-detail";
    state.query = action.query || "";
    state.sort = action.sort || "valueDesc";
    state.page = 1;
    const warehouseName = compactText(action.warehouseName || "");
    if (warehouseName) {
      const warehouse = (data.warehouseBreakdown || []).find((item) => compactText(item.warehouseName || item.stockSource || "").includes(warehouseName));
      state.warehouse = warehouse ? warehouseKey(warehouse) : "All";
    }
    const searchInput = $("searchInput");
    const sortSelect = $("sortSelect");
    if (searchInput) searchInput.value = state.query;
    if (sortSelect) sortSelect.value = state.sort;
    renderWarehouseFilters();
    renderFilters();
    renderTable();
  }

  function focusAssistantSection(action = {}) {
    const selector = action.selector || (action.hash ? `#${String(action.hash).replace(/^#/, "")}` : "");
    const target = selector ? document.querySelector(selector) : null;
    if (!target) return;
    const hash = String(action.hash || "").replace(/^#/, "");
    if (hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
      updateRouteState();
    }
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: action.block || "start", behavior: "smooth" });
      target.classList.remove("ai-focus-highlight");
      window.requestAnimationFrame(() => target.classList.add("ai-focus-highlight"));
      window.setTimeout(() => target.classList.remove("ai-focus-highlight"), 1800);
    });
  }

  async function applyStockUpdateAction(action = {}) {
    if (!supabaseDirectConfigured() && !ensureRemoteSyncConfig("flowaccount")) {
      pushAssistantMessage(
        "assistant",
        "\u0e22\u0e31\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock \u0e2d\u0e2d\u0e19\u0e44\u0e25\u0e19\u0e4c\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: \u0e15\u0e49\u0e2d\u0e07\u0e21\u0e35 Cloud/Supabase write server \u0e01\u0e48\u0e2d\u0e19",
        []
      );
      return;
    }
    setAssistantBusy(true);
    pushAssistantMessage("assistant", "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock \u0e41\u0e25\u0e30 publish dashboard...", []);
    try {
      const payload = await saveWebsiteStockAdjustment(action.payload || action);
      pushAssistantMessage(
        "assistant",
        payload.message ||
          "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 \u0e23\u0e2d GitHub Pages \u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48",
        [{ type: "filterInventory", label: "\u0e14\u0e39 SKU", query: action.payload?.sku || "", sort: "valueDesc", hash: "inventory-detail" }]
      );
      if (!supabaseDirectConfigured()) setTimeout(() => window.location.reload(), remoteSyncApiBase ? 25000 : 1200);
    } catch (error) {
      pushAssistantMessage("assistant", `\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ${syncNetworkErrorMessage(error)}`, []);
    } finally {
      setAssistantBusy(false);
    }
  }

  function executeAssistantAction(action) {
    if (!action) return;
    if (action.type === "navigate") {
      location.hash = action.hash || "executive";
      return;
    }
    if (action.type === "filterInventory") {
      applyInventoryFilterAction(action);
      return;
    }
    if (action.type === "focusSection") {
      focusAssistantSection(action);
      return;
    }
    if (action.type === "fillExpenseForm") {
      fillExpenseForm(action.payload || {});
      return;
    }
    if (action.type === "stockUpdate") {
      applyStockUpdateAction(action);
    }
  }

  function autoRunAssistantActions(actions = []) {
    const safeAction = actions.find((action) => ["navigate", "filterInventory", "focusSection"].includes(action?.type) && action.autoRun !== false);
    if (!safeAction) return;
    window.requestAnimationFrame(() => executeAssistantAction(safeAction));
  }

  function shouldUseClientAssistant(payload, promptText) {
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    if (!actions.length) return false;
    if (/สร้าง.*ค่าใช้จ่าย|ลง.*ค่าใช้จ่าย|บันทึก.*ค่าใช้จ่าย/.test(compactText(promptText))) return false;
    return actions.some((action) => ["navigate", "filterInventory", "focusSection"].includes(action?.type));
  }

  function assistantImageNotice(attachments = []) {
    if (!attachments.length) return null;
    return {
      reply:
        `รับรูปภาพ ${fmtInt.format(attachments.length)} รูปแล้วครับ ` +
        "ตอนนี้แนบรูปไว้ในแชทได้แล้ว ถ้าต้องการให้ผมทำอะไรต่อให้พิมพ์คำสั่งประกอบ เช่น ค้นหา SKU จากรูป, เปิดตารางสินค้า หรือบันทึกข้อมูลจากรูป",
      actions: [],
      source: "rule",
    };
  }

  async function sendAssistantPrompt(prompt, attachments = []) {
    const text = String(prompt || "").trim();
    const messageAttachments = Array.isArray(attachments) ? attachments : [];
    if ((!text && !messageAttachments.length) || assistantState.busy) return;
    pushAssistantMessage("user", text || `แนบรูปภาพ ${fmtInt.format(messageAttachments.length)} รูป`, [], messageAttachments);
    setAssistantBusy(true);
    try {
      let payload;
      const clientPayload = text ? runClientRuleAssistant(text) : assistantImageNotice(messageAttachments);
      if (!text) {
        payload = clientPayload;
      } else if ((staticReportHost && !remoteSyncApiBase) || shouldUseClientAssistant(clientPayload, text)) {
        payload = clientPayload;
      } else {
        const response = await fetch(
          expenseApiUrl("/api/assistant"),
          expenseFetchOptions("POST", {
            message: text,
            attachments: messageAttachments.map((item) => ({
              name: item.name,
              type: item.type,
              size: item.size,
            })),
          })
        );
        payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.message || `Status ${response.status}`);
      }
      $("assistantMode").textContent = payload.source === "openai" ? "OpenAI Assistant" : "Web Command";
      const actions = Array.isArray(payload.actions) ? payload.actions : [];
      pushAssistantMessage("assistant", payload.reply || "-", actions);
      autoRunAssistantActions(actions);
      if (payload.warning) pushAssistantMessage("assistant", payload.warning, []);
    } catch (error) {
      const fallback = text ? runClientRuleAssistant(text, { fallback: true, error }) : assistantImageNotice(messageAttachments);
      $("assistantMode").textContent = "Web Command";
      const actions = Array.isArray(fallback.actions) ? fallback.actions : [];
      pushAssistantMessage("assistant", fallback.reply || `สั่งงานไม่สำเร็จ: ${error.message}`, actions);
      autoRunAssistantActions(actions);
    } finally {
      setAssistantBusy(false);
    }
  }

  function attachmentId() {
    return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          id: attachmentId(),
          name: file.name || "clipboard-image.png",
          type: file.type || "image/png",
          size: file.size || 0,
          dataUrl: String(reader.result || ""),
        });
      reader.onerror = () => reject(reader.error || new Error("อ่านรูปภาพไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }

  async function addAssistantImageFiles(files = []) {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const current = assistantState.attachments || [];
    const availableSlots = Math.max(0, 4 - current.length);
    const imageFiles = Array.from(files)
      .filter((file) => allowed.has(file.type) && file.size <= 5 * 1024 * 1024)
      .slice(0, availableSlots);
    if (!imageFiles.length) {
      pushAssistantMessage("assistant", "แนบรูปไม่สำเร็จ: รองรับ PNG, JPG, WebP, GIF ขนาดไม่เกิน 5 MB และแนบได้สูงสุด 4 รูปต่อครั้ง", []);
      return;
    }
    try {
      const next = await Promise.all(imageFiles.map(readImageFile));
      assistantState.attachments = [...current, ...next];
      renderAssistantAttachments();
      openAssistantPanel(false);
    } catch (error) {
      pushAssistantMessage("assistant", `แนบรูปไม่สำเร็จ: ${error.message}`, []);
    }
  }

  function clearAssistantAttachments() {
    assistantState.attachments = [];
    renderAssistantAttachments();
    const fileInput = $("assistantImageInput");
    if (fileInput) fileInput.value = "";
  }

  function bindAssistantEvents() {
    renderAssistantThread();
    renderAssistantAttachments();
    $("assistantFab")?.addEventListener("click", () => openAssistantPanel(true));
    $("assistantClose")?.addEventListener("click", closeAssistantPanel);
    $("assistantAttach")?.addEventListener("click", () => $("assistantImageInput")?.click());
    $("assistantImageInput")?.addEventListener("change", (event) => {
      addAssistantImageFiles(event.target.files || []);
    });
    $("assistantAttachmentPreview")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-attachment]");
      if (!button) return;
      assistantState.attachments = (assistantState.attachments || []).filter((item) => item.id !== button.dataset.removeAttachment);
      renderAssistantAttachments();
    });
    document.addEventListener("paste", (event) => {
      const panel = $("aiChatPanel");
      if (!panel || panel.hidden) return;
      if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return;
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      addAssistantImageFiles(files);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || $("aiChatPanel")?.hidden) return;
      closeAssistantPanel();
    });
    $("assistantForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("assistantInput");
      const prompt = input?.value || "";
      const attachments = [...(assistantState.attachments || [])];
      if (input) input.value = "";
      clearAssistantAttachments();
      sendAssistantPrompt(prompt, attachments);
    });
    document.querySelectorAll("[data-assistant-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.assistantPrompt || "";
        const attachments = [...(assistantState.attachments || [])];
        if ($("assistantInput")) $("assistantInput").value = prompt;
        clearAssistantAttachments();
        sendAssistantPrompt(prompt, attachments);
      });
    });
    $("assistantThread")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-assistant-action]");
      if (!button) return;
      const [messageIndex, actionIndex] = button.dataset.assistantAction.split(":").map((part) => Number(part));
      const action = assistantState.messages[messageIndex]?.actions?.[actionIndex];
      executeAssistantAction(action);
    });
  }

  function renderFreshness() {
    const { sources } = data.metadata;
    const flowWarehouses = (sources.flowaccount?.warehouses || []).map((item) => item.name).join(" / ");
    $("freshnessBand").innerHTML = [
      {
        title: "ข้อมูลคลัง Packhai",
        body: `${sources.packhai.exportedAtLabel || "-"} · ${fmtInt.format(sources.packhai.rowCount || 0)} แถว`,
      },
      {
        title: "ข้อมูลคลัง Website Stock",
        body: `${sources.flowaccount?.exportedAtLabel || "-"} · ${flowWarehouses || "คลัง ซ.เจริญกิจ / คลัง สุขสวัสดิ์"}`,
      },
      {
        title: "ราคาขาย Seller",
        body: `Shopee ${sources.shopee.exportedAtLabel || "-"} / Lazada ${sources.lazada.exportedAtLabel || "-"}`,
      },
      {
        title: "กติกาตีมูลค่า",
        body: "ใช้ราคา Shopee ก่อน ถ้าไม่พบจึงใช้ Lazada และ KTW ตามลำดับ",
      },
    ]
      .map((item) => `<div class="freshness-item"><strong>${item.title}</strong><span>${item.body}</span></div>`)
      .join("");
  }

  function getPlatformPaymentSummary() {
    const fallbackPlatform = (platform) => ({
      platform,
      targetOrderCount: 0,
      matchedOrderCount: 0,
      missingOrderCount: 0,
      collectedAmount: 0,
      coverage: 0,
    });
    const summary = data.summary?.platformPayment || data.platformPaymentSummary || {};
    const byPlatform = summary.byPlatform || {};
    return {
      platform: "All",
      targetOrderCount: Number(summary.targetOrderCount || 0),
      matchedOrderCount: Number(summary.matchedOrderCount || 0),
      missingOrderCount: Number(summary.missingOrderCount || 0),
      collectedAmount: Number(summary.collectedAmount || 0),
      coverage: Number(summary.coverage || 0),
      byPlatform: {
        Shopee: { ...fallbackPlatform("Shopee"), ...(byPlatform.Shopee || {}) },
        Lazada: { ...fallbackPlatform("Lazada"), ...(byPlatform.Lazada || {}) },
      },
    };
  }

  function renderPaymentCollectionReport() {
    const el = $("paymentCollectionReport");
    if (!el) return;
    const summary = getPlatformPaymentSummary();
    const source = data.metadata?.sources?.sellerPayments || {};
    const rows = [summary.byPlatform.Shopee, summary.byPlatform.Lazada];
    const cards = [
      {
        label: "ออเดอร์ขายออกจาก Platform",
        value: fmtInt.format(summary.targetOrderCount),
        sub: "นับจากรายการเดิน stock ที่ขายออกใน Packhai",
      },
      {
        label: "พบยอดเก็บเงินแล้ว",
        value: fmtInt.format(summary.matchedOrderCount),
        sub: `${safePercent(summary.coverage)} ของออเดอร์ platform`,
      },
      {
        label: "ยอดเก็บเงินที่ดึงได้",
        value: fmtBaht.format(summary.collectedAmount),
        sub: "ใช้ยอดจาก Shopee/Lazada Seller เท่านั้น",
      },
      {
        label: "ยังรอข้อมูล Seller",
        value: fmtInt.format(summary.missingOrderCount),
        sub: "ออเดอร์ขายออกที่ยังจับคู่ยอดเก็บเงินไม่ได้",
      },
    ];

    el.innerHTML = `
      <div class="section-heading payment-heading">
        <div>
          <h2>ภาพรวมสถานะการเก็บเงินจาก Platform</h2>
          <p>ตรวจยอดเก็บเงินจริงจาก Shopee/Lazada Seller เทียบกับรายการขายออกใน Packhai เพื่อดู coverage และออเดอร์ที่ยังขาดข้อมูล</p>
        </div>
        <span>อัปเดตยอดเก็บเงิน ${escapeHtml(source.exportedAtLabel || "-")} · ${fmtInt.format(source.rowCount || 0)} รายการ</span>
      </div>
      <div class="payment-report-grid">
        ${cards
          .map(
            (card) => `
          <article class="payment-report-card">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.sub)}</small>
          </article>`
          )
          .join("")}
      </div>
      <div class="payment-platform-list">
        ${rows
          .map((item) => {
            const coverage = Math.max(0, Math.min(1, Number(item.coverage || 0)));
            return `
            <article class="payment-platform-row">
              <div>
                <strong>${escapeHtml(item.platform)}</strong>
                <span>${fmtInt.format(item.matchedOrderCount || 0)} / ${fmtInt.format(item.targetOrderCount || 0)} ออเดอร์พบยอดเก็บเงิน</span>
              </div>
              <div class="payment-platform-meter" aria-label="${escapeHtml(item.platform)} payment coverage">
                <i style="width:${Math.round(coverage * 100)}%"></i>
              </div>
              <strong>${safePercent(coverage)}</strong>
              <span>${fmtBaht.format(item.collectedAmount || 0)}</span>
            </article>`;
          })
          .join("")}
      </div>`;
  }

  function renderSidebarStatus() {
    const target = $("sidebarUpdatedAt");
    if (!target) return;
    const sources = data.metadata?.sources || {};
    const latestLabel =
      sources.flowaccount?.exportedAtLabel ||
      sources.packhai?.exportedAtLabel ||
      sources.shopee?.exportedAtLabel ||
      sources.lazada?.exportedAtLabel ||
      "-";
    target.textContent = latestLabel;
  }

  function renderKpis() {
    const s = data.summary;
    const coverage = s.positiveStockRows ? (s.valuedPositiveRows / s.positiveStockRows) * 100 : 0;
    const cards = [
      {
        cls: "main",
        label: "มูลค่าคงเหลือรวม",
        value: fmtBaht.format(s.totalInventoryValue),
        sub: `คำนวณจาก ${fmtInt.format(s.valuedPositiveRows)} SKU ที่มี stock และพบราคา`,
      },
      {
        label: "จำนวนคงเหลือในคลัง",
        value: fmtQty.format(s.totalQuantity),
        sub: `${fmtInt.format(s.positiveStockRows)} แถวสินค้ามีจำนวนคงเหลือมากกว่า 0`,
      },
      {
        label: "Coverage ราคาสำหรับ stock",
        value: `${coverage.toFixed(1)}%`,
        sub: `${fmtInt.format(s.missingPositiveRows)} แถว stock บวกยังไม่มีราคา`,
      },
      {
        label: "มูลค่ารอจัดส่ง",
        value: fmtBaht.format(s.totalWaitingValue),
        sub: `จำนวนรอจัด/รอส่ง ${fmtQty.format(s.totalWaiting)} หน่วย`,
      },
    ];
    $("kpiGrid").innerHTML = cards
      .map(
        (card) => `
        <article class="kpi-card ${card.cls || ""}">
          <div class="label">${card.label}</div>
          <div class="value">${card.value}</div>
          <div class="sub">${card.sub}</div>
        </article>`
      )
      .join("");
  }

  function renderOwnerCommand() {
    const a = getOwnerAnalytics();
    $("ownerSummaryLine").textContent = `มีสินค้า stock บวก ${fmtInt.format(a.positiveRows)} รายการ มูลค่ารวม ${fmtBaht.format(
      a.totalValue
    )} โดย ${warehouseLabel(a.mainWarehouse)} ถือ ${safePercent(a.mainWarehouseShare)} ของมูลค่ารวม และ Top 10 SKU ถือ ${safePercent(
      a.top10Share
    )} ของเงินจมใน stock`;

    const commandItems = [
      {
        label: "เงินจมใน stock",
        value: fmtBaht.format(a.totalValue),
        note: `${fmtQty.format(data.summary.totalQuantity || 0)} หน่วย`,
      },
      {
        label: "Top 10 SKU",
        value: safePercent(a.top10Share),
        note: `${fmtBaht.format(a.top10Value)} ของมูลค่ารวม`,
      },
      {
        label: "ยังไม่มีราคาขาย",
        value: fmtInt.format(a.missingRows),
        note: `${fmtQty.format(a.missingQty)} หน่วยต้องตรวจ`,
      },
    ];

    $("ownerCommandPanel").innerHTML = commandItems
      .map(
        (item) => `
        <article class="command-tile">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.note)}</small>
        </article>`
      )
      .join("");
  }

  function renderOwnerAnalytics() {
    const a = getOwnerAnalytics();
    const cards = [
      {
        tone: "cash",
        label: "Cash Tied In Inventory",
        value: fmtBaht.format(a.totalValue),
        body: `เฉลี่ย ${fmtBaht.format(a.avgValuePerSku)} ต่อรายการที่มี stock`,
        bar: 100,
      },
      {
        tone: "risk",
        label: "Concentration Risk",
        value: safePercent(a.top10Share),
        body: `Top 10 SKU ถือมูลค่า ${fmtBaht.format(a.top10Value)}`,
        bar: a.top10Share * 100,
      },
      {
        tone: "coverage",
        label: "Price Coverage",
        value: safePercent(a.coverage),
        body: `${fmtInt.format(a.missingRows)} รายการ / ${fmtQty.format(a.missingQty)} หน่วย ยังไม่มีราคา`,
        bar: a.coverage * 100,
      },
      {
        tone: "ops",
        label: "Waiting To Ship",
        value: fmtBaht.format(a.waitingValue),
        body: `${fmtQty.format(a.waitingQty)} หน่วยอยู่ในสถานะรอจัด/รอส่ง`,
        bar: a.totalValue ? (a.waitingValue / a.totalValue) * 100 : 0,
      },
    ];

    $("ownerAnalyticsGrid").innerHTML = cards
      .map(
        (card) => `
        <article class="owner-card ${card.tone}">
          <div>
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <p>${escapeHtml(card.body)}</p>
          </div>
          <div class="owner-card-bar"><i style="width:${Math.max(2, Math.min(100, card.bar))}%"></i></div>
        </article>`
      )
      .join("");
  }

  function renderDecisionSignals() {
    const a = getOwnerAnalytics();
    const signals = [
      {
        title: "ตรวจสินค้ามูลค่าสูงก่อน",
        value: `Top 10 = ${safePercent(a.top10Share)}`,
        text: "ถ้าสินค้ากลุ่มนี้ราคาไม่ถูกหรือ stock ผิด มูลค่ารวมจะเพี้ยนมากที่สุด",
      },
      {
        title: "ปิดช่องว่างสินค้าที่ไม่มีราคา",
        value: `${fmtInt.format(a.missingRows)} รายการ`,
        text: "ควรเติมราคาขายหรือจับคู่ SKU เพิ่ม เพื่อให้มูลค่าคลังไม่ต่ำกว่าความจริง",
      },
      {
        title: "ดูคลังที่ถือเงินมากที่สุด",
        value: `${warehouseLabel(a.mainWarehouse)} ${safePercent(a.mainWarehouseShare)}`,
        text: "ใช้จัดลำดับตรวจนับ stock และวางแผนย้าย/เติมสินค้าในคลังรอง",
      },
      {
        title: "ติดตามงานรอจัดส่ง",
        value: fmtBaht.format(a.waitingValue),
        text: "มูลค่านี้คือ stock ที่กำลังออกจากคลัง ควรเทียบกับคำสั่งซื้อและ SLA รายวัน",
      },
    ];

    $("decisionSignals").innerHTML = signals
      .map(
        (item) => `
        <article class="decision-item">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.text)}</p>
          </div>
          <b>${escapeHtml(item.value)}</b>
        </article>`
      )
      .join("");
  }

  function renderMetricRoadmap() {
    const metrics = [
      {
        name: "Gross Margin / GM%",
        formula: "ราคาขาย - ต้นทุนสินค้า - fee platform - ค่าส่งที่ร้านรับ",
        need: "ต้องเพิ่มต้นทุนต่อ SKU, ค่าธรรมเนียม Shopee/Lazada, โปรโมชัน/ค่าส่ง",
      },
      {
        name: "Sales Velocity",
        formula: "ยอดขายต่อวันเฉลี่ย 30/60/90 วัน แยก SKU และช่องทางขาย",
        need: "ต้องเพิ่ม order history จาก Shopee, Lazada, POS หรือ ERP",
      },
      {
        name: "Days Of Inventory",
        formula: "จำนวนคงเหลือ / ยอดขายเฉลี่ยต่อวัน",
        need: "ใช้คู่กับ Sales Velocity เพื่อบอกว่าสินค้าอยู่ได้อีกกี่วัน",
      },
      {
        name: "Dead Stock Risk",
        formula: "stock ที่ไม่มียอดขายใน X วัน หรือไม่เคลื่อนไหวนานเกินเกณฑ์",
        need: "ต้องเพิ่มวันที่รับเข้า, วันที่ขายล่าสุด, movement รายคลัง",
      },
      {
        name: "Reorder Point",
        formula: "(ยอดขายเฉลี่ยต่อวัน x lead time) + safety stock",
        need: "ต้องเพิ่ม lead time supplier, MOQ, safety stock และยอดขายเฉลี่ย",
      },
      {
        name: "GMROI",
        formula: "กำไรขั้นต้น / มูลค่าต้นทุนสินค้าคงคลังเฉลี่ย",
        need: "ต้องมีต้นทุนสินค้าและยอดขายตามช่วงเวลา เพื่อวัดว่า stock ใช้เงินคุ้มไหม",
      },
    ];

    $("metricRoadmap").innerHTML = metrics
      .map(
        (item) => `
        <article class="metric-item">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.formula)}</span>
          <p>${escapeHtml(item.need)}</p>
        </article>`
      )
      .join("");
  }

  function renderSourceBars() {
    const maxValue = Math.max(...data.sourceBreakdown.map((item) => item.value), 1);
    $("sourceBars").innerHTML = data.sourceBreakdown
      .map((item) => {
        const width = Math.max(1, (item.value / maxValue) * 100);
        return `
          <div class="source-row">
            <div class="source-label">${sourceLabel(item.source)}</div>
            <div class="bar-track"><div class="bar-fill ${item.source}" style="width:${width}%"></div></div>
            <div class="source-value">${fmtBaht.format(item.value)} · ${fmtInt.format(item.positiveStockRows)} SKU</div>
          </div>`;
      })
      .join("");
  }

  function renderWarehouseBars() {
    const warehouses = data.warehouseBreakdown || [];
    const maxValue = Math.max(...warehouses.map((item) => item.value), 1);
    $("warehouseBars").innerHTML = warehouses
      .map((item) => {
        const width = Math.max(1, (item.value / maxValue) * 100);
        return `
          <div class="source-row">
            <div class="source-label">${escapeHtml(item.warehouseName || item.stockSource || "-")}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
            <div class="source-value">${fmtBaht.format(item.value)} · ${fmtInt.format(item.positiveStockRows)} SKU</div>
          </div>`;
      })
      .join("");
  }

  function renderWarehouseProductGroups() {
    const warehouses = data.warehouseBreakdown || [];
    const target = $("warehouseProductGroups");
    if (!target) return;
    if (!warehouses.length) {
      target.innerHTML = `<p class="empty-note">ยังไม่มีข้อมูลคลังสินค้า</p>`;
      return;
    }

    target.innerHTML = warehouses
      .map((warehouse) => {
        const key = warehouseKey(warehouse);
        const items = rows
          .filter((row) => warehouseKey(row) === key && row.quantity > 0)
          .sort((a, b) => b.inventoryValue - a.inventoryValue || b.quantity - a.quantity)
          .slice(0, 5);

        return `
          <article class="warehouse-product-card">
            <header>
              <div>
                <p>${escapeHtml(warehouse.stockSource || "-")}</p>
                <h3>${escapeHtml(warehouseLabel(warehouse))}</h3>
              </div>
              <strong>${fmtBaht.format(warehouse.value || 0)}</strong>
            </header>
            <div class="warehouse-product-meta">
              <span>${fmtQty.format(warehouse.quantity || 0)} หน่วย</span>
              <span>${fmtInt.format(warehouse.positiveStockRows || 0)} รายการมี stock</span>
              <span>ซ่อนรายการคงเหลือ 0</span>
            </div>
            <ol class="warehouse-product-list">
              ${
                items.length
                  ? items
                      .map(
                        (row) => `
                          <li class="detail-list-item" data-detail-id="${escapeHtml(detailIdForRow(row))}" tabindex="0" role="button" aria-label="ดูรายละเอียดสินค้า ${escapeHtml(row.sku || row.name || "")}">
                            ${productImage(row, "warehouse")}
                            <div>
                              <strong>${escapeHtml(row.name || "-")}</strong>
                              <span>${escapeHtml(row.sku || "-")} · ${fmtQty.format(row.quantity)} หน่วย · ${sourceLabel(row.priceSource)}</span>
                            </div>
                            <b>${fmtBaht.format(row.inventoryValue || 0)}</b>
                          </li>`
                      )
                      .join("")
                  : `<li class="empty-note">ไม่มีรายการที่มี stock มากกว่า 0 ในคลังนี้</li>`
              }
            </ol>
          </article>`;
      })
      .join("");
  }

  function renderTopProducts() {
    $("topProducts").innerHTML = data.topProducts
      .slice(0, 8)
      .map(
        (row) => `
        <li class="detail-list-item" data-detail-id="${escapeHtml(detailIdForRow(row))}" tabindex="0" role="button" aria-label="ดูรายละเอียดสินค้า ${escapeHtml(row.sku || row.name || "")}">
          ${productImage(row, "top")}
          <div>
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.sku)} · ${fmtQty.format(row.quantity)} หน่วย · ${sourceLabel(row.priceSource)}</span>
          </div>
          <b>${fmtBaht.format(row.inventoryValue)}</b>
        </li>`
      )
      .join("");
  }

  function renderPrefixGrid() {
    const maxValue = Math.max(...data.prefixBreakdown.map((item) => item.value), 1);
    $("prefixGrid").innerHTML = data.prefixBreakdown
      .slice(0, 12)
      .map(
        (item) => `
        <div class="prefix-item">
          <strong>${escapeHtml(item.prefix)}</strong>
          <div class="mini-bar"><span style="width:${Math.max(2, (item.value / maxValue) * 100)}%"></span></div>
          <p>${fmtBaht.format(item.value)} · ${fmtQty.format(item.quantity)} หน่วย · ${fmtInt.format(item.rowCount)} แถว</p>
        </div>`
      )
      .join("");
  }

  function renderFilters() {
    const chips = [
      { source: "All", label: `ทั้งหมด (${fmtInt.format(stockRows.length)})` },
      ...data.sourceBreakdown.map((item) => ({
        source: item.source,
        label: `${sourceLabel(item.source)} (${fmtInt.format(item.positiveStockRows || 0)})`,
      })),
    ];
    $("sourceFilters").innerHTML = chips
      .map(
        (chip) => `
        <button class="filter-chip ${state.source === chip.source ? "active" : ""}" type="button" data-source="${chip.source}">
          ${chip.label}
        </button>`
      )
      .join("");
    document.querySelectorAll("#sourceFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.source = button.dataset.source;
        state.page = 1;
        renderTable();
        renderFilters();
      });
    });
  }

  function renderWarehouseFilters() {
    const chips = [
      { key: "All", label: `ทุกคลัง (${fmtInt.format(stockRows.length)})` },
      ...(data.warehouseBreakdown || []).map((item) => ({
        key: warehouseKey(item),
        label: `${warehouseLabel(item)} (${fmtInt.format(item.positiveStockRows || 0)})`,
      })),
    ];

    $("warehouseFilters").innerHTML = chips
      .map(
        (chip) => `
        <button class="filter-chip ${state.warehouse === chip.key ? "active" : ""}" type="button" data-warehouse="${escapeHtml(chip.key)}">
          ${escapeHtml(chip.label)}
        </button>`
      )
      .join("");
    document.querySelectorAll("#warehouseFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.warehouse = button.dataset.warehouse;
        state.page = 1;
        renderTable();
        renderWarehouseFilters();
      });
    });
  }

  function filteredRows() {
    const query = compactText(state.query);
    let next = stockRows;
    if (state.warehouse !== "All") {
      next = next.filter((row) => warehouseKey(row) === state.warehouse);
    }
    if (state.source !== "All") {
      next = next.filter((row) => row.priceSource === state.source);
    }
    if (query) {
      next = next.filter((row) =>
        compactText(
          `${row.sku} ${row.name} ${row.barcode} ${row.sourceTitle} ${row.warehouseName} ${row.stockSourceLabel} ${row.latestStockMovementReferenceNo} ${row.latestStockMovementDescription}`
        ).includes(query)
      );
    }

    return sortInventoryRows(next);
  }

  function renderTable() {
    const rawRows = filteredRows();
    const all = aggregateSkuRows(rawRows);
    const maxPage = Math.max(1, Math.ceil(all.length / pageSize));
    state.page = Math.min(state.page, maxPage);
    const start = (state.page - 1) * pageSize;
    const pageRows = all.slice(start, start + pageSize);

    $("inventoryRows").innerHTML = pageRows
      .map(
        (row) => `
        <tr class="detail-table-row" data-detail-id="${escapeHtml(detailIdForRow(row))}" tabindex="0" role="button" aria-label="ดูรายละเอียดสินค้า ${escapeHtml(row.sku || row.name || "")}">
          <td>${productImage(row)}</td>
          <td class="sku-cell">${escapeHtml(row.sku || "-")}</td>
          ${warehouseCell(row)}
          <td>
            <div class="product-name">${escapeHtml(row.name || "-")}</div>
            <div class="detail-link">ดูรายละเอียด</div>
            ${row.note ? `<div class="product-note">${escapeHtml(row.note)}</div>` : ""}
          </td>
          <td class="num">${fmtQty.format(row.quantity)}</td>
          <td class="num">${fmtQty.format(row.waiting)}</td>
          <td class="num">${fmtQty.format(row.available)}</td>
          <td>${movementCell(row)}</td>
          <td class="num">${row.price > 0 ? fmtBaht2.format(row.price) : "-"}</td>
          <td><span class="badge ${sourceColors[row.priceSource] || "Missing"}">${sourceLabel(row.priceSource)}</span></td>
          <td class="num"><strong>${fmtBaht.format(row.inventoryValue)}</strong></td>
        </tr>`
      )
      .join("");

    const sourceText = state.source === "All" ? "ทุกแหล่งราคา" : sourceLabel(state.source);
    const startRow = all.length ? start + 1 : 0;
    $("tableSubtitle").textContent = `แสดง ${fmtInt.format(all.length)} SKU ที่มีคงเหลือ (${fmtInt.format(rawRows.length)} แถวคลัง) จากทั้งหมด ${fmtInt.format(stockRows.length)} แถวคลัง · คลัง: ${selectedWarehouseLabel()} · ราคา: ${sourceText}`;
    $("paginationStatus").textContent = `หน้า ${fmtInt.format(state.page)} / ${fmtInt.format(maxPage)} · SKU ${fmtInt.format(startRow)}-${fmtInt.format(Math.min(start + pageSize, all.length))}`;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= maxPage;
  }

  function renderMethodology() {
    $("methodologyText").textContent = `${data.metadata.valuationRule}. ${data.metadata.quantityRule}. แถวที่ไม่พบราคาจะไม่ถูกบวกในมูลค่ารวม และแสดงเป็นกลุ่ม Missing เพื่อให้ตรวจสอบต่อได้`;
    const sourceCards = [
      ["Packhai", `${data.metadata.sources.packhai.exportedAtLabel} · ${data.metadata.sources.packhai.rowCount} rows`],
      [
        "Website Stock",
        `${data.metadata.sources.flowaccount?.exportedAtLabel || "-"} · ${fmtInt.format(data.metadata.sources.flowaccount?.rowCount || 0)} rows`,
      ],
      ["Shopee Seller", `${data.metadata.sources.shopee.exportedAtLabel} · indexed ${fmtInt.format(data.metadata.sources.shopee.indexedPriceRows)} price rows`],
      ["Lazada Seller", `${data.metadata.sources.lazada.exportedAtLabel} · indexed ${fmtInt.format(data.metadata.sources.lazada.indexedPriceRows)} price rows`],
      ["KTW", `${data.metadata.sources.ktw.createdAtLabel} · ${fmtInt.format(data.metadata.sources.ktw.itemCount)} source items`],
    ];
    $("sourceTable").innerHTML = sourceCards
      .map((card) => `<div class="source-card"><strong>${card[0]}</strong><span>${card[1]}</span></div>`)
      .join("");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
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
      "Note",
    ];
    const lines = [
      headers.join(","),
      ...filteredRows().map((row) =>
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
          row.note,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "packhai-inventory-valuation-filtered.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    $("syncAll")?.addEventListener("click", () => startSync("all"));
    $("syncPackhai")?.addEventListener("click", () => startSync("packhai"));
    $("syncFlowaccount")?.addEventListener("click", () => startSync("flowaccount"));
    $("syncSeller")?.addEventListener("click", () => startSync("seller"));
    $("syncSellerPayments")?.addEventListener("click", () => startSync("seller-payments"));
    $("searchInput").addEventListener("input", (event) => {
      state.query = event.target.value;
      state.page = 1;
      renderTable();
    });
    $("sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.page = 1;
      renderTable();
    });
    $("sortValue").addEventListener("click", () => {
      state.sort = "valueDesc";
      $("sortSelect").value = "valueDesc";
      state.page = 1;
      renderTable();
    });
    $("prevPage").addEventListener("click", () => {
      state.page -= 1;
      renderTable();
    });
    $("nextPage").addEventListener("click", () => {
      state.page += 1;
      renderTable();
    });
    window.addEventListener("hashchange", updateRouteState);
    $("downloadCsv").addEventListener("click", exportCsv);
    $("printReport").addEventListener("click", () => window.print());
    $("closeProductDetail")?.addEventListener("click", closeProductDetail);
    $("closeStockAdjust")?.addEventListener("click", closeStockAdjustModal);
    $("stockAdjustForm")?.addEventListener("submit", submitStockAdjustment);
    document.addEventListener("click", (event) => {
      const stockAdjustTarget = event.target.closest("[data-stock-adjust-id]");
      if (stockAdjustTarget) {
        event.preventDefault();
        event.stopPropagation();
        openStockAdjustModal(rowByDetailId.get(stockAdjustTarget.dataset.stockAdjustId));
        return;
      }
      if (event.target.closest("[data-close-stock-adjust]")) {
        closeStockAdjustModal();
        return;
      }
      if (event.target.closest("[data-close-detail]")) {
        closeProductDetail();
        return;
      }
      const detailTarget = event.target.closest("[data-detail-id]");
      if (!detailTarget) return;
      openProductDetailById(detailTarget.dataset.detailId);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeStockAdjustModal();
        closeProductDetail();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const detailTarget = event.target.closest("[data-detail-id]");
      if (!detailTarget) return;
      event.preventDefault();
      openProductDetailById(detailTarget.dataset.detailId);
    });
  }

  refreshDerivedInventoryData();
  renderFreshness();
  renderSidebarStatus();
  renderKpis();
  renderPaymentCollectionReport();
  renderOwnerCommand();
  renderOwnerAnalytics();
  renderDecisionSignals();
  renderMetricRoadmap();
  renderSourceBars();
  renderWarehouseBars();
  renderWarehouseProductGroups();
  renderTopProducts();
  renderPrefixGrid();
  renderWarehouseFilters();
  renderFilters();
  renderTable();
  renderMethodology();
  initExpenseDefaults();
  bindEvents();
  bindAssistantEvents();
  bindExpenseEvents();
  updateRouteState();
  if (syncApiUnavailable) {
    renderStaticSyncNotice("seller-payments");
  } else {
    getSyncStatus(true);
  }
  loadLiveWebsiteStockFromSupabase().catch((error) => {
    console.warn("Supabase website stock snapshot failed", error);
  });
})();
