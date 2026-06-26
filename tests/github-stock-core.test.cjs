const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  applyGithubStockUpdate,
  parseStockUpdateCommand,
} = require("../scripts/github-stock-core.cjs");
const { buildAssistantContext, runRuleAssistant } = require("../scripts/assistant-core.cjs");

const command =
  "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 V80L-CHINA \u0e40\u0e02\u0e49\u0e32\u0e44\u0e1b\u0e17\u0e35\u0e48\u0e04\u0e25\u0e31\u0e07\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c \u0e08\u0e33\u0e19\u0e27\u0e19 100 \u0e2d\u0e31\u0e19 \u0e41\u0e25\u0e30 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08 \u0e08\u0e33\u0e19\u0e27\u0e19 10 \u0e2d\u0e31\u0e19";

test("parses multi-warehouse GitHub stock update command", () => {
  const parsed = parseStockUpdateCommand(command);

  assert.equal(parsed.sku, "V80L-CHINA");
  assert.equal(parsed.operation, "add");
  assert.deepEqual(
    parsed.allocations.map((item) => ({ warehouseId: item.warehouseId, quantity: item.quantity })),
    [
      { warehouseId: 491662, quantity: 100 },
      { warehouseId: 491661, quantity: 10 },
    ]
  );
});

test("parses Thai subtract stock command with SKU label", () => {
  const parsed = parseStockUpdateCommand(
    "\u0e25\u0e14\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 SKU V80L-CHINA \u0e17\u0e35\u0e48\u0e04\u0e25\u0e31\u0e07\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c \u0e08\u0e33\u0e19\u0e27\u0e19 1 \u0e2d\u0e31\u0e19 \u0e41\u0e25\u0e30\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08 \u0e08\u0e33\u0e19\u0e27\u0e19 1 \u0e2d\u0e31\u0e19"
  );

  assert.equal(parsed.sku, "V80L-CHINA");
  assert.equal(parsed.operation, "subtract");
  assert.deepEqual(
    parsed.allocations.map((item) => ({ warehouseId: item.warehouseId, quantity: item.quantity })),
    [
      { warehouseId: 491662, quantity: 1 },
      { warehouseId: 491661, quantity: 1 },
    ]
  );
});

test("assistant creates a GitHub stock update action from the same command", () => {
  const context = buildAssistantContext({ rows: [], summary: {} }, { expenses: [] }, { now: "2026-06-26T00:00:00.000Z" });
  const result = runRuleAssistant(command, context);

  assert.match(result.reply, /V80L-CHINA/);
  assert.equal(result.actions[0].type, "stockUpdate");
  assert.equal(result.actions[0].payload.sku, "V80L-CHINA");
  assert.equal(result.actions[0].payload.allocations.length, 2);
});

test("applies stock update to selected GitHub warehouses only", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-stock-"));
  const file = path.join(tempDir, "stock.json");
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        exportedAt: "",
        source: "test",
        syncDate: "",
        rowCount: 2,
        uniqueSkuCount: 1,
        duplicateSkus: [],
        warehouses: [
          { id: 491661, name: "\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08", rowCount: 1 },
          { id: 491662, name: "\u0e04\u0e25\u0e31\u0e07 \u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c", rowCount: 1 },
        ],
        rows: [
          { sku: "V80L-CHINA", name: "Foam Tank", quantity: 0, available: 0, warehouseId: 491661, warehouseName: "\u0e04\u0e25\u0e31\u0e07 \u0e0b.\u0e40\u0e08\u0e23\u0e34\u0e0d\u0e01\u0e34\u0e08" },
          { sku: "V80L-CHINA", name: "Foam Tank", quantity: 0, available: 0, warehouseId: 491662, warehouseName: "\u0e04\u0e25\u0e31\u0e07 \u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c" },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  const result = applyGithubStockUpdate(file, parseStockUpdateCommand(command), {
    now: "2026-06-26T10:00:00.000Z",
  });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(result.allocations.find((item) => item.warehouseId === 491662).afterQuantity, 100);
  assert.equal(result.allocations.find((item) => item.warehouseId === 491661).afterQuantity, 10);
  assert.equal(saved.rows.find((item) => item.warehouseId === 491662).quantity, 100);
  assert.equal(saved.rows.find((item) => item.warehouseId === 491661).available, 10);
  assert.equal(saved.exportedAt, "2026-06-26T10:00:00.000Z");
});
