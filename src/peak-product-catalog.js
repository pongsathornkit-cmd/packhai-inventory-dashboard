const SUPABASE_URL = "https://fabfhzcsppniuwtdwvfg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYmZoemNzcHBuaXV3dGR3dmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Njk3NjQsImV4cCI6MjA5ODI0NTc2NH0.2w3Wr8Bov2Jc-1PQw1KyVa99_B9jMFez8YXonZx8WGk";

const state = {
  products: [],
  query: "",
  vendor: "",
  sortMode: "sale-date-desc",
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
};

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 2,
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  const number = toNumber(value);
  return number === null ? "-" : moneyFormatter.format(number);
}

function platformPrice(value, basePrice, percent) {
  const explicit = toNumber(value);
  if (explicit !== null) return explicit;
  const base = toNumber(basePrice);
  return base === null ? null : Math.round(base * (1 + percent) * 100) / 100;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function getImageUrl(image) {
  return image?.imageUrl || image?.imageOriginalUrl || "";
}

function getFallbackImageUrl(image) {
  return image?.imageOriginalUrl && image.imageOriginalUrl !== image.imageUrl ? image.imageOriginalUrl : "";
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
    return [item.product_code, item.product_name, item.vendor, item.latest_purchase_bill, item.latest_sale_bill]
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
}

function makeCell(className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function renderImageGallery(item) {
  const cell = makeCell();
  const gallery = document.createElement("div");
  gallery.className = "image-gallery";
  const images = Array.isArray(item.images) ? item.images.slice(0, 3) : [];

  for (let index = 0; index < 3; index += 1) {
    const frame = document.createElement("span");
    frame.className = "thumb";
    const image = images[index];
    const src = getImageUrl(image);
    if (src) {
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
      });
      frame.appendChild(img);
    } else {
      frame.classList.add("is-missing");
    }
    gallery.appendChild(frame);
  }

  cell.appendChild(gallery);
  return cell;
}

function renderProductRow(item) {
  const row = document.createElement("tr");
  row.appendChild(renderImageGallery(item));

  const name = makeCell("product-name");
  const strong = document.createElement("strong");
  strong.textContent = item.product_name || "-";
  const code = document.createElement("span");
  code.textContent = item.product_code || "-";
  name.append(strong, code);
  row.appendChild(name);

  const purchaseBill = makeCell();
  purchaseBill.textContent = item.latest_purchase_bill || "-";
  row.appendChild(purchaseBill);

  const purchasePrice = makeCell("money");
  purchasePrice.textContent = formatMoney(item.latest_purchase_price);
  row.appendChild(purchasePrice);

  const salePrice = makeCell("money");
  salePrice.textContent = formatMoney(item.latest_sale_price);
  row.appendChild(salePrice);

  const thaimart = makeCell("money platform-thaimart");
  thaimart.textContent = formatMoney(platformPrice(item.thaimart_price, item.latest_sale_price, 0.07));
  row.appendChild(thaimart);

  const lazada = makeCell("money platform-lazada");
  lazada.textContent = formatMoney(item.lazada_price);
  row.appendChild(lazada);

  const shopee = makeCell("money platform-shopee");
  shopee.textContent = formatMoney(item.shopee_price);
  row.appendChild(shopee);

  const saleBill = makeCell();
  const bill = document.createElement("strong");
  bill.textContent = item.latest_sale_bill || "-";
  const date = document.createElement("div");
  date.className = "muted";
  date.textContent = formatDate(item.latest_sale_date);
  saleBill.append(bill, date);
  row.appendChild(saleBill);

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
    cell.colSpan = 9;
    cell.textContent = "ไม่พบรายการที่ตรงกับเงื่อนไข";
    row.appendChild(cell);
    els.body.appendChild(row);
    return;
  }

  for (const [vendor, products] of groups) {
    const groupRow = document.createElement("tr");
    groupRow.className = "vendor-row";
    const cell = makeCell();
    cell.colSpan = 9;
    cell.textContent = `${vendor} (${numberFormatter.format(products.length)} รายการ)`;
    groupRow.appendChild(cell);
    els.body.appendChild(groupRow);
    for (const product of products) {
      els.body.appendChild(renderProductRow(product));
    }
  }
}

function downloadCsv() {
  const headers = [
    "product_code",
    "product_name",
    "vendor",
    "latest_purchase_bill",
    "latest_purchase_price",
    "latest_sale_price",
    "thaimart_price",
    "lazada_price",
    "shopee_price",
    "latest_sale_bill",
    "latest_sale_date",
  ];
  const rows = filteredProducts().map((item) =>
    headers
      .map((key) => {
        const value =
          key === "thaimart_price" ? platformPrice(item.thaimart_price, item.latest_sale_price, 0.07) : item[key];
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "peak-product-catalog.csv";
  link.click();
  URL.revokeObjectURL(link.href);
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

loadCatalog();
