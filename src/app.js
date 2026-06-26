(function () {
  const data = window.__PACKHAI_DASHBOARD__;
  const rows = data.rows || [];
  const stockRows = rows.filter((row) => Number(row.quantity || 0) > 0);
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

  function valueOrDash(value) {
    if (value == null || value === "") return "-";
    return value;
  }

  function detailIdForRow(row) {
    if (row.detailId) return row.detailId;
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

  function openProductDetailById(detailId) {
    const row = rowByDetailId.get(detailId);
    if (!row) return;
    openProductDetail(row);
  }

  function openProductDetail(row) {
    const modal = $("productDetailModal");
    const content = $("productDetailContent");
    if (!modal || !content) return;

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
    document.body.classList.remove("modal-open");
  }

  const syncLabels = {
    all: "Sync ทั้งหมด",
    packhai: "Sync คลัง Packhai",
    flowaccount: "Sync คลัง FlowAccount",
    seller: "Sync ราคาขาย Seller",
    expenses: "ระบบค่าใช้จ่าย",
  };
  let syncPollTimer = null;
  let syncStartedHere = false;
  const staticReportHost = window.location.protocol === "file:" || /(^|\.)github\.io$/i.test(window.location.hostname);
  const syncDefaultTitles = {
    syncAll: "Sync Packhai stock and seller prices",
    syncPackhai: "Sync Packhai stock",
    syncFlowaccount: "Sync FlowAccount stock",
    syncSeller: "Sync Seller prices",
  };
  let remoteSyncApiBase = normalizeSyncApiBase(
    window.__PACKHAI_SYNC_API_BASE__ || localStorage.getItem("packhaiSyncApiBase") || ""
  );
  if (remoteSyncApiBase) {
    localStorage.setItem("packhaiSyncApiBase", remoteSyncApiBase);
  }
  let syncApiUnavailable = staticReportHost && !remoteSyncApiBase;

  function normalizeSyncApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function syncApiUrl(path) {
    if (!staticReportHost) return path;
    return remoteSyncApiBase ? `${remoteSyncApiBase}${path}` : path;
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
        button.title = "Online sync needs the main sync server";
        button.setAttribute("aria-label", `${button.textContent.trim()} - local sync only`);
      } else {
        button.title = syncDefaultTitles[button.id] || button.title;
        button.removeAttribute("aria-label");
      }
    });
  }

  function renderStaticSyncNotice(type = "all") {
    const el = $("syncStatus");
    if (!el) return;
    setStaticSyncMode(true);
    el.hidden = false;
    el.className = "sync-status warning";
    const label = syncLabels[type] || "Sync data";
    el.innerHTML = `
      <div>
        <strong>Online Sync setup · ${escapeHtml(label)}</strong>
        <span>This website needs the main Sync server URL before another computer can run warehouse and seller sync.</span>
        <small>Ask the main computer for the Sync API URL, then click Sync again.</small>
      </div>
      <code>GitHub Pages</code>`;
  }

  function ensureRemoteSyncConfig(type) {
    if (!staticReportHost) return true;
    if (!remoteSyncApiBase) {
      const base = window.prompt("ใส่ Sync API URL จากเครื่องหลัก เช่น https://xxxx.trycloudflare.com");
      if (!base) {
        syncApiUnavailable = true;
        renderStaticSyncNotice(type);
        return false;
      }
      remoteSyncApiBase = normalizeSyncApiBase(base);
      localStorage.setItem("packhaiSyncApiBase", remoteSyncApiBase);
      syncApiUnavailable = false;
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
    return [$("syncAll"), $("syncPackhai"), $("syncFlowaccount"), $("syncSeller")].filter(Boolean);
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
            (status.type === "seller" && button.id === "syncSeller"))
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
      renderSyncStatus(status, showIdle);
      if (status.running) {
        clearTimeout(syncPollTimer);
        syncPollTimer = setTimeout(() => getSyncStatus(true), 1500);
      } else if (syncStartedHere && status.ok) {
        syncStartedHere = false;
        setTimeout(() => window.location.reload(), remoteSyncApiBase ? 25000 : 1200);
      }
    } catch (error) {
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
    if (!ensureRemoteSyncConfig(type)) return;
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
  };
  const assistantState = {
    messages: [
      {
        role: "assistant",
        text: "พิมพ์คำถามหรือคำสั่งได้เลย เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, หรือสร้าง draft ค่าใช้จ่าย",
        actions: [],
      },
    ],
    busy: false,
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

  function renderAssistantThread() {
    const thread = $("assistantThread");
    if (!thread) return;
    thread.innerHTML = assistantState.messages
      .map(
        (message, messageIndex) => `
          <article class="assistant-message ${message.role}">
            <span>${message.role === "user" ? "คุณ" : "AI"}</span>
            <p>${escapeHtml(message.text || "").replace(/\n/g, "<br>")}</p>
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
    if (submit) submit.disabled = busy;
    if (input) input.disabled = busy;
    if (submit) submit.textContent = busy ? "กำลังคิด..." : "ส่งคำสั่ง";
  }

  function pushAssistantMessage(role, text, actions = []) {
    assistantState.messages.push({ role, text, actions });
    renderAssistantThread();
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
    if (action.type === "fillExpenseForm") {
      fillExpenseForm(action.payload || {});
    }
  }

  async function sendAssistantPrompt(prompt) {
    const text = String(prompt || "").trim();
    if (!text || assistantState.busy) return;
    if (!ensureRemoteSyncConfig("assistant")) return;
    pushAssistantMessage("user", text);
    setAssistantBusy(true);
    try {
      const response = await fetch(expenseApiUrl("/api/assistant"), expenseFetchOptions("POST", { message: text }));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || `Status ${response.status}`);
      $("assistantMode").textContent = payload.source === "openai" ? "OpenAI Assistant" : "Rule Assistant";
      pushAssistantMessage("assistant", payload.reply || "-", payload.actions || []);
      if (payload.warning) pushAssistantMessage("assistant", payload.warning, []);
    } catch (error) {
      pushAssistantMessage("assistant", `สั่งงานไม่สำเร็จ: ${error.message}`, []);
    } finally {
      setAssistantBusy(false);
    }
  }

  function bindAssistantEvents() {
    renderAssistantThread();
    $("assistantForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("assistantInput");
      const prompt = input?.value || "";
      if (input) input.value = "";
      sendAssistantPrompt(prompt);
    });
    document.querySelectorAll("[data-assistant-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.assistantPrompt || "";
        if ($("assistantInput")) $("assistantInput").value = prompt;
        sendAssistantPrompt(prompt);
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
        title: "ข้อมูลคลัง FlowAccount",
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

    const sorted = [...next];
    sorted.sort((a, b) => {
      if (state.sort === "qtyDesc") return b.quantity - a.quantity || b.inventoryValue - a.inventoryValue;
      if (state.sort === "priceDesc") return b.price - a.price || b.inventoryValue - a.inventoryValue;
      if (state.sort === "movementDesc") return movementDateValue(b) - movementDateValue(a) || b.inventoryValue - a.inventoryValue;
      if (state.sort === "nameAsc") return a.name.localeCompare(b.name, "th") || a.sku.localeCompare(b.sku, "en");
      if (state.sort === "sourceAsc") return a.priceSourcePriority - b.priceSourcePriority || b.inventoryValue - a.inventoryValue;
      return b.inventoryValue - a.inventoryValue || b.quantity - a.quantity;
    });
    return sorted;
  }

  function renderTable() {
    const all = filteredRows();
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
          <td class="warehouse-cell">
            <strong>${escapeHtml(row.stockSource || "-")}</strong>
            <span>${escapeHtml(row.warehouseName || "-")}</span>
          </td>
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
    $("tableSubtitle").textContent = `แสดง ${fmtInt.format(all.length)} รายการที่มีคงเหลือ จากทั้งหมด ${fmtInt.format(stockRows.length)} รายการ · คลัง: ${selectedWarehouseLabel()} · ราคา: ${sourceText}`;
    $("paginationStatus").textContent = `หน้า ${fmtInt.format(state.page)} / ${fmtInt.format(maxPage)} · แถว ${fmtInt.format(startRow)}-${fmtInt.format(Math.min(start + pageSize, all.length))}`;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= maxPage;
  }

  function renderMethodology() {
    $("methodologyText").textContent = `${data.metadata.valuationRule}. ${data.metadata.quantityRule}. แถวที่ไม่พบราคาจะไม่ถูกบวกในมูลค่ารวม และแสดงเป็นกลุ่ม Missing เพื่อให้ตรวจสอบต่อได้`;
    const sourceCards = [
      ["Packhai", `${data.metadata.sources.packhai.exportedAtLabel} · ${data.metadata.sources.packhai.rowCount} rows`],
      [
        "FlowAccount",
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
    $("downloadCsv").addEventListener("click", exportCsv);
    $("printReport").addEventListener("click", () => window.print());
    $("closeProductDetail")?.addEventListener("click", closeProductDetail);
    document.addEventListener("click", (event) => {
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

  renderFreshness();
  renderSidebarStatus();
  renderKpis();
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
  loadExpenses(true);
  if (syncApiUnavailable) {
    setStaticSyncMode(true);
  } else {
    getSyncStatus(false);
  }
})();
