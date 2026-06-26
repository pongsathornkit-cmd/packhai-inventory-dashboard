const { summarizeExpenses } = require("./expense-core.cjs");

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|บาท|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  }).format(numberValue(value));
}

function compactText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function daysBetween(now, isoDate) {
  const end = new Date(now);
  const start = new Date(isoDate || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

function buildAssistantContext(dashboard = {}, expenseStore = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const rows = Array.isArray(dashboard.rows) ? dashboard.rows : [];
  const positiveRows = rows.filter((row) => numberValue(row.quantity) > 0);
  const topProducts = positiveRows
    .slice()
    .sort((a, b) => numberValue(b.inventoryValue) - numberValue(a.inventoryValue))
    .slice(0, 20)
    .map((row) => ({
      sku: row.sku || "",
      name: row.name || "",
      warehouseName: row.warehouseName || "",
      stockSource: row.stockSource || "",
      quantity: numberValue(row.quantity),
      inventoryValue: numberValue(row.inventoryValue),
      latestStockMovementAt: row.latestStockMovementAt || "",
      stockMovementAgeDays: daysBetween(now, row.latestStockMovementAt),
    }));
  const staleStock = positiveRows
    .map((row) => ({
      sku: row.sku || "",
      name: row.name || "",
      warehouseName: row.warehouseName || "",
      stockSource: row.stockSource || "",
      quantity: numberValue(row.quantity),
      inventoryValue: numberValue(row.inventoryValue),
      latestStockMovementAt: row.latestStockMovementAt || "",
      stockMovementAgeDays: daysBetween(now, row.latestStockMovementAt),
    }))
    .filter((row) => row.stockMovementAgeDays != null)
    .sort((a, b) => b.stockMovementAgeDays - a.stockMovementAgeDays || b.inventoryValue - a.inventoryValue)
    .slice(0, 50);

  const expenses = Array.isArray(expenseStore.expenses) ? expenseStore.expenses : [];
  const month = String(options.month || now.slice(0, 7)).slice(0, 7);

  return {
    generatedAt: now,
    inventory: {
      totalInventoryValue: numberValue(dashboard.summary?.totalInventoryValue),
      positiveStockRows: numberValue(dashboard.summary?.positiveStockRows),
      topProducts,
      staleStock,
    },
    expenses: {
      month,
      summary: summarizeExpenses(expenses, { month }),
      recent: expenses.slice(0, 20),
    },
  };
}

function extractAmount(message) {
  const match = String(message || "").match(/([\d,]+(?:\.\d+)?)\s*(?:บาท|฿)?/);
  return match ? numberValue(match[1]) : 0;
}

function parseExpenseDraft(message) {
  const text = String(message || "");
  const normalized = compactText(text);
  const amountInput = extractAmount(text);
  const categoryKeywords = ["ค่าขนส่ง", "ค่าโฆษณา", "ค่าเช่า", "ค่าซ่อมแซม", "ค่าบริการ", "ค่าใช้จ่ายทั่วไป"];
  const category = categoryKeywords.find((item) => text.includes(item)) || "ค่าใช้จ่ายทั่วไป";
  const vatMode = /vat\s*7|แวต\s*7|ภาษี\s*7/i.test(text) ? "vat7" : "none";
  const whtMatch = text.match(/(?:หัก|withholding|wht)[^\d]*(\d+(?:\.\d+)?)\s*%?/i);
  const whtRate = whtMatch ? numberValue(whtMatch[1]) : 0;
  const recipientType = /บุคคลธรรมดา|นาย|นาง|น\.ส\./i.test(text) && !/บริษัท|บจก|จำกัด|co\.|ltd/i.test(text) ? "individual" : "company";
  const recipientPatterns = [
    /ให้บริษัท\s+(.+)$/i,
    /บริษัท\s+(.+)$/i,
    /ให้\s+(.+)$/i,
  ];
  let recipientName = "";
  for (const pattern of recipientPatterns) {
    const match = text.match(pattern);
    if (match) {
      recipientName = match[1].trim();
      break;
    }
  }
  recipientName = recipientName.replace(/^(บริษัท|บจก\.?|จำกัด)\s+/i, "").trim();

  return {
    status: "posted",
    paymentDate: new Date().toISOString().slice(0, 10),
    recipientType,
    recipientName,
    category,
    description: category,
    amountInput,
    amountMode: vatMode === "vat7" ? "inclusive" : "exclusive",
    vatMode,
    whtRate,
    notes: `สร้างจาก AI Command: ${text}`.slice(0, 240),
    confidence: amountInput > 0 && recipientName ? "medium" : "low",
    sourceText: normalized,
  };
}

function formatProductList(rows, limit = 10) {
  return rows
    .slice(0, limit)
    .map((row, index) => `${index + 1}. ${row.sku} · ${row.name || "-"} · ${money(row.inventoryValue)} · คงเหลือ ${row.quantity}`)
    .join("\n");
}

function parseInventorySearch(message) {
  return String(message || "")
    .replace(/^(ช่วย)?\s*(ค้นหา|หา|search|ดู)\s*/i, "")
    .replace(/^(สินค้า|sku|รหัสสินค้า)\s*/i, "")
    .replace(/\s*(ใน)?\s*(ตาราง|คลัง|stock|inventory)\s*$/i, "")
    .trim();
}

function runRuleAssistant(message, context) {
  const text = compactText(message);
  if (!text) {
    return {
      reply: "พิมพ์คำถามหรือคำสั่งได้เลย เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, หรือสร้างค่าใช้จ่าย",
      actions: [],
      source: "rule",
    };
  }

  if (/สร้าง.*ค่าใช้จ่าย|ลง.*ค่าใช้จ่าย|บันทึก.*ค่าใช้จ่าย/.test(text)) {
    const draft = parseExpenseDraft(message);
    return {
      reply:
        `ผมเตรียม draft ค่าใช้จ่ายให้แล้ว: ${draft.category} ${money(draft.amountInput)} ` +
        `ผู้รับเงิน ${draft.recipientName || "(ยังไม่ระบุ)"} · VAT ${draft.vatMode === "vat7" ? "7%" : "ไม่มี"} · หัก ${draft.whtRate}%\n` +
        "กดปุ่มด้านล่างเพื่อเติมลงฟอร์ม แล้วตรวจสอบก่อนบันทึกจริง",
      actions: [{ type: "fillExpenseForm", label: "เติมฟอร์มค่าใช้จ่าย", payload: draft }],
      source: "rule",
    };
  }

  if (/ค่าใช้จ่าย|ภ\.ง\.ด|ภงด|หัก ณ ที่จ่าย|wht/.test(text)) {
    const summary = context.expenses.summary || {};
    return {
      reply:
        `สรุปค่าใช้จ่ายเดือน ${context.expenses.month}: ${money(summary.grossAmount)} จาก ${summary.count || 0} รายการ\n` +
        `VAT ซื้อ ${money(summary.vatAmount)} · หัก ณ ที่จ่าย ${money(summary.withholdingAmount)} · สุทธิจ่าย ${money(summary.netPayable)}\n` +
        `แยกแบบ: ภ.ง.ด.3 ${summary.pnd3Count || 0} รายการ / ภ.ง.ด.53 ${summary.pnd53Count || 0} รายการ`,
      actions: [{ type: "navigate", label: "เปิดหน้าค่าใช้จ่าย", hash: "expenses" }],
      source: "rule",
    };
  }

  if (/ไม่เดิน|movement|เคลื่อนไหว|เกิน\s*\d+\s*วัน/.test(text)) {
    const dayMatch = text.match(/(\d+)\s*วัน/);
    const minDays = dayMatch ? numberValue(dayMatch[1]) : 30;
    const matches = (context.inventory.staleStock || []).filter((row) => numberValue(row.stockMovementAgeDays) >= minDays).slice(0, 10);
    return {
      reply: matches.length
        ? `สินค้าที่ stock ไม่เดินเกิน ${minDays} วัน (เรียงจากค้างนานสุด):\n${matches
            .map((row, index) => `${index + 1}. ${row.sku} · ${row.name || "-"} · ${row.stockMovementAgeDays} วัน · ${money(row.inventoryValue)}`)
            .join("\n")}`
        : `ยังไม่พบสินค้าที่มีประวัติ stock ไม่เดินเกิน ${minDays} วันในข้อมูล Packhai`,
      actions: [{ type: "filterInventory", label: "เปิดตารางสินค้า", query: "", sort: "movementDesc", hash: "inventory-detail" }],
      source: "rule",
    };
  }

  if (/มูลค่าสูงสุด|top|แพงสุด|มูลค่า.*สินค้า/.test(text)) {
    return {
      reply: `สินค้ามูลค่าสูงสุดตอนนี้:\n${formatProductList(context.inventory.topProducts || [], 10)}`,
      actions: [{ type: "filterInventory", label: "เรียงตารางตามมูลค่า", query: "", sort: "valueDesc", hash: "inventory-detail" }],
      source: "rule",
    };
  }

  if (/^(ช่วย)?\s*(ค้นหา|หา|search|ดู)\s+|sku|รหัสสินค้า/.test(text)) {
    const query = parseInventorySearch(message);
    if (query) {
      return {
        reply: `ผมเตรียมค้นหา "${query}" ในตารางสินค้าให้แล้ว กดปุ่มด้านล่างเพื่อเปิดรายการที่เกี่ยวข้อง`,
        actions: [
          {
            type: "filterInventory",
            label: `ค้นหา ${query.slice(0, 24)}`,
            query,
            sort: "valueDesc",
            hash: "inventory-detail",
          },
        ],
        source: "rule",
      };
    }
  }

  if (/เปิด.*packhai|คลัง packhai|ตาราง.*คลัง/.test(text)) {
    return {
      reply: "เปิดตารางสินค้าและเตรียมตัวกรองสำหรับคลัง Packhai ให้แล้ว",
      actions: [{ type: "filterInventory", label: "เปิดตารางคลัง Packhai", query: "", sort: "valueDesc", warehouseName: "PACKHAI", hash: "inventory-detail" }],
      source: "rule",
    };
  }

  return {
    reply:
      "ตอนนี้ผมช่วยได้กับคำสั่งหลักๆ เช่น สรุปสินค้ามูลค่าสูงสุด, หา stock ไม่เดิน, สรุปค่าใช้จ่าย, หรือสร้าง draft ค่าใช้จ่ายจากข้อความครับ",
    actions: [],
    source: "rule",
  };
}

function assistantSystemPrompt() {
  return [
    "You are an assistant embedded in a Thai inventory and expense dashboard.",
    "Answer in Thai, concise and executive-friendly.",
    "Only suggest actions from this allowlist: filterInventory, navigate, fillExpenseForm.",
    "Never claim that an expense has been saved. Expense creation must be a draft/action for user confirmation.",
    "Return JSON only with keys: reply, actions.",
  ].join("\n");
}

module.exports = {
  buildAssistantContext,
  parseExpenseDraft,
  runRuleAssistant,
  assistantSystemPrompt,
};
