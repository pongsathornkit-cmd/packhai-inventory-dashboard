const fs = require("fs");
const path = require("path");

const DELIVERY_WAREHOUSES = [
  {
    id: 491661,
    name: "คลัง ซ.เจริญกิจ",
    label: "ซ.เจริญกิจ",
    pattern: /(?:คลัง\s*)?(?:ซ\.?\s*เจริญกิจ|เจริญกิจ|charoen\s*kit|charoenkit)/iu,
  },
  {
    id: 491662,
    name: "คลัง สุขสวัสดิ์",
    label: "สุขสวัสดิ์",
    pattern: /(?:คลัง\s*)?(?:สุข\s*สวัสดิ์|สุข\s*สวัสดิ|suk\s*sawat|suksawat)/iu,
  },
];

const INSPECTION_TEMPLATE = [
  { key: "previousCheck", label: "ตรวจเดิม" },
  { key: "stockCutCheck", label: "ตัด stock" },
  { key: "evidenceLink", label: "สถานะ/หลักฐาน (ลิงก์)" },
];

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[,\s]|THB|บาท/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSku(value) {
  return String(value ?? "").trim().replace(/^'+/, "").replace(/\.0$/, "").toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
  return cleanText(value).toLowerCase().normalize("NFC");
}

function findDeliveryWarehouse(value) {
  const text = compactText(value);
  if (!text) return null;
  return (
    DELIVERY_WAREHOUSES.find((warehouse) => {
      if (String(warehouse.id) === String(value)) return true;
      warehouse.pattern.lastIndex = 0;
      return warehouse.pattern.test(text);
    }) || null
  );
}

function resolveDeliveryWarehouse(payload = {}, fallback = null) {
  const warehouse =
    findDeliveryWarehouse(payload.warehouseId) ||
    findDeliveryWarehouse(payload.warehouseName) ||
    findDeliveryWarehouse(payload.warehouseLabel) ||
    fallback ||
    null;
  if (!warehouse) {
    return {
      id: "",
      name: cleanText(payload.warehouseName || payload.warehouseLabel || "ยังไม่ระบุคลัง"),
      label: cleanText(payload.warehouseLabel || payload.warehouseName || "ยังไม่ระบุ"),
    };
  }
  return warehouse;
}

function parseLegacyDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = cleanText(value);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!slash) return "";
  const day = Number(slash[1]);
  const month = Number(slash[2]);
  let year = Number(slash[3]);
  if (year < 100) year += 2500;
  if (year > 2400) year -= 543;
  if (!day || !month || !year) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function baseStore() {
  return {
    schemaVersion: 1,
    source: "Packhai delivery note website store",
    importedFrom: [],
    inspectionTemplate: INSPECTION_TEMPLATE,
    notes: [],
    updatedAt: "",
  };
}

function readDeliveryNoteStore(file) {
  const raw = readJsonSafe(file, null);
  const store = raw && typeof raw === "object" ? raw : baseStore();
  return {
    ...baseStore(),
    ...store,
    inspectionTemplate: Array.isArray(store.inspectionTemplate) ? store.inspectionTemplate : INSPECTION_TEMPLATE,
    notes: Array.isArray(store.notes) ? store.notes.map(normalizeDeliveryNoteRecord).filter(Boolean) : [],
  };
}

function writeDeliveryNoteStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function nextLineId(index = 0) {
  return `line-${Date.now().toString(36)}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeLine(rawLine = {}, index = 0) {
  const sku = normalizeSku(rawLine.sku || rawLine.productSku || rawLine.code);
  const name = cleanText(rawLine.name || rawLine.productName || rawLine.title);
  const quantity = numberValue(rawLine.quantity || rawLine.qty);
  const unit = cleanText(rawLine.unit || rawLine.uom || "PCS") || "PCS";
  if (!sku && !name && quantity <= 0) return null;
  return {
    id: cleanText(rawLine.id) || nextLineId(index),
    rowNo: Number(rawLine.rowNo || rawLine.no || index + 1) || index + 1,
    groupNote: cleanText(rawLine.groupNote || rawLine.group || rawLine.noteGroup),
    sku,
    name: name || sku,
    quantity,
    unit,
    previousCheck: cleanText(rawLine.previousCheck || rawLine.legacyCheck || ""),
    stockCutCheck: cleanText(rawLine.stockCutCheck || rawLine.stockCut || ""),
    evidenceLink: cleanText(rawLine.evidenceLink || rawLine.evidence || ""),
    inspectionStatus: cleanText(rawLine.inspectionStatus || rawLine.statusText || ""),
    remark: cleanText(rawLine.remark || rawLine.note || ""),
  };
}

function normalizeDeliveryNoteRecord(note) {
  if (!note || typeof note !== "object") return null;
  const warehouse = resolveDeliveryWarehouse(note);
  const lines = (Array.isArray(note.lines) ? note.lines : []).map(sanitizeLine).filter(Boolean);
  return {
    id: cleanText(note.id) || `dn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    deliveryNo: cleanText(note.deliveryNo || note.no),
    sourceSheet: cleanText(note.sourceSheet || ""),
    sourceUrl: cleanText(note.sourceUrl || ""),
    status: cleanText(note.status || "draft"),
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    warehouseLabel: warehouse.label,
    deliveryDate: parseLegacyDate(note.deliveryDate || note.date) || todayIso(),
    destination: cleanText(note.destination || ""),
    customerName: cleanText(note.customerName || note.customer || ""),
    preparedBy: cleanText(note.preparedBy || note.owner || ""),
    checkedBy: cleanText(note.checkedBy || ""),
    checkedAt: cleanText(note.checkedAt || ""),
    confirmedAt: cleanText(note.confirmedAt || ""),
    stockDeductedAt: cleanText(note.stockDeductedAt || ""),
    stockDeductionError: cleanText(note.stockDeductionError || ""),
    stockResults: Array.isArray(note.stockResults) ? note.stockResults : [],
    remark: cleanText(note.remark || note.note || ""),
    createdAt: cleanText(note.createdAt || new Date().toISOString()),
    updatedAt: cleanText(note.updatedAt || note.createdAt || new Date().toISOString()),
    importedAt: cleanText(note.importedAt || ""),
    lines,
  };
}

function nextDeliveryNo(notes, dateValue) {
  const date = parseLegacyDate(dateValue) || todayIso();
  const prefix = `DN-${date.replace(/-/g, "")}`;
  const next = notes.reduce((max, note) => {
    const match = String(note.deliveryNo || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function upsertDeliveryNote(file, payload = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const store = readDeliveryNoteStore(file);
  const existingIndex = store.notes.findIndex((note) => note.id === payload.id || note.deliveryNo === payload.deliveryNo);
  const existing = existingIndex >= 0 ? store.notes[existingIndex] : null;
  const warehouse = resolveDeliveryWarehouse(payload, existing ? resolveDeliveryWarehouse(existing) : DELIVERY_WAREHOUSES[1]);
  const lines = (Array.isArray(payload.lines) ? payload.lines : []).map(sanitizeLine).filter(Boolean);
  const note = normalizeDeliveryNoteRecord({
    ...(existing || {}),
    ...payload,
    id: existing?.id || cleanText(payload.id) || `dn-${now.replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`,
    deliveryNo: cleanText(payload.deliveryNo) || existing?.deliveryNo || nextDeliveryNo(store.notes, payload.deliveryDate),
    status: cleanText(payload.status) || existing?.status || "draft",
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    warehouseLabel: warehouse.label,
    deliveryDate: parseLegacyDate(payload.deliveryDate) || existing?.deliveryDate || todayIso(),
    updatedAt: now,
    createdAt: existing?.createdAt || now,
    lines,
  });

  if (note.stockDeductedAt && existing?.stockDeductedAt) {
    note.lines = existing.lines;
  }

  if (existingIndex >= 0) store.notes[existingIndex] = note;
  else store.notes.unshift(note);
  store.updatedAt = now;
  writeDeliveryNoteStore(file, store);
  return { ok: true, note, store: publicDeliveryNoteState(store) };
}

function buildStockDeductionPayloads(note) {
  const normalized = normalizeDeliveryNoteRecord(note);
  const warehouse = findDeliveryWarehouse(normalized.warehouseId || normalized.warehouseName);
  if (!warehouse) throw new Error("Delivery note needs warehouse before stock deduction.");
  const bySku = new Map();
  for (const line of normalized.lines) {
    const sku = normalizeSku(line.sku);
    const quantity = numberValue(line.quantity);
    if (!sku || quantity <= 0) continue;
    bySku.set(sku, (bySku.get(sku) || 0) + quantity);
  }
  if (!bySku.size) throw new Error("Delivery note needs at least one SKU quantity before stock deduction.");
  return [...bySku.entries()].map(([sku, quantity]) => ({
    sku,
    operation: "subtract",
    actor: "Delivery Note",
    note: `ใบส่งของ ${normalized.deliveryNo}`,
    sourceText: `Delivery note ${normalized.deliveryNo} confirmed from ${warehouse.name}`,
    allocations: [
      {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        quantity,
      },
    ],
  }));
}

function confirmDeliveryNote(file, id, payload = {}, stockResults = [], options = {}) {
  const now = options.now || new Date().toISOString();
  const store = readDeliveryNoteStore(file);
  const index = store.notes.findIndex((note) => note.id === id || note.deliveryNo === id);
  if (index < 0) throw new Error("Delivery note was not found.");
  const current = store.notes[index];
  if (current.stockDeductedAt) {
    return { ok: true, note: current, store: publicDeliveryNoteState(store), alreadyConfirmed: true };
  }
  const note = normalizeDeliveryNoteRecord({
    ...current,
    ...payload,
    id: current.id,
    deliveryNo: current.deliveryNo,
    lines: Array.isArray(payload.lines) ? payload.lines : current.lines,
    status: "checked",
    checkedBy: cleanText(payload.checkedBy || current.checkedBy || "Website"),
    checkedAt: now,
    confirmedAt: now,
    stockDeductedAt: now,
    stockResults,
    updatedAt: now,
  });
  store.notes[index] = note;
  store.updatedAt = now;
  writeDeliveryNoteStore(file, store);
  return { ok: true, note, store: publicDeliveryNoteState(store) };
}

function deliveryStatusLabel(status) {
  if (status === "checked") return "ยืนยันการตรวจแล้ว";
  if (status === "legacy_imported") return "นำเข้าเดิม";
  if (status === "ready") return "รอตรวจ";
  if (status === "void") return "ยกเลิก";
  return "ร่าง";
}

function summarizeDeliveryNotes(notes = []) {
  const summary = {
    totalNotes: notes.length,
    draft: 0,
    ready: 0,
    checked: 0,
    legacyImported: 0,
    totalLines: 0,
    totalQuantity: 0,
    stockDeducted: 0,
  };
  for (const note of notes) {
    if (note.status === "checked") summary.checked += 1;
    else if (note.status === "ready") summary.ready += 1;
    else if (note.status === "legacy_imported") summary.legacyImported += 1;
    else summary.draft += 1;
    if (note.stockDeductedAt) summary.stockDeducted += 1;
    for (const line of note.lines || []) {
      summary.totalLines += 1;
      summary.totalQuantity += numberValue(line.quantity);
    }
  }
  return summary;
}

function publicDeliveryNoteState(storeOrNotes) {
  const store = Array.isArray(storeOrNotes) ? { ...baseStore(), notes: storeOrNotes } : storeOrNotes || baseStore();
  const notes = Array.isArray(store.notes) ? store.notes.map(normalizeDeliveryNoteRecord).filter(Boolean) : [];
  notes.sort((a, b) => {
    const dateCompare = String(b.deliveryDate || "").localeCompare(String(a.deliveryDate || ""));
    if (dateCompare) return dateCompare;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return {
    ok: true,
    schemaVersion: store.schemaVersion || 1,
    source: store.source || "Packhai delivery note website store",
    updatedAt: store.updatedAt || "",
    importedFrom: Array.isArray(store.importedFrom) ? store.importedFrom : [],
    warehouses: DELIVERY_WAREHOUSES.map(({ pattern, ...warehouse }) => warehouse),
    inspectionTemplate: Array.isArray(store.inspectionTemplate) ? store.inspectionTemplate : INSPECTION_TEMPLATE,
    summary: summarizeDeliveryNotes(notes),
    notes,
  };
}

function headerIndex(values = []) {
  const index = values.findIndex((row) => {
    const text = row.map(cleanText).join("|");
    return /ลำดับ/.test(text) && /(รหัสสินค้า|SKU)/i.test(text);
  });
  return index >= 0 ? index : 0;
}

function sheetDate(values = [], headerRowIndex = 0) {
  const candidates = [
    values[0]?.[7],
    values[headerRowIndex]?.[7],
    values[1]?.[7],
  ];
  for (const value of candidates) {
    const parsed = parseLegacyDate(value);
    if (parsed) return parsed;
  }
  return todayIso();
}

function buildLegacyDeliveryNotesFromSheets(sheetValuesByName = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const sourceUrl = options.sourceUrl || "";
  const notes = [];
  for (const [sheetName, values] of Object.entries(sheetValuesByName)) {
    if (!Array.isArray(values) || !values.length) continue;
    const header = headerIndex(values);
    const deliveryDate = sheetDate(values, header);
    const lines = values
      .slice(header + 1)
      .map((row, index) =>
        sanitizeLine(
          {
            groupNote: row[1],
            rowNo: row[2],
            name: row[3],
            sku: row[4],
            quantity: row[5],
            unit: row[6],
            previousCheck: row[8],
            stockCutCheck: row[9],
            evidenceLink: row[10],
          },
          index
        )
      )
      .filter((line) => line && (line.sku || line.name) && line.quantity > 0);
    if (!lines.length) continue;
    notes.push(
      normalizeDeliveryNoteRecord({
        id: `legacy-${sheetName.toLowerCase()}`,
        deliveryNo: `LEGACY-${sheetName}`,
        sourceSheet: sheetName,
        sourceUrl,
        status: "legacy_imported",
        warehouseName: "นำเข้าจาก Google Sheet",
        deliveryDate,
        preparedBy: cleanText(values[header + 1]?.[1] || ""),
        remark: "นำเข้าข้อมูลเดิมจาก Google Sheet ยังไม่ตัด stock ซ้ำ",
        importedAt: now,
        createdAt: now,
        updatedAt: now,
        lines,
      })
    );
  }
  return notes;
}

module.exports = {
  DELIVERY_WAREHOUSES,
  INSPECTION_TEMPLATE,
  buildLegacyDeliveryNotesFromSheets,
  buildStockDeductionPayloads,
  confirmDeliveryNote,
  deliveryStatusLabel,
  findDeliveryWarehouse,
  normalizeDeliveryNoteRecord,
  parseLegacyDate,
  publicDeliveryNoteState,
  readDeliveryNoteStore,
  summarizeDeliveryNotes,
  upsertDeliveryNote,
};
