const fs = require("fs");
const path = require("path");

const VAT_RATE = 7;
const VALID_RECIPIENT_TYPES = new Set(["individual", "company"]);
const VALID_AMOUNT_MODES = new Set(["exclusive", "inclusive"]);
const VALID_VAT_MODES = new Set(["vat7", "none", "exempt"]);
const VALID_STATUSES = new Set(["draft", "posted", "cancelled"]);
const VALID_WHT_RATES = new Set([0, 1, 2, 3, 5]);

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB|บาท/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function todayDate(now = new Date().toISOString()) {
  return String(now).slice(0, 10);
}

function monthKey(date) {
  const text = String(date || "");
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : todayDate().slice(0, 7);
}

function compactMonth(date) {
  return monthKey(date).replace("-", "");
}

function pndTypeForRecipient(recipientType) {
  return recipientType === "individual" ? "PND3" : "PND53";
}

function calculateExpense(input = {}) {
  const amountInput = roundMoney(numberValue(input.amountInput));
  const amountMode = VALID_AMOUNT_MODES.has(input.amountMode) ? input.amountMode : "exclusive";
  const vatMode = VALID_VAT_MODES.has(input.vatMode) ? input.vatMode : "none";
  const whtRate = VALID_WHT_RATES.has(numberValue(input.whtRate)) ? numberValue(input.whtRate) : 0;

  let subtotal = amountInput;
  let vatAmount = 0;
  let grossAmount = amountInput;
  if (vatMode === "vat7") {
    if (amountMode === "inclusive") {
      grossAmount = amountInput;
      subtotal = roundMoney(grossAmount / (1 + VAT_RATE / 100));
      vatAmount = roundMoney(grossAmount - subtotal);
    } else {
      subtotal = amountInput;
      vatAmount = roundMoney(subtotal * (VAT_RATE / 100));
      grossAmount = roundMoney(subtotal + vatAmount);
    }
  }

  const withholdingBase = subtotal;
  const withholdingAmount = roundMoney(withholdingBase * (whtRate / 100));
  const netPayable = roundMoney(grossAmount - withholdingAmount);

  return {
    amountInput,
    amountMode,
    vatMode,
    vatRate: vatMode === "vat7" ? VAT_RATE : 0,
    whtRate,
    subtotal,
    vatAmount,
    grossAmount,
    withholdingBase,
    withholdingAmount,
    netPayable,
  };
}

function normalizeStatus(value) {
  return VALID_STATUSES.has(value) ? value : "posted";
}

function normalizeExpensePayload(payload = {}) {
  const paymentDate = String(payload.paymentDate || todayDate()).slice(0, 10);
  const recipientType = VALID_RECIPIENT_TYPES.has(payload.recipientType) ? payload.recipientType : "company";
  const recipientName = String(payload.recipientName || "").trim();
  const amountInput = numberValue(payload.amountInput);
  if (!recipientName) throw new Error("Recipient name is required.");
  if (!(amountInput > 0)) throw new Error("Expense amount must be greater than zero.");

  const calc = calculateExpense({
    amountInput,
    amountMode: payload.amountMode,
    vatMode: payload.vatMode,
    whtRate: payload.whtRate,
  });

  return {
    status: normalizeStatus(payload.status),
    paymentDate,
    recipientName,
    recipientTaxId: String(payload.recipientTaxId || "").trim(),
    recipientAddress: String(payload.recipientAddress || "").trim(),
    recipientType,
    pndType: pndTypeForRecipient(recipientType),
    category: String(payload.category || "ค่าใช้จ่ายทั่วไป").trim(),
    description: String(payload.description || payload.category || "ค่าใช้จ่าย").trim(),
    invoiceNo: String(payload.invoiceNo || "").trim(),
    notes: String(payload.notes || "").trim(),
    ...calc,
  };
}

function nextDocumentNumber(existing, fieldName, prefix, date) {
  const month = compactMonth(date);
  const matchPrefix = `${prefix}-${month}-`;
  const max = (existing || []).reduce((current, record) => {
    const value = String(record?.[fieldName] || "");
    if (!value.startsWith(matchPrefix)) return current;
    const parsed = Number(value.slice(matchPrefix.length));
    return Number.isFinite(parsed) ? Math.max(current, parsed) : current;
  }, 0);
  return `${matchPrefix}${String(max + 1).padStart(4, "0")}`;
}

function createExpenseRecord(payload, options = {}) {
  const now = options.now || new Date().toISOString();
  const existing = options.existing || [];
  const normalized = normalizeExpensePayload(payload);
  const expenseNo =
    payload.expenseNo || nextDocumentNumber(existing, "expenseNo", "EXP", normalized.paymentDate);
  const whtNo =
    normalized.withholdingAmount > 0
      ? payload.whtNo || nextDocumentNumber(existing, "whtNo", "WHT", normalized.paymentDate)
      : "";

  return {
    id: payload.id || `exp_${Date.parse(now).toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: payload.createdAt || now,
    updatedAt: now,
    expenseNo,
    whtNo,
    ...normalized,
  };
}

function activeExpenses(records) {
  return (records || []).filter((record) => record.status !== "cancelled");
}

function filterExpenses(records, options = {}) {
  return activeExpenses(records).filter((record) => {
    if (options.month && monthKey(record.paymentDate) !== options.month) return false;
    if (options.pndType && record.pndType !== options.pndType) return false;
    return true;
  });
}

function summarizeExpenses(records, options = {}) {
  const filtered = filterExpenses(records, options);
  return filtered.reduce(
    (summary, record) => {
      summary.count += 1;
      summary.subtotal = roundMoney(summary.subtotal + numberValue(record.subtotal));
      summary.vatAmount = roundMoney(summary.vatAmount + numberValue(record.vatAmount));
      summary.grossAmount = roundMoney(summary.grossAmount + numberValue(record.grossAmount));
      summary.withholdingAmount = roundMoney(summary.withholdingAmount + numberValue(record.withholdingAmount));
      summary.netPayable = roundMoney(summary.netPayable + numberValue(record.netPayable));
      if (record.pndType === "PND3") summary.pnd3Count += 1;
      if (record.pndType === "PND53") summary.pnd53Count += 1;
      return summary;
    },
    {
      month: options.month || "",
      count: 0,
      pnd3Count: 0,
      pnd53Count: 0,
      subtotal: 0,
      vatAmount: 0,
      grossAmount: 0,
      withholdingAmount: 0,
      netPayable: 0,
    }
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function renderExpensesCsv(records, options = {}) {
  const rows = filterExpenses(records, options);
  const headers = [
    "Expense No",
    "WHT No",
    "Payment Date",
    "Recipient",
    "Tax ID",
    "Recipient Type",
    "PND Type",
    "Category",
    "Description",
    "Invoice No",
    "Subtotal",
    "VAT",
    "Gross",
    "WHT Rate",
    "WHT",
    "Net Payable",
    "Status",
  ];
  const lines = [headers.join(",")];
  for (const record of rows) {
    lines.push(
      [
        record.expenseNo,
        record.whtNo,
        record.paymentDate,
        record.recipientName,
        record.recipientTaxId,
        record.recipientType,
        record.pndType,
        record.category,
        record.description,
        record.invoiceNo,
        record.subtotal,
        record.vatAmount,
        record.grossAmount,
        record.whtRate,
        record.withholdingAmount,
        record.netPayable,
        record.status,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue(value));
}

function documentCss() {
  return `
    body { font-family: Tahoma, "Noto Sans Thai", Arial, sans-serif; margin: 28px; color: #161827; }
    .doc { border: 1px solid #cfd5e8; padding: 28px; border-radius: 8px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 22px 0 10px; font-size: 16px; }
    .muted { color: #6e7590; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
    .row { display: flex; justify-content: space-between; border-bottom: 1px solid #e6e9f4; padding: 8px 0; }
    .total { font-size: 18px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d9deee; padding: 9px; text-align: left; }
    th { background: #f3f5fb; }
    .right { text-align: right; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 58px; }
    .signature { border-top: 1px solid #8d94aa; text-align: center; padding-top: 10px; }
  `;
}

function renderPaymentVoucherHtml(record) {
  return `<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><title>${escapeHtml(record.expenseNo)}</title><style>${documentCss()}</style></head>
<body>
  <div class="doc">
    <h1>ใบสำคัญจ่าย</h1>
    <div class="muted">Payment Voucher · ${escapeHtml(record.expenseNo)}</div>
    <div class="grid">
      <div><strong>วันที่จ่าย:</strong> ${escapeHtml(record.paymentDate)}</div>
      <div><strong>เลขที่หัก ณ ที่จ่าย:</strong> ${escapeHtml(record.whtNo || "-")}</div>
      <div><strong>ผู้รับเงิน:</strong> ${escapeHtml(record.recipientName)}</div>
      <div><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${escapeHtml(record.recipientTaxId || "-")}</div>
      <div><strong>ประเภท:</strong> ${escapeHtml(record.recipientType === "individual" ? "บุคคลธรรมดา" : "นิติบุคคล")}</div>
      <div><strong>แบบรายงาน:</strong> ${escapeHtml(record.pndType)}</div>
    </div>
    <h2>รายละเอียดค่าใช้จ่าย</h2>
    <table>
      <thead><tr><th>รายการ</th><th class="right">จำนวนเงิน</th></tr></thead>
      <tbody>
        <tr><td>${escapeHtml(record.description)}</td><td class="right">${money(record.subtotal)}</td></tr>
        <tr><td>VAT ${escapeHtml(record.vatRate)}%</td><td class="right">${money(record.vatAmount)}</td></tr>
        <tr><td>หัก ณ ที่จ่าย ${escapeHtml(record.whtRate)}%</td><td class="right">-${money(record.withholdingAmount)}</td></tr>
        <tr><th>สุทธิจ่าย</th><th class="right total">${money(record.netPayable)}</th></tr>
      </tbody>
    </table>
    <p><strong>หมายเหตุ:</strong> ${escapeHtml(record.notes || "-")}</p>
    <div class="signatures">
      <div class="signature">ผู้รับเงิน</div>
      <div class="signature">ผู้อนุมัติจ่าย</div>
    </div>
  </div>
</body></html>`;
}

function renderWithholdingCertificateHtml(record) {
  return `<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><title>${escapeHtml(record.whtNo || record.expenseNo)}</title><style>${documentCss()}</style></head>
<body>
  <div class="doc">
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <div class="muted">50 ทวิ · ${escapeHtml(record.whtNo || "-")} · ${escapeHtml(record.pndType)}</div>
    <div class="grid">
      <div><strong>วันที่จ่าย:</strong> ${escapeHtml(record.paymentDate)}</div>
      <div><strong>เลขที่ใบสำคัญจ่าย:</strong> ${escapeHtml(record.expenseNo)}</div>
      <div><strong>ผู้ถูกหักภาษี:</strong> ${escapeHtml(record.recipientName)}</div>
      <div><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${escapeHtml(record.recipientTaxId || "-")}</div>
      <div><strong>ที่อยู่:</strong> ${escapeHtml(record.recipientAddress || "-")}</div>
      <div><strong>แบบ:</strong> ${escapeHtml(record.pndType)}</div>
    </div>
    <h2>รายการเงินได้และภาษีที่หัก</h2>
    <table>
      <thead><tr><th>ประเภทเงินได้</th><th class="right">ฐานภาษี</th><th class="right">อัตรา</th><th class="right">ภาษีที่หัก</th></tr></thead>
      <tbody>
        <tr>
          <td>${escapeHtml(record.category || record.description)}</td>
          <td class="right">${money(record.withholdingBase)}</td>
          <td class="right">${escapeHtml(record.whtRate)}%</td>
          <td class="right">${money(record.withholdingAmount)}</td>
        </tr>
      </tbody>
    </table>
    <p class="muted">เอกสารนี้จัดทำเพื่อใช้เป็นหลักฐานภายในและส่งให้ผู้รับเงินตรวจสอบก่อนนำไปใช้ยื่นภาษี</p>
    <div class="signatures">
      <div class="signature">ผู้จ่ายเงิน</div>
      <div class="signature">ผู้รับรองเอกสาร</div>
    </div>
  </div>
</body></html>`;
}

function emptyExpenseStore() {
  return {
    version: 1,
    updatedAt: "",
    expenses: [],
  };
}

function readExpenseStore(file) {
  try {
    return { ...emptyExpenseStore(), ...JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) };
  } catch {
    return emptyExpenseStore();
  }
}

function writeExpenseStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...emptyExpenseStore(), ...store, updatedAt: new Date().toISOString() };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return next;
}

function appendExpense(file, payload) {
  const store = readExpenseStore(file);
  const record = createExpenseRecord(payload, { existing: store.expenses });
  store.expenses.unshift(record);
  writeExpenseStore(file, store);
  return record;
}

function findExpense(store, id) {
  return (store.expenses || []).find((record) => record.id === id || record.expenseNo === id || record.whtNo === id);
}

function cancelExpense(file, id) {
  const store = readExpenseStore(file);
  const record = findExpense(store, id);
  if (!record) throw new Error("Expense was not found.");
  record.status = "cancelled";
  record.updatedAt = new Date().toISOString();
  writeExpenseStore(file, store);
  return record;
}

module.exports = {
  VAT_RATE,
  calculateExpense,
  normalizeExpensePayload,
  createExpenseRecord,
  summarizeExpenses,
  renderExpensesCsv,
  renderPaymentVoucherHtml,
  renderWithholdingCertificateHtml,
  emptyExpenseStore,
  readExpenseStore,
  writeExpenseStore,
  appendExpense,
  findExpense,
  cancelExpense,
  monthKey,
  roundMoney,
};
