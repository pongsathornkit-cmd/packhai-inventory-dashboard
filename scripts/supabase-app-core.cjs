const fs = require("fs");
const path = require("path");

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sqlNumber(value) {
  return String(numberValue(value));
}

function snapshotRow(key, payload) {
  return `(${sqlString(key)}, ${sqlJson(payload)}, now())`;
}

function normalizeExpense(row = {}) {
  return {
    id: String(row.id || ""),
    expenseNo: String(row.expenseNo || row.expense_no || ""),
    whtNo: String(row.whtNo || row.wht_no || ""),
    paymentDate: String(row.paymentDate || row.payment_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    recipientName: String(row.recipientName || row.recipient_name || ""),
    recipientTaxId: String(row.recipientTaxId || row.recipient_tax_id || ""),
    recipientAddress: String(row.recipientAddress || row.recipient_address || ""),
    recipientType: String(row.recipientType || row.recipient_type || "company"),
    pndType: String(row.pndType || row.pnd_type || "PND53"),
    category: String(row.category || ""),
    description: String(row.description || ""),
    invoiceNo: String(row.invoiceNo || row.invoice_no || ""),
    notes: String(row.notes || ""),
    amountInput: numberValue(row.amountInput || row.amount_input),
    amountMode: String(row.amountMode || row.amount_mode || "exclusive"),
    vatMode: String(row.vatMode || row.vat_mode || "none"),
    vatRate: numberValue(row.vatRate || row.vat_rate),
    whtRate: numberValue(row.whtRate || row.wht_rate),
    subtotal: numberValue(row.subtotal),
    vatAmount: numberValue(row.vatAmount || row.vat_amount),
    grossAmount: numberValue(row.grossAmount || row.gross_amount),
    withholdingBase: numberValue(row.withholdingBase || row.withholding_base || row.subtotal),
    withholdingAmount: numberValue(row.withholdingAmount || row.withholding_amount),
    netPayable: numberValue(row.netPayable || row.net_payable),
    status: String(row.status || "posted"),
    createdAt: String(row.createdAt || row.created_at || new Date().toISOString()),
    updatedAt: String(row.updatedAt || row.updated_at || row.createdAt || row.created_at || new Date().toISOString()),
  };
}

function expenseValues(rows = []) {
  const normalized = rows.map(normalizeExpense).filter((row) => row.id && row.recipientName);
  if (!normalized.length) return "";
  return normalized
    .map(
      (row) => `(${[
        sqlString(row.id),
        sqlString(row.expenseNo),
        sqlString(row.whtNo),
        sqlString(row.paymentDate),
        sqlString(row.recipientName),
        sqlString(row.recipientTaxId),
        sqlString(row.recipientAddress),
        sqlString(row.recipientType),
        sqlString(row.pndType),
        sqlString(row.category),
        sqlString(row.description),
        sqlString(row.invoiceNo),
        sqlString(row.notes),
        sqlNumber(row.amountInput),
        sqlString(row.amountMode),
        sqlString(row.vatMode),
        sqlNumber(row.vatRate),
        sqlNumber(row.whtRate),
        sqlNumber(row.subtotal),
        sqlNumber(row.vatAmount),
        sqlNumber(row.grossAmount),
        sqlNumber(row.withholdingBase),
        sqlNumber(row.withholdingAmount),
        sqlNumber(row.netPayable),
        sqlString(row.status),
        sqlString(row.createdAt),
        sqlString(row.updatedAt),
      ].join(", ")})`
    )
    .join(",\n  ");
}

function buildExpenseSeedSql(expenses = []) {
  const values = expenseValues(expenses);
  if (!values) return "";
  return `insert into public.expense_records (
  id, expense_no, wht_no, payment_date, recipient_name, recipient_tax_id, recipient_address,
  recipient_type, pnd_type, category, description, invoice_no, notes, amount_input,
  amount_mode, vat_mode, vat_rate, wht_rate, subtotal, vat_amount, gross_amount,
  withholding_base, withholding_amount, net_payable, status, created_at, updated_at
)
values
  ${values}
on conflict (id) do update
set
  expense_no = excluded.expense_no,
  wht_no = excluded.wht_no,
  payment_date = excluded.payment_date,
  recipient_name = excluded.recipient_name,
  recipient_tax_id = excluded.recipient_tax_id,
  recipient_address = excluded.recipient_address,
  recipient_type = excluded.recipient_type,
  pnd_type = excluded.pnd_type,
  category = excluded.category,
  description = excluded.description,
  invoice_no = excluded.invoice_no,
  notes = excluded.notes,
  amount_input = excluded.amount_input,
  amount_mode = excluded.amount_mode,
  vat_mode = excluded.vat_mode,
  vat_rate = excluded.vat_rate,
  wht_rate = excluded.wht_rate,
  subtotal = excluded.subtotal,
  vat_amount = excluded.vat_amount,
  gross_amount = excluded.gross_amount,
  withholding_base = excluded.withholding_base,
  withholding_amount = excluded.withholding_amount,
  net_payable = excluded.net_payable,
  status = excluded.status,
  updated_at = excluded.updated_at;`;
}

function buildAppSnapshotSeedSql(payload = {}) {
  const rows = [
    snapshotRow("dashboard_current", payload.dashboard || {}),
    snapshotRow("stock_movements_current", payload.stockMovements || {}),
    snapshotRow("seller_payments_current", payload.sellerPayments || {}),
    snapshotRow("source_files_current", payload.sourceFiles || {}),
    snapshotRow("index_html", { html: payload.indexHtml || "" }),
  ];
  const expenseSql = buildExpenseSeedSql(payload.expenses || []);
  return [
    "begin;",
    `insert into public.app_snapshots (key, payload, updated_at)
values
  ${rows.join(",\n  ")}
on conflict (key) do update
set payload = excluded.payload,
    updated_at = excluded.updated_at;`,
    expenseSql,
    "commit;",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function readCurrentAppPayload(projectRoot = path.resolve(__dirname, "..")) {
  const dataDir = path.join(projectRoot, "data");
  const distDir = path.join(projectRoot, "dist");
  const expenses = readJson(path.join(dataDir, "expenses.json"), { expenses: [] });
  return {
    dashboard: readJson(path.join(distDir, "inventory-valuation-data.json"), {}),
    stockMovements: readJson(path.join(distDir, "stock-movements.json"), {}),
    sellerPayments: readJson(path.join(dataDir, "seller_compare", "seller_order_payments.json"), {}),
    sourceFiles: {
      packhai: readJson(path.join(dataDir, "packhai_stock.json"), {}),
      websiteStock: readJson(path.join(dataDir, "flowaccount_stock_selected_warehouses.json"), {}),
      shopee: readJson(path.join(dataDir, "seller_compare", "shopee_products_export.json"), {}),
      lazada: readJson(path.join(dataDir, "seller_compare", "lazada_products_export.json"), {}),
      ktw: readJson(path.join(dataDir, "ktw_product_source", "ktw_price_update_plan.json"), {}),
    },
    indexHtml: fs.existsSync(path.join(distDir, "index.html"))
      ? fs.readFileSync(path.join(distDir, "index.html"), "utf8")
      : "",
    expenses: Array.isArray(expenses.expenses) ? expenses.expenses : [],
  };
}

module.exports = {
  buildAppSnapshotSeedSql,
  buildExpenseSeedSql,
  readCurrentAppPayload,
};
