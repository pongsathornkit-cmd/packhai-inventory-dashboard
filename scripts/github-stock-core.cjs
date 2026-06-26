const fs = require("fs");

const WAREHOUSES = [
  {
    id: 491661,
    name: "\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08",
    apiName: "\u0e04\u0e25\u0e31\u0e07\u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08",
    label: "\u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08",
    pattern: /(?:\u0e04\u0e25\u0e31\u0e07\s*)?(?:\u0e0b\.?\s*\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08|\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08|charoen\s*kit|charoenkit)/giu,
  },
  {
    id: 491662,
    name: "\u0e04\u0e25\u0e31\u0e07 \u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c",
    apiName: "\u0e04\u0e25\u0e31\u0e07\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c",
    label: "\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c",
    pattern: /(?:\u0e04\u0e25\u0e31\u0e07\s*)?(?:\u0e2a\u0e38\u0e02\s*\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c|\u0e2a\u0e38\u0e02\s*\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34|suk\s*sawat|suksawat)/giu,
  },
];

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function compactText(value) {
  return String(value ?? "").toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
}

function findWarehouseById(id) {
  return WAREHOUSES.find((item) => String(item.id) === String(id)) || null;
}

function findWarehouseByName(value) {
  const text = compactText(value);
  if (!text) return null;
  return (
    WAREHOUSES.find((warehouse) => {
      warehouse.pattern.lastIndex = 0;
      return warehouse.pattern.test(text) || text.includes(String(warehouse.id));
    }) || null
  );
}

function findWarehouseMatches(message) {
  const text = String(message || "");
  const matches = [];
  for (const warehouse of WAREHOUSES) {
    warehouse.pattern.lastIndex = 0;
    let match;
    while ((match = warehouse.pattern.exec(text)) !== null) {
      matches.push({
        warehouse,
        index: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function extractSku(message) {
  const text = String(message || "");
  const patterns = [
    /(?:\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32|\u0e40\u0e1e\u0e34\u0e48\u0e21\s*stock|\u0e25\u0e07\s*stock|add(?:\s+product|\s+sku|\s+stock)?|update(?:\s+sku)?)\s+([A-Z0-9][A-Z0-9._/-]{1,})/i,
    /(?:sku|\u0e23\u0e2b\u0e31\u0e2a\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{1,})/i,
    /\b[A-Z][A-Z0-9]*-[A-Z0-9._/-]+\b/i,
    /\b[A-Z]\d+[A-Z0-9._/-]*\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] || match?.[0]) return normalizeSku(match[1] || match[0]);
  }
  return "";
}

function detectOperation(message) {
  const text = compactText(message);
  if (/(subtract|remove|deduct|\u0e25\u0e14|\u0e15\u0e31\u0e14)/i.test(text)) return "subtract";
  if (/(set|replace|\u0e15\u0e31\u0e49\u0e07|\u0e1b\u0e23\u0e31\u0e1a\u0e40\u0e1b\u0e47\u0e19|\u0e41\u0e01\u0e49\u0e40\u0e1b\u0e47\u0e19|\u0e40\u0e1b\u0e47\u0e19\u0e08\u0e33\u0e19\u0e27\u0e19)/i.test(text)) {
    return "set";
  }
  return "add";
}

function hasStockUpdateVerb(message) {
  return /(?:add|update|set|insert|adjust|\u0e40\u0e1e\u0e34\u0e48\u0e21|\u0e40\u0e15\u0e34\u0e21|\u0e1b\u0e23\u0e31\u0e1a|\u0e15\u0e31\u0e49\u0e07|\u0e41\u0e01\u0e49|\u0e25\u0e07|\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01)/i.test(
    String(message || "")
  );
}

function extractQuantity(segment) {
  const match = String(segment || "").match(
    /(?:\u0e08\u0e33\u0e19\u0e27\u0e19|qty|quantity|=|:)?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:\u0e2d\u0e31\u0e19|\u0e0a\u0e34\u0e49\u0e19|\u0e2b\u0e19\u0e48\u0e27\u0e22|pcs?|units?)?/i
  );
  if (!match) return 0;
  return numberValue(match[1]);
}

function parseStockUpdateCommand(message) {
  const text = String(message || "");
  const warehouseMatches = findWarehouseMatches(text);
  if (!warehouseMatches.length || !hasStockUpdateVerb(text)) return null;

  const sku = extractSku(text);
  if (!sku) return null;

  const operation = detectOperation(text);
  const allocations = [];
  for (let index = 0; index < warehouseMatches.length; index += 1) {
    const current = warehouseMatches[index];
    const next = warehouseMatches[index + 1];
    const segment = text.slice(current.end, next ? next.index : text.length);
    const quantity = extractQuantity(segment);
    if (quantity <= 0) continue;
    const existing = allocations.find((item) => item.warehouseId === current.warehouse.id);
    if (existing) existing.quantity += quantity;
    else {
      allocations.push({
        warehouseId: current.warehouse.id,
        warehouseName: current.warehouse.name,
        warehouseLabel: current.warehouse.label,
        quantity,
      });
    }
  }

  if (!allocations.length) return null;
  return {
    sku,
    operation,
    allocations,
    sourceText: text.trim().slice(0, 500),
  };
}

function operationLabel(operation) {
  if (operation === "set") return "\u0e15\u0e31\u0e49\u0e07\u0e08\u0e33\u0e19\u0e27\u0e19\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d";
  if (operation === "subtract") return "\u0e25\u0e14\u0e08\u0e33\u0e19\u0e27\u0e19";
  return "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e08\u0e33\u0e19\u0e27\u0e19";
}

function formatStockUpdateReply(update) {
  const lines = update.allocations
    .map((item) => `- ${item.warehouseName}: ${item.quantity.toLocaleString("th-TH")} \u0e2b\u0e19\u0e48\u0e27\u0e22`)
    .join("\n");
  return (
    `\u0e1c\u0e21\u0e2d\u0e48\u0e32\u0e19\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e44\u0e14\u0e49\u0e40\u0e1b\u0e47\u0e19 ${operationLabel(update.operation)} SKU ${update.sku}\n${lines}\n` +
    `\u0e01\u0e14\u0e1b\u0e38\u0e48\u0e21\u0e14\u0e49\u0e32\u0e19\u0e25\u0e48\u0e32\u0e07\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e25\u0e07\u0e04\u0e25\u0e31\u0e07 GitHub Stock \u0e41\u0e25\u0e30 publish dashboard`
  );
}

function sanitizeStockUpdatePayload(payload = {}) {
  const sku = normalizeSku(payload.sku);
  const operation = ["add", "set", "subtract"].includes(payload.operation) ? payload.operation : "add";
  const allocations = (Array.isArray(payload.allocations) ? payload.allocations : [])
    .map((item) => {
      const warehouse = findWarehouseById(item.warehouseId) || findWarehouseByName(item.warehouseName || item.warehouseLabel);
      return warehouse
        ? {
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            warehouseLabel: warehouse.label,
            quantity: numberValue(item.quantity),
          }
        : null;
    })
    .filter((item) => item && item.quantity > 0)
    .slice(0, 4);

  if (!sku || !allocations.length) throw new Error("Stock update needs SKU and at least one warehouse quantity.");
  return {
    sku,
    operation,
    allocations,
    sourceText: String(payload.sourceText || "").slice(0, 500),
  };
}

function duplicateSkus(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(normalizeSku(row.sku), (counts.get(normalizeSku(row.sku)) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sku, count]) => ({ sku, count }));
}

function applyOperation(currentQuantity, quantity, operation) {
  if (operation === "set") return quantity;
  if (operation === "subtract") return Math.max(0, currentQuantity - quantity);
  return currentQuantity + quantity;
}

function productTemplate(rows, sku) {
  return rows.find((row) => normalizeSku(row.sku) === sku) || null;
}

function applyGithubStockUpdate(file, payload, options = {}) {
  const update = sanitizeStockUpdatePayload(payload);
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const now = options.now || new Date().toISOString();
  const touched = [];
  const template = productTemplate(rows, update.sku) || {};

  for (const allocation of update.allocations) {
    let row = rows.find(
      (item) => normalizeSku(item.sku) === update.sku && String(item.warehouseId) === String(allocation.warehouseId)
    );
    const beforeQuantity = numberValue(row?.quantity);
    const nextQuantity = applyOperation(beforeQuantity, allocation.quantity, update.operation);
    if (!row) {
      row = {
        sku: update.sku,
        name: template.name || update.sku,
        barcode: template.barcode || "",
        prop: template.prop || "",
        quantity: 0,
        waiting: 0,
        waitImport: 0,
        available: 0,
        stockSource: "FlowAccount",
        warehouseId: allocation.warehouseId,
        warehouseName: allocation.warehouseName,
        source: `FlowAccount ${allocation.warehouseName}`,
        productId: template.productId || "",
        productMasterId: template.productMasterId || "",
      };
      rows.push(row);
    }
    row.sku = update.sku;
    row.warehouseId = allocation.warehouseId;
    row.warehouseName = allocation.warehouseName;
    row.stockSource = "FlowAccount";
    row.source = `FlowAccount ${allocation.warehouseName}`;
    row.quantity = nextQuantity;
    row.available = nextQuantity;
    row.waiting = numberValue(row.waiting);
    row.waitImport = numberValue(row.waitImport);
    row.manualUpdatedAt = now;
    row.manualUpdateSource = "AI Command";
    row.manualUpdateNote = update.sourceText || "";
    touched.push({ ...allocation, beforeQuantity, afterQuantity: nextQuantity });
  }

  snapshot.rows = rows;
  snapshot.exportedAt = now;
  snapshot.syncDate = now.slice(0, 10);
  snapshot.rowCount = rows.length;
  snapshot.uniqueSkuCount = new Set(rows.map((row) => normalizeSku(row.sku)).filter(Boolean)).size;
  snapshot.duplicateSkus = duplicateSkus(rows);
  snapshot.warehouses = WAREHOUSES.map((warehouse) => {
    const existing = (snapshot.warehouses || []).find((item) => String(item.id) === String(warehouse.id)) || {};
    const rowCount = rows.filter((row) => String(row.warehouseId) === String(warehouse.id)).length;
    return {
      ...existing,
      id: warehouse.id,
      name: warehouse.name,
      apiName: existing.apiName || warehouse.apiName,
      reportedTotal: rowCount,
      rowCount,
    };
  });

  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  return {
    ok: true,
    sku: update.sku,
    operation: update.operation,
    allocations: touched,
    exportedAt: now,
    rowCount: snapshot.rowCount,
    uniqueSkuCount: snapshot.uniqueSkuCount,
  };
}

module.exports = {
  WAREHOUSES,
  applyGithubStockUpdate,
  formatStockUpdateReply,
  operationLabel,
  parseStockUpdateCommand,
  sanitizeStockUpdatePayload,
};
