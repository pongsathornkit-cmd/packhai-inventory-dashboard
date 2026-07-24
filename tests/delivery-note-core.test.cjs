const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildLegacyDeliveryNotesFromSheets,
  buildStockDeductionPayloads,
  confirmDeliveryNote,
  parseLegacyDate,
  readDeliveryNoteStore,
  upsertDeliveryNote,
} = require("../scripts/delivery-note-core.cjs");

test("legacy Google Sheet dates are normalized from Buddhist year shortcuts", () => {
  assert.equal(parseLegacyDate("17/7/69"), "2026-07-17");
  assert.equal(parseLegacyDate("20/6/2569"), "2026-06-20");
});

test("imports delivery note rows from the old Sheet211 style layout", () => {
  const notes = buildLegacyDeliveryNotesFromSheets(
    {
      Sheet211: [
        ["", "Column 1", "ลำดับ", "ชื่อสินค้า", "รหัสสินค้า", "จำนวน", "หน่วย", "27/7/69"],
        ["", "พี่วุฒิ", "1", "PC-10", "Haitun-PC10", "96", "PCS"],
        ["", "", "2", "หัวปากกาอัดไม้", "84502", "100", "PCS"],
      ],
    },
    { now: "2026-07-24T00:00:00.000Z" }
  );

  assert.equal(notes.length, 1);
  assert.equal(notes[0].deliveryNo, "LEGACY-Sheet211");
  assert.equal(notes[0].status, "legacy_imported");
  assert.equal(notes[0].deliveryDate, "2026-07-27");
  assert.equal(notes[0].lines.length, 2);
  assert.equal(notes[0].lines[0].sku, "HAITUN-PC10");
  assert.equal(notes[0].lines[0].quantity, 96);
});

test("delivery notes build grouped subtract payloads for the selected website warehouse", () => {
  const payloads = buildStockDeductionPayloads({
    deliveryNo: "DN-20260724-001",
    warehouseId: 491662,
    warehouseName: "คลัง สุขสวัสดิ์",
    lines: [
      { sku: "V80L-China", quantity: 2, unit: "PCS" },
      { sku: "V80L-CHINA", quantity: 3, unit: "PCS" },
      { sku: "A100", quantity: 1, unit: "PCS" },
    ],
  });

  assert.equal(payloads.length, 2);
  assert.deepEqual(
    payloads.find((item) => item.sku === "V80L-CHINA").allocations,
    [{ warehouseId: 491662, warehouseName: "คลัง สุขสวัสดิ์", quantity: 5 }]
  );
  assert.equal(payloads[0].operation, "subtract");
});

test("upsert and confirm delivery note store preserves a no-repeat stock deduction marker", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-notes-"));
  const file = path.join(tempDir, "delivery_notes.json");

  const saved = upsertDeliveryNote(
    file,
    {
      deliveryDate: "2026-07-24",
      warehouseId: 491661,
      destination: "รถบริษัท",
      preparedBy: "Owner",
      lines: [{ sku: "P525-1320", name: "ใบเลื่อย", quantity: 4, unit: "PCS" }],
    },
    { now: "2026-07-24T09:00:00.000Z" }
  );
  assert.match(saved.note.deliveryNo, /^DN-20260724-/);

  const confirmed = confirmDeliveryNote(
    file,
    saved.note.id,
    { checkedBy: "Checker" },
    [{ sku: "P525-1320", ok: true }],
    { now: "2026-07-24T09:10:00.000Z" }
  );
  const store = readDeliveryNoteStore(file);

  assert.equal(confirmed.note.status, "checked");
  assert.equal(confirmed.note.checkedBy, "Checker");
  assert.equal(confirmed.note.stockDeductedAt, "2026-07-24T09:10:00.000Z");
  assert.equal(store.notes[0].stockResults[0].sku, "P525-1320");
});
