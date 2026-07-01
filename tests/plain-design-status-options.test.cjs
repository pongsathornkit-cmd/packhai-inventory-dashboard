const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadPlainDesignState,
  updatePlainDesignProduct,
} = require("../scripts/plain-design-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function makePlainDesignOptions(seed, storedState = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-design-status-"));
  const seedFile = path.join(dir, "seed.json");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(seedFile, JSON.stringify(seed, null, 2));
  if (storedState) fs.writeFileSync(stateFile, JSON.stringify(storedState, null, 2));
  return {
    seedFile,
    stateFile,
    dashboardFile: path.join(dir, "dashboard.json"),
    ktwLogisticsFile: path.join(dir, "ktw-logistics.json"),
    assetDir: path.join(dir, "assets"),
  };
}

const expectedStatusOptions = [
  { id: "passed", label: "ผ่าน", tone: "green" },
  { id: "ai_done_waiting_review", label: "AIทำรูปเสร็จแล้วรอตรวจสอบ", tone: "orange" },
  { id: "needs_ai_revision", label: "ต้องการให้AIแก้รูป", tone: "blue" },
  { id: "waiting_ai_images", label: "รอรูปภาพจากAI", tone: "neutral" },
];

test("Plain Design redesign status options use the requested AI workflow labels", () => {
  const seed = JSON.parse(readRepoFile("data/plain_design_products.json"));
  const migration = readRepoFile("supabase/migrations/20260701_plain_design_hub.sql");

  assert.deepEqual(seed.statusOptions, expectedStatusOptions);
  const allowedStatusIds = new Set(expectedStatusOptions.map((item) => item.id));
  assert.ok(seed.products.every((product) => allowedStatusIds.has(product.status)));

  for (const item of expectedStatusOptions) {
    assert.match(migration, new RegExp(`'${item.id}'`));
    assert.doesNotMatch(migration, /'not_started'|'designing'|'review'|'approved'|'factory_ready'/);
  }
});

test("Plain Design state migrates legacy redesign statuses to the new AI workflow", () => {
  const seed = {
    statusOptions: expectedStatusOptions,
    categoryOptions: [],
    assetGroups: [],
    products: [
      { sku: "OLD-1", name: "Legacy waiting", status: "not_started" },
      { sku: "OLD-2", name: "Legacy review", status: "review" },
      { sku: "OLD-3", name: "Legacy approved", status: "factory_ready" },
    ],
  };
  const options = makePlainDesignOptions(seed, {
    products: [
      { sku: "OLD-1", status: "designing" },
      { sku: "OLD-2", status: "review" },
      { sku: "OLD-3", status: "approved" },
    ],
  });

  const state = loadPlainDesignState(options);

  assert.equal(state.products.find((product) => product.sku === "OLD-1").status, "waiting_ai_images");
  assert.equal(state.products.find((product) => product.sku === "OLD-2").status, "ai_done_waiting_review");
  assert.equal(state.products.find((product) => product.sku === "OLD-3").status, "passed");
});

test("Plain Design product update rejects statuses outside the requested workflow", () => {
  const options = makePlainDesignOptions({
    statusOptions: expectedStatusOptions,
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images" }],
  });

  const updated = updatePlainDesignProduct(options, { sku: "SKU-1", status: "needs_ai_revision" });
  assert.equal(updated.status, "needs_ai_revision");
  assert.throws(
    () => updatePlainDesignProduct(options, { sku: "SKU-1", status: "unknown_status" }),
    /Invalid redesign status/
  );
});

test("Plain Design status badges have room for the longer AI workflow labels", () => {
  const css = readRepoFile("src/plain-design.css");

  assert.match(css, /\.product-table th:nth-child\(9\),\s*\.product-table td:nth-child\(9\)\s*\{\s*width:\s*128px;/);
  assert.match(css, /\.product-table \.status-badge,\s*\.po-table \.status-badge\s*\{[\s\S]*?white-space:\s*normal;/);
  assert.match(css, /\.product-table \.status-badge,\s*\.po-table \.status-badge\s*\{[\s\S]*?text-overflow:\s*clip;/);
});
