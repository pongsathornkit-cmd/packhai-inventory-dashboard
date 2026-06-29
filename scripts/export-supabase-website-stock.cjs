const fs = require("fs");
const path = require("path");
const { mapSupabaseWebsiteSnapshot } = require("./supabase-stock-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.PACKHAI_DATA_DIR ? path.resolve(process.env.PACKHAI_DATA_DIR) : path.join(projectRoot, "data");
const defaultOutputFile = path.join(dataDir, "supabase_website_stock.json");

function parseArgs(argv) {
  const args = {
    output: defaultOutputFile,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--output") args.output = path.resolve(argv[++index] || "");
  }
  return args;
}

function supabaseBaseUrl() {
  const explicitUrl = String(process.env.SUPABASE_URL || process.env.SUPABASE_REST_URL || "").trim().replace(/\/+$/, "");
  if (explicitUrl) return explicitUrl.replace(/\/rest\/v1$/i, "");
  const projectId = String(process.env.SUPABASE_PROJECT_ID || "").trim();
  return projectId ? `https://${projectId}.supabase.co` : "";
}

function supabaseApiKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
}

async function readSupabaseJson(pathname) {
  const baseUrl = supabaseBaseUrl();
  const apiKey = supabaseApiKey();
  if (!baseUrl || !apiKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY before exporting Website Stock.");
  }
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`Supabase returned non-JSON ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new Error(payload.message || payload.hint || `Supabase status ${response.status}`);
  return payload;
}

function flattenBalanceRows(rows) {
  return rows.map((row) => ({
    sku: row.sku,
    name: row.products?.name || row.sku,
    barcode: row.products?.barcode || "",
    prop: row.products?.prop || "",
    product_id: row.products?.product_id || "",
    product_master_id: row.products?.product_master_id || "",
    quantity: row.quantity,
    waiting: row.waiting,
    wait_import: row.wait_import,
    available: row.available,
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouses?.name || "",
    source_ref: row.source_ref || "",
  }));
}

function flattenTransactionRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    sku: row.sku,
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouses?.name || "",
    operation: row.operation,
    before_quantity: row.before_quantity,
    input_quantity: row.input_quantity,
    after_quantity: row.after_quantity,
    delta_quantity: row.delta_quantity,
    actor: row.actor,
    note: row.note,
    source_text: row.source_text,
    source: row.source,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const balanceRows = await readSupabaseJson(
    "stock_balances?select=sku,warehouse_id,quantity,waiting,wait_import,available,source_ref,products(name,barcode,prop,product_id,product_master_id),warehouses(name)&source=eq.Website%20Stock&order=sku.asc"
  );
  const transactionRows = await readSupabaseJson(
    "stock_transactions?select=id,created_at,sku,warehouse_id,operation,before_quantity,input_quantity,after_quantity,delta_quantity,actor,note,source_text,source,warehouses(name)&source=eq.Website%20Stock&order=created_at.desc&limit=2000"
  );
  const snapshot = mapSupabaseWebsiteSnapshot(flattenBalanceRows(balanceRows), flattenTransactionRows(transactionRows));
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: args.output,
        rows: snapshot.rows.length,
        transactions: snapshot.stockTransactions.length,
        exportedAt: snapshot.exportedAt,
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
