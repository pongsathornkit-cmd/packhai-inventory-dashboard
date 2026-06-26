const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateExpense,
  normalizeExpensePayload,
  createExpenseRecord,
  summarizeExpenses,
  renderExpensesCsv,
} = require("../scripts/expense-core.cjs");

test("calculates VAT-exclusive expense with 3 percent withholding", () => {
  const result = calculateExpense({
    amountInput: 1000,
    amountMode: "exclusive",
    vatMode: "vat7",
    whtRate: 3,
  });

  assert.equal(result.subtotal, 1000);
  assert.equal(result.vatAmount, 70);
  assert.equal(result.grossAmount, 1070);
  assert.equal(result.withholdingBase, 1000);
  assert.equal(result.withholdingAmount, 30);
  assert.equal(result.netPayable, 1040);
});

test("calculates VAT-inclusive expense from gross amount", () => {
  const result = calculateExpense({
    amountInput: 1070,
    amountMode: "inclusive",
    vatMode: "vat7",
    whtRate: 3,
  });

  assert.equal(result.subtotal, 1000);
  assert.equal(result.vatAmount, 70);
  assert.equal(result.grossAmount, 1070);
  assert.equal(result.withholdingAmount, 30);
  assert.equal(result.netPayable, 1040);
});

test("normalizes recipient type to PND report type", () => {
  const individual = normalizeExpensePayload({
    paymentDate: "2026-06-26",
    recipientName: "Somchai",
    recipientType: "individual",
    amountInput: 500,
  });
  const company = normalizeExpensePayload({
    paymentDate: "2026-06-26",
    recipientName: "Example Co., Ltd.",
    recipientType: "company",
    amountInput: 500,
  });

  assert.equal(individual.pndType, "PND3");
  assert.equal(company.pndType, "PND53");
});

test("creates records with monthly expense and WHT numbers", () => {
  const record = createExpenseRecord(
    {
      paymentDate: "2026-06-26",
      recipientName: "Example Co., Ltd.",
      recipientType: "company",
      amountInput: 1000,
      vatMode: "vat7",
      whtRate: 3,
    },
    { existing: [{ expenseNo: "EXP-202606-0001", whtNo: "WHT-202606-0001" }], now: "2026-06-26T10:00:00.000Z" }
  );

  assert.equal(record.expenseNo, "EXP-202606-0002");
  assert.equal(record.whtNo, "WHT-202606-0002");
  assert.equal(record.status, "posted");
  assert.equal(record.pndType, "PND53");
  assert.match(record.id, /^exp_/);
});

test("summarizes posted expenses and excludes cancelled records", () => {
  const records = [
    createExpenseRecord(
      { paymentDate: "2026-06-01", recipientName: "A", recipientType: "company", amountInput: 1000, vatMode: "vat7", whtRate: 3 },
      { now: "2026-06-01T00:00:00.000Z" }
    ),
    {
      ...createExpenseRecord(
        { paymentDate: "2026-06-02", recipientName: "B", recipientType: "individual", amountInput: 500, vatMode: "none", whtRate: 0 },
        { now: "2026-06-02T00:00:00.000Z" }
      ),
      status: "cancelled",
    },
  ];

  const summary = summarizeExpenses(records, { month: "2026-06" });

  assert.equal(summary.count, 1);
  assert.equal(summary.subtotal, 1000);
  assert.equal(summary.vatAmount, 70);
  assert.equal(summary.withholdingAmount, 30);
  assert.equal(summary.netPayable, 1040);
});

test("renders CSV filtered by PND type", () => {
  const records = [
    createExpenseRecord(
      { paymentDate: "2026-06-01", recipientName: "Company A", recipientType: "company", amountInput: 1000, vatMode: "vat7", whtRate: 3 },
      { now: "2026-06-01T00:00:00.000Z" }
    ),
    createExpenseRecord(
      { paymentDate: "2026-06-02", recipientName: "Person B", recipientType: "individual", amountInput: 500, vatMode: "none", whtRate: 3 },
      { now: "2026-06-02T00:00:00.000Z" }
    ),
  ];

  const csv = renderExpensesCsv(records, { pndType: "PND3" });

  assert.match(csv, /^Expense No,/);
  assert.doesNotMatch(csv, /Company A/);
  assert.match(csv, /Person B/);
  assert.match(csv, /PND3/);
});
