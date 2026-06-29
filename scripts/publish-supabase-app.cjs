const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadCloudEnv } = require("./cloud-env-loader.cjs");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const dataDir = process.env.PACKHAI_DATA_DIR ? path.resolve(process.env.PACKHAI_DATA_DIR) : path.join(projectRoot, "data");
const localWriteKeyFile = path.join(projectRoot, ".sync-key.local");

if (!process.env.LOAD_LOCAL_CLOUD_ENV && fs.existsSync(path.join(projectRoot, ".tmp", "cloud-sync.env"))) {
  process.env.LOAD_LOCAL_CLOUD_ENV = "1";
}
loadCloudEnv();

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function supabaseBaseUrl() {
  const explicitUrl = String(process.env.SUPABASE_URL || process.env.SUPABASE_REST_URL || "").trim().replace(/\/+$/, "");
  if (explicitUrl) return explicitUrl.replace(/\/rest\/v1$/i, "");
  const projectId = String(process.env.SUPABASE_PROJECT_ID || "").trim();
  return projectId ? `https://${projectId}.supabase.co` : "https://fabfhzcsppniuwtdwvfg.supabase.co";
}

function supabaseApiKey() {
  return String(
    process.env.SUPABASE_ANON_KEY ||
      process.env.PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYmZoemNzcHBuaXV3dGR3dmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Njk3NjQsImV4cCI6MjA5ODI0NTc2NH0.2w3Wr8Bov2Jc-1PQw1KyVa99_B9jMFez8YXonZx8WGk"
  ).trim();
}

function readLocalWriteKey() {
  try {
    return fs.readFileSync(localWriteKeyFile, "utf8").trim();
  } catch {
    return "";
  }
}

function supabaseWriteKey() {
  return String(process.env.SUPABASE_WRITE_KEY || process.env.SYNC_DB_WRITE_KEY || readLocalWriteKey()).trim();
}

function compactSourceFiles() {
  const dashboard = readJson(path.join(distDir, "inventory-valuation-data.json"), {});
  return {
    generatedAt: new Date().toISOString(),
    packhaiRows: Number(dashboard.metadata?.sources?.packhai?.rows || 0),
    shopeeRows: Number(dashboard.metadata?.sources?.shopee?.rows || 0),
    lazadaRows: Number(dashboard.metadata?.sources?.lazada?.rows || 0),
    ktwRows: Number(dashboard.metadata?.sources?.ktw?.rows || 0),
  };
}

function stockMovementSummary(stockMovements) {
  const rows = Array.isArray(stockMovements.rows) ? stockMovements.rows : [];
  return {
    storage: "packhai_stock_movements",
    rowCount: rows.length,
    generatedAt: stockMovements.generatedAt || new Date().toISOString(),
  };
}

function boundedChunkSize(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 25), 1000);
}

function snapshotChunkRows({ rows, prefix, indexKey, chunkSize, generatedAt }) {
  const items = Array.isArray(rows) ? rows : [];
  const totalChunks = Math.ceil(items.length / chunkSize);
  const keys = [];
  const snapshots = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const key = `${prefix}_${String(index).padStart(4, "0")}`;
    keys.push(key);
    snapshots.push({
      key,
      payload: {
        storage: "app_snapshots",
        rows: items.slice(index * chunkSize, (index + 1) * chunkSize),
        index,
        totalChunks,
        rowCount: items.length,
        generatedAt,
      },
    });
  }
  snapshots.push({
    key: indexKey,
    payload: {
      storage: "app_snapshots",
      keys,
      totalChunks,
      rowCount: items.length,
      chunkSize,
      generatedAt,
    },
  });
  return snapshots;
}

function dashboardRowsMeta(rows, chunkSize, generatedAt) {
  return {
    omittedFromSupabaseSnapshot: true,
    indexKey: "dashboard_rows_index",
    snapshotPrefix: "dashboard_rows_",
    rowCount: Array.isArray(rows) ? rows.length : 0,
    chunkSize,
    generatedAt,
  };
}

function uncollectedRowsMeta(rows, chunkSize, generatedAt) {
  return {
    omittedFromSupabaseSnapshot: true,
    indexKey: "uncollected_stock_rows_index",
    snapshotPrefix: "uncollected_stock_rows_",
    rowCount: Array.isArray(rows) ? rows.length : 0,
    chunkSize,
    generatedAt,
  };
}

function dashboardRowSnapshotRows(dashboard, generatedAt = new Date().toISOString()) {
  const rows = Array.isArray(dashboard?.rows) ? dashboard.rows : [];
  const chunkSize = boundedChunkSize(process.env.SUPABASE_DASHBOARD_ROWS_CHUNK_SIZE, 250);
  return snapshotChunkRows({
    rows,
    prefix: "dashboard_rows",
    indexKey: "dashboard_rows_index",
    chunkSize,
    generatedAt,
  });
}

function uncollectedStockSnapshotRows(dashboard, generatedAt = new Date().toISOString()) {
  const rows = Array.isArray(dashboard?.uncollectedStockDeductions?.rows)
    ? dashboard.uncollectedStockDeductions.rows
    : [];
  const chunkSize = boundedChunkSize(process.env.SUPABASE_UNCOLLECTED_ROWS_CHUNK_SIZE, 250);
  return snapshotChunkRows({
    rows,
    prefix: "uncollected_stock_rows",
    indexKey: "uncollected_stock_rows_index",
    chunkSize,
    generatedAt,
  });
}

function dashboardSnapshotPayload(dashboard, generatedAt = new Date().toISOString()) {
  if (!dashboard || typeof dashboard !== "object") return {};
  const payload = { ...dashboard };
  const dashboardRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (dashboardRows.length) {
    const chunkSize = boundedChunkSize(process.env.SUPABASE_DASHBOARD_ROWS_CHUNK_SIZE, 250);
    delete payload.rows;
    payload.rowsMeta = dashboardRowsMeta(dashboardRows, chunkSize, generatedAt);
  }

  const uncollectedRows = Array.isArray(payload.uncollectedStockDeductions?.rows)
    ? payload.uncollectedStockDeductions.rows
    : [];
  if (uncollectedRows.length) {
    const chunkSize = boundedChunkSize(process.env.SUPABASE_UNCOLLECTED_ROWS_CHUNK_SIZE, 250);
    const meta = uncollectedRowsMeta(uncollectedRows, chunkSize, generatedAt);
    payload.uncollectedStockDeductions = { ...payload.uncollectedStockDeductions };
    delete payload.uncollectedStockDeductions.rows;
    payload.uncollectedStockDeductions.rowsMeta = meta;
    payload.uncollectedStockRowsMeta = meta;
  }

  const platformPaymentOrders = Array.isArray(payload.platformPaymentOrders) ? payload.platformPaymentOrders : [];
  if (platformPaymentOrders.length) {
    delete payload.platformPaymentOrders;
    payload.platformPaymentOrdersMeta = {
      omittedFromSupabaseSnapshot: true,
      reason: "Use the Render-built inline dashboard payload for the full platform order table.",
      rowCount: platformPaymentOrders.length,
      generatedAt: new Date().toISOString(),
    };
  }
  return payload;
}

function sellerPaymentsSnapshotPayload(sellerPayments) {
  if (!sellerPayments || typeof sellerPayments !== "object") return {};
  const orders = Array.isArray(sellerPayments.orders) ? sellerPayments.orders : [];
  return {
    exportedAt: sellerPayments.exportedAt || "",
    source: sellerPayments.source || "Seller platform order payments",
    rule: sellerPayments.rule || "",
    partial: Boolean(sellerPayments.partial),
    counts: sellerPayments.counts || {
      totalOrders: orders.length,
      errors: Array.isArray(sellerPayments.errors) ? sellerPayments.errors.length : 0,
    },
    errors: Array.isArray(sellerPayments.errors) ? sellerPayments.errors.slice(0, 100) : [],
    ordersMeta: {
      omittedFromSupabaseSnapshot: true,
      reason: "Order-level seller payments are joined into stock movements during dashboard build to avoid large Supabase RPC payloads.",
      rowCount: orders.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

function snapshotRows() {
  const dashboard = readJson(path.join(distDir, "inventory-valuation-data.json"), {});
  const stockMovements = readJson(path.join(distDir, "stock-movements.json"), { rows: [] });
  const sellerPayments = readJson(path.join(dataDir, "seller_compare", "seller_order_payments.json"), {});
  const generatedAt = new Date().toISOString();
  return [
    ...dashboardRowSnapshotRows(dashboard, generatedAt),
    ...uncollectedStockSnapshotRows(dashboard, generatedAt),
    { key: "dashboard_current", payload: dashboardSnapshotPayload(dashboard, generatedAt) },
    { key: "stock_movements_current", payload: stockMovementSummary(stockMovements) },
    { key: "seller_payments_current", payload: sellerPaymentsSnapshotPayload(sellerPayments) },
    { key: "source_files_current", payload: compactSourceFiles() },
  ];
}

function movementKey(item) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify([
        item.stockShopId || "",
        item.createdAt || "",
        item.referenceNo || "",
        item.platformOrderNo || "",
        item.addQuantity || 0,
        item.removeQuantity || 0,
        item.totalQuantity || 0,
      ])
    )
    .digest("hex");
}

function movementRows() {
  const stockMovements = readJson(path.join(distDir, "stock-movements.json"), { rows: [] });
  return (stockMovements.rows || [])
    .filter((item) => Number(item.stockShopId || 0))
    .map((item) => ({
      movement_key: movementKey(item),
      stock_shop_id: Number(item.stockShopId || 0),
      sku: String(item.sku || "").trim().toUpperCase(),
      created_at: item.createdAt || null,
      payload: item,
      updated_at: new Date().toISOString(),
    }));
}

async function supabaseRpc(functionName, body) {
  const baseUrl = supabaseBaseUrl();
  const apiKey = supabaseApiKey();
  const writeKey = supabaseWriteKey();
  if (!baseUrl || !apiKey || !writeKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_WRITE_KEY before publishing to Supabase.");
  }
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_write_key: writeKey, ...(body || {}) }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text.slice(0, 400) };
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.hint || `Supabase status ${response.status}`);
  }
  return payload;
}

async function publishChunk({ snapshots = [], movements = [] }) {
  return supabaseRpc("sync_publish_app", {
    p_snapshots: snapshots,
    p_movements: movements,
  });
}

async function upsertSnapshots(rows) {
  const stats = [];
  for (const row of rows) {
    await publishChunk({
      snapshots: [{ ...row, updated_at: new Date().toISOString() }],
    });
    stats.push({ key: row.key, bytes: Buffer.byteLength(JSON.stringify(row.payload)) });
  }
  return stats;
}

async function upsertMovements(rows, chunkSize = 500) {
  let uploaded = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await publishChunk({ movements: chunk });
    uploaded += chunk.length;
    if (uploaded % 5000 === 0 || uploaded === rows.length) {
      console.log(JSON.stringify({ step: "packhai_stock_movements", uploaded, total: rows.length }));
    }
  }
  return uploaded;
}

async function main() {
  const snapshots = snapshotRows();
  const movementItems = movementRows();
  const snapshotStats = await upsertSnapshots(snapshots);
  const uploadedMovements = await upsertMovements(movementItems);
  console.log(
    JSON.stringify(
      {
        ok: true,
        appSnapshots: snapshotStats,
        packhaiStockMovements: uploadedMovements,
        dashboardUrl: process.env.PUBLIC_DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL || "",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
