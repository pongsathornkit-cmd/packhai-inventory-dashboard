const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssistantContext,
  parseExpenseDraft,
  runRuleAssistant,
} = require("../scripts/assistant-core.cjs");

const dashboard = {
  summary: {
    totalInventoryValue: 7905887.95,
    positiveStockRows: 1199,
  },
  rows: [
    {
      sku: "A-1",
      name: "Alpha Product",
      stockSource: "Packhai",
      warehouseName: "คลัง PACKHAI บางใหญ่",
      quantity: 10,
      inventoryValue: 10000,
      latestStockMovementAt: "2026-05-01T00:00:00.000Z",
    },
    {
      sku: "B-2",
      name: "Beta Product",
      stockSource: "FlowAccount",
      warehouseName: "คลัง สุขสวัสดิ์",
      quantity: 4,
      inventoryValue: 8000,
      latestStockMovementAt: "",
    },
  ],
};

const expenseStore = {
  expenses: [
    {
      status: "posted",
      paymentDate: "2026-06-10",
      recipientName: "ABC Co.",
      pndType: "PND53",
      grossAmount: 1070,
      vatAmount: 70,
      withholdingAmount: 30,
      netPayable: 1040,
    },
  ],
};

test("builds compact assistant context from dashboard and expenses", () => {
  const context = buildAssistantContext(dashboard, expenseStore, { now: "2026-06-26T00:00:00.000Z" });

  assert.equal(context.inventory.totalInventoryValue, 7905887.95);
  assert.equal(context.inventory.topProducts[0].sku, "A-1");
  assert.equal(context.inventory.staleStock[0].sku, "A-1");
  assert.equal(context.expenses.summary.grossAmount, 1070);
});

test("parses Thai expense creation text into a safe draft", () => {
  const draft = parseExpenseDraft("สร้างค่าใช้จ่ายค่าขนส่ง 1070 บาท VAT 7 หัก 3% ให้บริษัท ABC Logistics");

  assert.equal(draft.category, "ค่าขนส่ง");
  assert.equal(draft.amountInput, 1070);
  assert.equal(draft.vatMode, "vat7");
  assert.equal(draft.whtRate, 3);
  assert.equal(draft.recipientType, "company");
  assert.equal(draft.recipientName, "ABC Logistics");
  assert.equal(draft.status, "posted");
});

test("answers top inventory value question with filter action", () => {
  const context = buildAssistantContext(dashboard, expenseStore, { now: "2026-06-26T00:00:00.000Z" });
  const result = runRuleAssistant("สรุปสินค้ามูลค่าสูงสุด 10 รายการ", context);

  assert.match(result.reply, /A-1/);
  assert.equal(result.actions[0].type, "filterInventory");
  assert.equal(result.actions[0].sort, "valueDesc");
});

test("creates an inventory search action from natural language", () => {
  const context = buildAssistantContext(dashboard, expenseStore, { now: "2026-06-26T00:00:00.000Z" });
  const result = runRuleAssistant("ค้นหา SKU P301-PC3B1017-1", context);

  assert.match(result.reply, /P301-PC3B1017-1/);
  assert.equal(result.actions[0].type, "filterInventory");
  assert.equal(result.actions[0].query, "P301-PC3B1017-1");
  assert.equal(result.actions[0].hash, "inventory-detail");
});

test("creates an expense form-fill action without saving immediately", () => {
  const context = buildAssistantContext(dashboard, expenseStore, { now: "2026-06-26T00:00:00.000Z" });
  const result = runRuleAssistant("สร้างค่าใช้จ่ายค่าขนส่ง 1070 บาท VAT 7 หัก 3% ให้บริษัท ABC Logistics", context);

  assert.match(result.reply, /ตรวจสอบก่อนบันทึก/);
  assert.equal(result.actions[0].type, "fillExpenseForm");
  assert.equal(result.actions[0].payload.amountInput, 1070);
});
