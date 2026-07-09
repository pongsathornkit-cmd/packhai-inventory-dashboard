const SUPABASE_URL = "https://fabfhzcsppniuwtdwvfg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYmZoemNzcHBuaXV3dGR3dmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Njk3NjQsImV4cCI6MjA5ODI0NTc2NH0.2w3Wr8Bov2Jc-1PQw1KyVa99_B9jMFez8YXonZx8WGk";

const REVIEW_STORAGE_KEY = "peakProductCatalogReviewDraft:v1";
const TABLE_COLUMN_COUNT = 13;
const MARKET_MARKUPS = {
  thaimart: 0.07,
  lazada: 0.25,
  shopee: 0.3,
};

const REVIEW_OPTIONS = [
  { id: "all_correct", label: "ถูกต้องทุกอย่าง" },
  { id: "name_wrong", label: "ชื่อสินค้าผิด" },
  { id: "unit_unclear", label: "หน่วยสินค้าไม่ชัดเจน" },
  { id: "image_wrong", label: "รูปภาพสินค้าผิด" },
  { id: "low_profit", label: "กำไรน้อยไป" },
  { id: "other", label: "อื่นๆ" },
];

const EDITABLE_FIELDS = [
  "product_name",
  "vendor",
  "latest_purchase_bill",
  "latest_purchase_date",
  "latest_purchase_price",
  "latest_sale_price",
  "latest_sale_bill",
  "latest_sale_date",
];

const state = {
  products: [],
  query: "",
  vendor: "",
  sortMode: "sale-date-desc",
  selectedKeys: new Set(),
  reviewDrafts: loadReviewDrafts(),
  lightbox: {
    images: [],
    index: 0,
    productName: "",
    trigger: null,
  },
};

const els = {
  body: document.getElementById("catalogBody"),
  status: document.getElementById("catalogStatus"),
  resultCount: document.getElementById("resultCount"),
  search: document.getElementById("catalogSearch"),
  vendor: document.getElementById("vendorFilter"),
  sort: document.getElementById("sortMode"),
  refresh: document.getElementById("refreshCatalog"),
  csv: document.getElementById("downloadCatalogCsv"),
  metricProducts: document.getElementById("metricProducts"),
  metricVendors: document.getElementById("metricVendors"),
  metricLatestSale: document.getElementById("metricLatestSale"),
  reviewSelected: document.getElementById("reviewSelected"),
  reviewDraftCount: document.getElementById("reviewDraftCount"),
  reviewAiCount: document.getElementById("reviewAiCount"),
  selectVisibleRows: document.getElementById("selectVisibleRows"),
  clearSelectedRows: document.getElementById("clearSelectedRows"),
  applyBulkReview: document.getElementById("applyBulkReview"),
  clearReviewDrafts: document.getElementById("clearReviewDrafts"),
  reviewCsv: document.getElementById("downloadReviewCsv"),
  bulkName: document.getElementById("bulkNewName"),
  bulkUnitSuffix: document.getElementById("bulkUnitSuffix"),
  bulkTargetSalePrice: document.getElementById("bulkTargetSalePrice"),
  bulkOtherReason: document.getElementById("bulkOtherReason"),
  lightbox: document.getElementById("imageLightbox"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxTitle: document.getElementById("lightboxTitle"),
  lightboxMeta: document.getElementById("lightboxMeta"),
  lightboxClose: document.getElementById("lightboxClose"),
  lightboxPrev: document.getElementById("lightboxPrev"),
  lightboxNext: document.getElementById("lightboxNext"),
};

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("th-TH", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("th-TH");
const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" });
const collator = new Intl.Collator("th-TH", { numeric: true, sensitivity: "base" });

function setStatus(message, mode = "") {
  els.status.textContent = message;
  els.status.className = `status-bar${mode ? ` is-${mode}` : ""}`;
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("th-TH");
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[,฿\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  const number = toNumber(value);
  return number === null ? null : Math.round((number + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  const number = toNumber(value);
  return number === null ? "-" : moneyFormatter.format(number);
}

function formatPercent(value) {
  const number = toNumber(value);
  return number === null ? "-" : `${percentFormatter.format(number)}%`;
}

function platformPrice(basePrice, percent) {
  const base = toNumber(basePrice);
  return base === null ? null : roundMoney(base * (1 + percent));
}

function profitAmount(item) {
  const cost = toNumber(item.latest_purchase_price);
  const sale = toNumber(item.latest_sale_price);
  if (cost === null || sale === null) return null;
  return roundMoney(sale - cost);
}

function profitPercent(item) {
  const cost = toNumber(item.latest_purchase_price);
  const profit = profitAmount(item);
  if (cost === null || cost <= 0 || profit === null) return null;
  return Math.round((profit / cost) * 10000) / 100;
}

function profitClass(value) {
  const number = toNumber(value);
  if (number === null || number === 0) return "profit-neutral";
  return number > 0 ? "profit-positive" : "profit-negative";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function getImageUrl(image) {
  return image?.imageUrl || image?.imageOriginalUrl || "";
}

function getFallbackImageUrl(image) {
  return image?.imageOriginalUrl && image.imageOriginalUrl !== image.imageUrl ? image.imageOriginalUrl : "";
}

function getLightboxImageUrl(image) {
  return image?.imageOriginalUrl || image?.imageUrl || "";
}

function normalizeImageSlot(image) {
  if (!image) return {};
  if (typeof image === "string") {
    return { imageUrl: image, imageOriginalUrl: image, imageSource: "manual" };
  }
  return { ...image };
}

function ensureImageSlots(item) {
  const images = Array.isArray(item.images) ? item.images.map(normalizeImageSlot) : [];
  if (!images.length && (item.image_url || item.image_source_url)) {
    images.push({
      imageUrl: item.image_url || item.image_source_url,
      imageOriginalUrl: item.image_source_url || item.image_url,
      imageSource: "source",
    });
  }
  while (images.length < 3) images.push({});
  return images.slice(0, 3);
}

function getProductImages(item) {
  return ensureImageSlots(item).filter((image) => getImageUrl(image) || getLightboxImageUrl(image));
}

function productKey(item) {
  return String(item.product_code || `${item.vendor || ""}|${item.product_name || ""}|${item.latest_sale_bill || ""}`);
}

function defaultReview() {
  return {
    statuses: [],
    newName: "",
    unitSuffix: "",
    badImages: [],
    targetSalePrice: "",
    otherReason: "",
  };
}

function defaultDraft() {
  return {
    overrides: {},
    review: defaultReview(),
  };
}

function cloneDraft(draft) {
  return {
    overrides: { ...(draft?.overrides || {}) },
    review: {
      ...defaultReview(),
      ...(draft?.review || {}),
      statuses: Array.isArray(draft?.review?.statuses) ? [...draft.review.statuses] : [],
      badImages: Array.isArray(draft?.review?.badImages) ? [...draft.review.badImages] : [],
    },
  };
}

function loadReviewDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function draftHasContent(draft) {
  const normalized = cloneDraft(draft);
  return (
    Object.keys(normalized.overrides).length > 0 ||
    normalized.review.statuses.length > 0 ||
    Boolean(normalized.review.newName) ||
    Boolean(normalized.review.unitSuffix) ||
    normalized.review.badImages.length > 0 ||
    Boolean(normalized.review.targetSalePrice) ||
    Boolean(normalized.review.otherReason)
  );
}

function saveReviewDrafts() {
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state.reviewDrafts));
  } catch (error) {
    setStatus(`บันทึก draft ใน browser ไม่ได้: ${error.message}`, "error");
  }
  renderReviewStats();
}

function getDraftForItem(item) {
  return cloneDraft(state.reviewDrafts[productKey(item)] || defaultDraft());
}

function setDraftForItem(item, draft) {
  const key = productKey(item);
  const normalized = cloneDraft(draft);
  if (draftHasContent(normalized)) {
    state.reviewDrafts[key] = normalized;
  } else {
    delete state.reviewDrafts[key];
  }
  saveReviewDrafts();
}

function applySavedDraftsToProducts() {
  for (const item of state.products) {
    const draft = state.reviewDrafts[productKey(item)];
    if (!draft?.overrides) continue;
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(draft.overrides, field)) {
        item[field] = draft.overrides[field];
      }
    }
    if (Array.isArray(draft.overrides.images)) {
      item.images = draft.overrides.images.map(normalizeImageSlot);
    }
  }
}

function normalizeEditableValue(field, value) {
  return field.includes("price") ? toNumber(value) : String(value || "").trim();
}

function storeEditableField(item, field, value) {
  const draft = getDraftForItem(item);
  const nextValue = normalizeEditableValue(field, value);
  draft.overrides[field] = nextValue;
  item[field] = nextValue;
  setDraftForItem(item, draft);
}

function updateEditableField(item, field, value) {
  storeEditableField(item, field, value);
  render();
}

function refreshComputedCells(row, item) {
  if (!row) return;
  const profit = profitAmount(item);
  const profitCell = row.querySelector('[data-computed="profit"]');
  if (profitCell) {
    profitCell.className = `money ${profitClass(profit)}`;
    profitCell.textContent = formatMoney(profit);
  }

  const profitPercentCell = row.querySelector('[data-computed="profit-percent"]');
  if (profitPercentCell) {
    profitPercentCell.className = `money ${profitClass(profit)}`;
    profitPercentCell.textContent = formatPercent(profitPercent(item));
  }

  const thaimart = row.querySelector('[data-computed="thaimart"]');
  if (thaimart) thaimart.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.thaimart));

  const lazada = row.querySelector('[data-computed="lazada"]');
  if (lazada) lazada.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.lazada));

  const shopee = row.querySelector('[data-computed="shopee"]');
  if (shopee) shopee.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.shopee));
}

function updateImageUrl(item, index, value) {
  const images = ensureImageSlots(item);
  const url = String(value || "").trim();
  images[index] = url ? { ...images[index], imageUrl: url, imageOriginalUrl: url, imageSource: "manual" } : {};
  item.images = images;

  const draft = getDraftForItem(item);
  draft.overrides.images = images;
  setDraftForItem(item, draft);
  render();
}

function uniqueStatusList(statuses) {
  return [...new Set(statuses.filter((status) => REVIEW_OPTIONS.some((option) => option.id === status)))];
}

function updateReviewStatus(item, statusId, checked) {
  const draft = getDraftForItem(item);
  let statuses = new Set(draft.review.statuses || []);

  if (statusId === "all_correct") {
    if (checked) {
      draft.review = defaultReview();
      draft.review.statuses = ["all_correct"];
      setDraftForItem(item, draft);
      render();
      return;
    }
    statuses = new Set();
  } else {
    statuses.delete("all_correct");
    if (checked) {
      statuses.add(statusId);
    } else {
      statuses.delete(statusId);
      clearReviewDetailsForStatus(draft.review, statusId);
    }
  }

  draft.review.statuses = uniqueStatusList([...statuses]);
  setDraftForItem(item, draft);
  render();
}

function clearReviewDetailsForStatus(review, statusId) {
  if (statusId === "name_wrong") review.newName = "";
  if (statusId === "unit_unclear") review.unitSuffix = "";
  if (statusId === "image_wrong") review.badImages = [];
  if (statusId === "low_profit") review.targetSalePrice = "";
  if (statusId === "other") review.otherReason = "";
}

function updateReviewField(item, field, value) {
  const draft = getDraftForItem(item);
  draft.review[field] = field === "targetSalePrice" ? String(value || "").trim() : String(value || "").trim();

  if (field === "targetSalePrice") {
    const target = toNumber(value);
    if (target !== null) {
      draft.overrides.latest_sale_price = target;
      item.latest_sale_price = target;
    }
  }

  setDraftForItem(item, draft);
  render();
}

function updateBadImageChoice(item, imageKey, checked) {
  const draft = getDraftForItem(item);
  const badImages = new Set(draft.review.badImages || []);
  if (imageKey === "all") {
    if (checked) {
      draft.review.badImages = ["all"];
    } else {
      badImages.delete("all");
      draft.review.badImages = [...badImages];
    }
  } else {
    badImages.delete("all");
    if (checked) {
      badImages.add(imageKey);
    } else {
      badImages.delete(imageKey);
    }
    draft.review.badImages = [...badImages].sort();
  }

  if (draft.review.badImages.length && !draft.review.statuses.includes("image_wrong")) {
    draft.review.statuses = uniqueStatusList([...draft.review.statuses.filter((status) => status !== "all_correct"), "image_wrong"]);
  }

  setDraftForItem(item, draft);
  render();
}

function reviewNeedsAi(review) {
  return (review?.statuses || []).some((status) => status !== "all_correct");
}

function reviewStatusLabel(statusId) {
  return REVIEW_OPTIONS.find((option) => option.id === statusId)?.label || statusId;
}

function reviewSummary(review) {
  if (!review?.statuses?.length) return "ยังไม่ตรวจ";
  if (review.statuses.includes("all_correct")) return "ถูกต้อง";
  return `รอ AI ${numberFormatter.format(review.statuses.length)} ข้อ`;
}

function renderReviewStats() {
  const existingKeys = new Set(state.products.map(productKey));
  const selectedCount = [...state.selectedKeys].filter((key) => existingKeys.has(key)).length;
  const draftRows = Object.values(state.reviewDrafts).filter(draftHasContent);
  const aiRows = draftRows.filter((draft) => reviewNeedsAi(cloneDraft(draft).review));

  if (els.reviewSelected) els.reviewSelected.textContent = numberFormatter.format(selectedCount);
  if (els.reviewDraftCount) els.reviewDraftCount.textContent = numberFormatter.format(draftRows.length);
  if (els.reviewAiCount) els.reviewAiCount.textContent = numberFormatter.format(aiRows.length);
}

function updateLightbox() {
  const { images, index, productName } = state.lightbox;
  const image = images[index];
  const src = getLightboxImageUrl(image) || getImageUrl(image);
  const title = productName || "สินค้า";

  els.lightboxImage.src = src || "";
  els.lightboxImage.alt = `${title} รูปที่ ${index + 1}`;
  els.lightboxTitle.textContent = title;
  els.lightboxMeta.textContent = `รูปที่ ${numberFormatter.format(index + 1)} / ${numberFormatter.format(images.length)}`;
  els.lightboxPrev.disabled = images.length < 2;
  els.lightboxNext.disabled = images.length < 2;
}

function openLightbox(item, startIndex) {
  const images = getProductImages(item);
  if (!images.length) return;

  state.lightbox.images = images;
  state.lightbox.index = Math.min(Math.max(startIndex, 0), images.length - 1);
  state.lightbox.productName = item.product_name || "สินค้า";
  state.lightbox.trigger = document.activeElement;
  updateLightbox();
  els.lightbox.classList.add("is-open");
  els.lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-lightbox-open");
  els.lightboxClose.focus();
}

function closeLightbox() {
  els.lightbox.classList.remove("is-open");
  els.lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-lightbox-open");
  els.lightboxImage.removeAttribute("src");
  state.lightbox.trigger?.focus?.();
  state.lightbox.trigger = null;
}

function showLightboxImage(direction) {
  const { images } = state.lightbox;
  if (images.length < 2) return;
  state.lightbox.index = (state.lightbox.index + direction + images.length) % images.length;
  updateLightbox();
}

function compareProducts(a, b) {
  if (state.sortMode === "sale-price-desc") {
    return (toNumber(b.latest_sale_price) || 0) - (toNumber(a.latest_sale_price) || 0);
  }
  if (state.sortMode === "purchase-price-desc") {
    return (toNumber(b.latest_purchase_price) || 0) - (toNumber(a.latest_purchase_price) || 0);
  }
  if (state.sortMode === "name-asc") {
    return collator.compare(a.product_name || "", b.product_name || "");
  }
  return new Date(b.latest_sale_date || 0).getTime() - new Date(a.latest_sale_date || 0).getTime();
}

async function loadCatalog() {
  setStatus("กำลังโหลดข้อมูลสินค้า...");
  els.refresh.disabled = true;

  const url = new URL(`${SUPABASE_URL}/rest/v1/peak_product_catalog`);
  url.searchParams.set(
    "select",
    [
      "product_code",
      "product_name",
      "vendor",
      "latest_purchase_bill",
      "latest_purchase_date",
      "latest_purchase_price",
      "latest_sale_price",
      "latest_sale_bill",
      "latest_sale_date",
      "thaimart_price",
      "lazada_price",
      "shopee_price",
      "images",
      "image_url",
      "image_source_url",
    ].join(",")
  );
  url.searchParams.set("order", "vendor.asc");
  url.searchParams.set("limit", "1000");

  try {
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}`);
    }

    state.products = await response.json();
    applySavedDraftsToProducts();
    populateVendors();
    render();
    setStatus(`โหลดข้อมูลสำเร็จ ${numberFormatter.format(state.products.length)} รายการ`, "ready");
  } catch (error) {
    setStatus(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`, "error");
    state.products = [];
    render();
  } finally {
    els.refresh.disabled = false;
  }
}

function populateVendors() {
  const selected = state.vendor;
  const vendors = [...new Set(state.products.map((item) => item.vendor).filter(Boolean))].sort(collator.compare);
  els.vendor.textContent = "";

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "ทั้งหมด";
  els.vendor.appendChild(all);

  for (const vendor of vendors) {
    const option = document.createElement("option");
    option.value = vendor;
    option.textContent = vendor;
    els.vendor.appendChild(option);
  }

  els.vendor.value = vendors.includes(selected) ? selected : "";
  state.vendor = els.vendor.value;
}

function filteredProducts() {
  const query = normalize(state.query);
  return state.products.filter((item) => {
    if (state.vendor && item.vendor !== state.vendor) return false;
    if (!query) return true;
    const draft = getDraftForItem(item);
    return [
      item.product_code,
      item.product_name,
      item.vendor,
      item.latest_purchase_bill,
      item.latest_sale_bill,
      draft.review.newName,
      draft.review.unitSuffix,
      draft.review.otherReason,
    ]
      .map(normalize)
      .some((value) => value.includes(query));
  });
}

function groupByVendor(items) {
  const groups = new Map();
  for (const item of items) {
    const vendor = item.vendor || "ไม่ระบุร้านค้า";
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([vendor, products]) => [vendor, products.sort(compareProducts)]);
}

function renderMetrics(items) {
  const vendors = new Set(state.products.map((item) => item.vendor).filter(Boolean));
  const latest = state.products.reduce((max, item) => {
    const time = new Date(item.latest_sale_date || 0).getTime();
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);

  els.metricProducts.textContent = numberFormatter.format(state.products.length);
  els.metricVendors.textContent = numberFormatter.format(vendors.size);
  els.metricLatestSale.textContent = latest ? formatDate(new Date(latest).toISOString()) : "-";
  els.resultCount.textContent = `${numberFormatter.format(items.length)} รายการ`;
  renderReviewStats();
}

function makeCell(className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function makeEditableInput(item, field, options = {}) {
  const input = document.createElement("input");
  input.className = `cell-input${options.className ? ` ${options.className}` : ""}`;
  input.type = options.type || "text";
  input.value = input.type === "date" ? dateInputValue(item[field]) : item[field] ?? "";
  input.placeholder = options.placeholder || "";
  input.setAttribute("aria-label", options.label || field);
  if (input.type === "number") {
    input.min = "0";
    input.step = "0.01";
    input.inputMode = "decimal";
  }
  input.addEventListener("input", () => {
    storeEditableField(item, field, input.value);
    if (field === "latest_purchase_price" || field === "latest_sale_price") {
      refreshComputedCells(input.closest("tr"), item);
    }
  });
  input.addEventListener("change", () => updateEditableField(item, field, input.value));
  return input;
}

function makeReviewTextInput(item, field, placeholder, enabled, type = "text") {
  const draft = getDraftForItem(item);
  const input = document.createElement("input");
  input.className = "review-input";
  input.type = type;
  input.value = draft.review[field] || "";
  input.placeholder = placeholder;
  input.disabled = !enabled;
  if (type === "number") {
    input.min = "0";
    input.step = "0.01";
    input.inputMode = "decimal";
  }
  input.addEventListener("change", () => updateReviewField(item, field, input.value));
  return input;
}

function renderSelectionCell(item) {
  const cell = makeCell("select-cell");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "row-select";
  checkbox.checked = state.selectedKeys.has(productKey(item));
  checkbox.setAttribute("aria-label", `เลือก ${item.product_name || item.product_code || "สินค้า"}`);
  checkbox.addEventListener("change", () => {
    const key = productKey(item);
    if (checkbox.checked) {
      state.selectedKeys.add(key);
    } else {
      state.selectedKeys.delete(key);
    }
    renderReviewStats();
  });
  cell.appendChild(checkbox);
  return cell;
}

function renderImageGallery(item) {
  const cell = makeCell("image-cell");
  const gallery = document.createElement("div");
  gallery.className = "image-gallery";
  const images = ensureImageSlots(item);

  for (let index = 0; index < 3; index += 1) {
    const image = images[index];
    const src = getImageUrl(image) || getLightboxImageUrl(image);
    const frame = document.createElement(src ? "button" : "span");
    frame.className = "thumb";
    if (src) {
      frame.type = "button";
      frame.title = "ขยายรูปภาพ";
      frame.setAttribute("aria-label", `${item.product_name || "สินค้า"} รูปที่ ${index + 1}`);
      frame.addEventListener("click", () => openLightbox(item, index));

      const img = document.createElement("img");
      img.src = src;
      img.alt = `${item.product_name || "สินค้า"} รูปที่ ${index + 1}`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      const fallback = getFallbackImageUrl(image);
      img.addEventListener("error", () => {
        if (fallback && img.src !== fallback) {
          img.src = fallback;
          return;
        }
        img.remove();
        frame.classList.add("is-missing");
        frame.disabled = true;
      });
      frame.appendChild(img);
    } else {
      frame.classList.add("is-missing");
    }
    gallery.appendChild(frame);
  }

  const editor = document.createElement("div");
  editor.className = "image-url-grid";
  images.forEach((image, index) => {
    const input = document.createElement("input");
    input.type = "url";
    input.value = getImageUrl(image) || getLightboxImageUrl(image);
    input.placeholder = `URL รูป ${index + 1}`;
    input.setAttribute("aria-label", `แก้ URL รูป ${index + 1}`);
    input.addEventListener("change", () => updateImageUrl(item, index, input.value));
    editor.appendChild(input);
  });

  cell.append(gallery, editor);
  return cell;
}

function renderProductNameCell(item) {
  const name = makeCell("product-name");
  name.appendChild(makeEditableInput(item, "product_name", { label: "แก้ชื่อสินค้า", className: "product-title-input" }));

  const meta = document.createElement("span");
  meta.textContent = item.product_code || "-";

  const vendorLabel = document.createElement("label");
  vendorLabel.className = "mini-field";
  vendorLabel.textContent = "ร้านค้า";
  vendorLabel.appendChild(makeEditableInput(item, "vendor", { label: "แก้ร้านค้า" }));

  name.append(meta, vendorLabel);
  return name;
}

function renderBillCell(item, billField, dateField, billLabel, dateLabel) {
  const cell = makeCell("bill-cell");
  cell.appendChild(makeEditableInput(item, billField, { label: billLabel }));
  cell.appendChild(makeEditableInput(item, dateField, { type: "date", label: dateLabel }));
  return cell;
}

function renderReviewCell(item) {
  const cell = makeCell("review-cell");
  const draft = getDraftForItem(item);
  const review = draft.review;
  const statusSet = new Set(review.statuses);

  const summary = document.createElement("div");
  summary.className = `review-summary${reviewNeedsAi(review) ? " needs-ai" : ""}`;
  summary.textContent = reviewSummary(review);
  cell.appendChild(summary);

  const checks = document.createElement("div");
  checks.className = "review-checks";
  for (const option of REVIEW_OPTIONS) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.id;
    checkbox.checked = statusSet.has(option.id);
    checkbox.addEventListener("change", () => updateReviewStatus(item, option.id, checkbox.checked));
    label.append(checkbox, document.createTextNode(option.label));
    checks.appendChild(label);
  }
  cell.appendChild(checks);

  const detail = document.createElement("div");
  detail.className = "review-details";
  detail.appendChild(
    fieldGroup("ตั้งชื่อใหม่เป็น", makeReviewTextInput(item, "newName", "ชื่อใหม่", statusSet.has("name_wrong")))
  );
  detail.appendChild(
    fieldGroup("ต่อท้ายหน่วยว่า", makeReviewTextInput(item, "unitSuffix", "เช่น แพ็ค / กล่อง / ชิ้น", statusSet.has("unit_unclear")))
  );

  const badImageChoices = document.createElement("div");
  badImageChoices.className = "bad-image-options";
  for (const choice of [
    ["1", "ภาพ 1"],
    ["2", "ภาพ 2"],
    ["3", "ภาพ 3"],
    ["all", "ผิดทั้งหมด"],
  ]) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = choice[0];
    checkbox.checked = review.badImages.includes(choice[0]);
    checkbox.disabled = !statusSet.has("image_wrong");
    checkbox.addEventListener("change", () => updateBadImageChoice(item, choice[0], checkbox.checked));
    label.append(checkbox, document.createTextNode(choice[1]));
    badImageChoices.appendChild(label);
  }
  detail.appendChild(fieldGroup("รูปที่ผิด", badImageChoices));

  detail.appendChild(
    fieldGroup("ตั้งราคาขายล่าสุด", makeReviewTextInput(item, "targetSalePrice", "0.00", statusSet.has("low_profit"), "number"))
  );
  detail.appendChild(
    fieldGroup("เหตุผลเพิ่มเติม", makeReviewTextInput(item, "otherReason", "ระบุสิ่งที่ต้องให้ AI แก้", statusSet.has("other")))
  );

  cell.appendChild(detail);
  return cell;
}

function fieldGroup(labelText, control) {
  const label = document.createElement("label");
  label.className = "review-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function renderProductRow(item) {
  const row = document.createElement("tr");
  row.appendChild(renderSelectionCell(item));
  row.appendChild(renderImageGallery(item));
  row.appendChild(renderProductNameCell(item));
  row.appendChild(renderBillCell(item, "latest_purchase_bill", "latest_purchase_date", "แก้บิลซื้อล่าสุด", "แก้วันที่ซื้อ"));

  const purchasePrice = makeCell("editable-money");
  purchasePrice.appendChild(makeEditableInput(item, "latest_purchase_price", { type: "number", label: "แก้ราคาซื้อล่าสุด" }));
  row.appendChild(purchasePrice);

  const salePrice = makeCell("editable-money");
  salePrice.appendChild(makeEditableInput(item, "latest_sale_price", { type: "number", label: "แก้ราคาขายล่าสุด" }));
  row.appendChild(salePrice);

  const profit = profitAmount(item);
  const profitCell = makeCell(`money ${profitClass(profit)}`);
  profitCell.dataset.computed = "profit";
  profitCell.textContent = formatMoney(profit);
  row.appendChild(profitCell);

  const profitRate = profitPercent(item);
  const profitPercentCell = makeCell(`money ${profitClass(profit)}`);
  profitPercentCell.dataset.computed = "profit-percent";
  profitPercentCell.textContent = formatPercent(profitRate);
  row.appendChild(profitPercentCell);

  const thaimart = makeCell("money platform-thaimart");
  thaimart.dataset.computed = "thaimart";
  thaimart.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.thaimart));
  row.appendChild(thaimart);

  const lazada = makeCell("money platform-lazada");
  lazada.dataset.computed = "lazada";
  lazada.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.lazada));
  row.appendChild(lazada);

  const shopee = makeCell("money platform-shopee");
  shopee.dataset.computed = "shopee";
  shopee.textContent = formatMoney(platformPrice(item.latest_sale_price, MARKET_MARKUPS.shopee));
  row.appendChild(shopee);

  row.appendChild(renderBillCell(item, "latest_sale_bill", "latest_sale_date", "แก้บิลขายล่าสุด", "แก้วันที่ขาย"));
  row.appendChild(renderReviewCell(item));
  return row;
}

function render() {
  const items = filteredProducts();
  const groups = groupByVendor(items);
  els.body.textContent = "";
  renderMetrics(items);

  if (!items.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = makeCell();
    cell.colSpan = TABLE_COLUMN_COUNT;
    cell.textContent = "ไม่พบรายการที่ตรงกับเงื่อนไข";
    row.appendChild(cell);
    els.body.appendChild(row);
    return;
  }

  for (const [vendor, products] of groups) {
    const groupRow = document.createElement("tr");
    groupRow.className = "vendor-row";
    const cell = makeCell();
    cell.colSpan = TABLE_COLUMN_COUNT;
    cell.textContent = `${vendor} (${numberFormatter.format(products.length)} รายการ)`;
    groupRow.appendChild(cell);
    els.body.appendChild(groupRow);
    for (const product of products) {
      els.body.appendChild(renderProductRow(product));
    }
  }
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function currentExportRow(item) {
  const images = ensureImageSlots(item);
  const draft = getDraftForItem(item);
  return {
    product_code: item.product_code,
    product_name: item.product_name,
    vendor: item.vendor,
    latest_purchase_bill: item.latest_purchase_bill,
    latest_purchase_date: item.latest_purchase_date,
    latest_purchase_price: item.latest_purchase_price,
    latest_sale_price: item.latest_sale_price,
    profit: profitAmount(item),
    profit_percent: profitPercent(item),
    thaimart_price: platformPrice(item.latest_sale_price, MARKET_MARKUPS.thaimart),
    lazada_price: platformPrice(item.latest_sale_price, MARKET_MARKUPS.lazada),
    shopee_price: platformPrice(item.latest_sale_price, MARKET_MARKUPS.shopee),
    latest_sale_bill: item.latest_sale_bill,
    latest_sale_date: item.latest_sale_date,
    review_statuses: draft.review.statuses.map(reviewStatusLabel).join(" | "),
    ai_new_name: draft.review.newName,
    ai_unit_suffix: draft.review.unitSuffix,
    bad_images: draft.review.badImages.join(" | "),
    target_sale_price: draft.review.targetSalePrice,
    other_reason: draft.review.otherReason,
    image_1_url: getImageUrl(images[0]) || getLightboxImageUrl(images[0]),
    image_2_url: getImageUrl(images[1]) || getLightboxImageUrl(images[1]),
    image_3_url: getImageUrl(images[2]) || getLightboxImageUrl(images[2]),
  };
}

function downloadRowsAsCsv(headers, rows, filename) {
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csvValue(row[key])).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadCsv() {
  const headers = [
    "product_code",
    "product_name",
    "vendor",
    "latest_purchase_bill",
    "latest_purchase_price",
    "latest_sale_price",
    "profit",
    "profit_percent",
    "thaimart_price",
    "lazada_price",
    "shopee_price",
    "latest_sale_bill",
    "latest_sale_date",
  ];
  downloadRowsAsCsv(headers, filteredProducts().map(currentExportRow), "peak-product-catalog.csv");
}

function downloadReviewCsv() {
  const headers = [
    "product_code",
    "product_name",
    "vendor",
    "latest_purchase_bill",
    "latest_purchase_date",
    "latest_purchase_price",
    "latest_sale_price",
    "profit",
    "profit_percent",
    "thaimart_price",
    "lazada_price",
    "shopee_price",
    "latest_sale_bill",
    "latest_sale_date",
    "review_statuses",
    "ai_new_name",
    "ai_unit_suffix",
    "bad_images",
    "target_sale_price",
    "other_reason",
    "image_1_url",
    "image_2_url",
    "image_3_url",
  ];
  downloadRowsAsCsv(headers, filteredProducts().map(currentExportRow), "peak-product-review-draft.csv");
}

function readBulkStatuses() {
  return [...document.querySelectorAll(".bulk-review-option")]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
}

function readBulkBadImages() {
  return [...document.querySelectorAll(".bulk-bad-image")]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
}

function clearBulkInputs() {
  document.querySelectorAll(".bulk-review-option, .bulk-bad-image").forEach((checkbox) => {
    checkbox.checked = false;
  });
  [els.bulkName, els.bulkUnitSuffix, els.bulkTargetSalePrice, els.bulkOtherReason].forEach((input) => {
    if (input) input.value = "";
  });
}

function applyBulkReview() {
  const targetKeys = new Set([...state.selectedKeys]);
  const targets = state.products.filter((item) => targetKeys.has(productKey(item)));
  if (!targets.length) {
    setStatus("เลือกสินค้าก่อนตั้งสถานะ bulk", "error");
    return;
  }

  const statuses = readBulkStatuses();
  const badImages = readBulkBadImages();
  const bulkName = els.bulkName?.value.trim() || "";
  const bulkUnitSuffix = els.bulkUnitSuffix?.value.trim() || "";
  const bulkTargetSalePrice = els.bulkTargetSalePrice?.value.trim() || "";
  const bulkOtherReason = els.bulkOtherReason?.value.trim() || "";

  if (!statuses.length) {
    setStatus("เลือกสถานะอย่างน้อย 1 ข้อก่อน apply bulk", "error");
    return;
  }

  for (const item of targets) {
    const draft = getDraftForItem(item);
    if (statuses.includes("all_correct")) {
      draft.review = defaultReview();
      draft.review.statuses = ["all_correct"];
    } else {
      draft.review.statuses = uniqueStatusList([
        ...draft.review.statuses.filter((status) => status !== "all_correct"),
        ...statuses.filter((status) => status !== "all_correct"),
      ]);
      if (statuses.includes("name_wrong") && bulkName) draft.review.newName = bulkName;
      if (statuses.includes("unit_unclear") && bulkUnitSuffix) draft.review.unitSuffix = bulkUnitSuffix;
      if (statuses.includes("image_wrong") && badImages.length) draft.review.badImages = badImages.includes("all") ? ["all"] : badImages;
      if (statuses.includes("low_profit") && bulkTargetSalePrice) {
        draft.review.targetSalePrice = bulkTargetSalePrice;
        const target = toNumber(bulkTargetSalePrice);
        if (target !== null) {
          draft.overrides.latest_sale_price = target;
          item.latest_sale_price = target;
        }
      }
      if (statuses.includes("other") && bulkOtherReason) draft.review.otherReason = bulkOtherReason;
    }
    setDraftForItem(item, draft);
  }

  clearBulkInputs();
  setStatus(`ตั้งสถานะ bulk แล้ว ${numberFormatter.format(targets.length)} รายการ`, "ready");
  render();
}

function selectVisibleRows() {
  for (const item of filteredProducts()) {
    state.selectedKeys.add(productKey(item));
  }
  render();
}

function clearSelectedRows() {
  state.selectedKeys.clear();
  render();
}

function clearReviewDrafts() {
  if (!window.confirm("ล้าง draft การตรวจและข้อมูลที่แก้ใน browser นี้ทั้งหมดหรือไม่?")) return;
  state.reviewDrafts = {};
  localStorage.removeItem(REVIEW_STORAGE_KEY);
  loadCatalog();
}

els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

els.vendor.addEventListener("change", (event) => {
  state.vendor = event.target.value;
  render();
});

els.sort.addEventListener("change", (event) => {
  state.sortMode = event.target.value;
  render();
});

els.refresh.addEventListener("click", loadCatalog);
els.csv.addEventListener("click", downloadCsv);
els.reviewCsv.addEventListener("click", downloadReviewCsv);
els.selectVisibleRows.addEventListener("click", selectVisibleRows);
els.clearSelectedRows.addEventListener("click", clearSelectedRows);
els.applyBulkReview.addEventListener("click", applyBulkReview);
els.clearReviewDrafts.addEventListener("click", clearReviewDrafts);
els.lightboxClose.addEventListener("click", closeLightbox);
els.lightboxPrev.addEventListener("click", () => showLightboxImage(-1));
els.lightboxNext.addEventListener("click", () => showLightboxImage(1));
els.lightbox.addEventListener("click", (event) => {
  if (event.target?.hasAttribute("data-lightbox-close")) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (!els.lightbox.classList.contains("is-open")) return;
  if (event.key === "Escape") {
    closeLightbox();
  }
  if (event.key === "ArrowLeft") {
    showLightboxImage(-1);
  }
  if (event.key === "ArrowRight") {
    showLightboxImage(1);
  }
});

loadCatalog();
