const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { seedCloudStorage } = require("../scripts/seed-cloud-storage.cjs");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "packhai-seed-storage-"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("cloud storage seed does not overwrite existing synced stock files", () => {
  const root = makeTempDir();
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  writeJson(path.join(source, "packhai_stock.json"), { exportedAt: "2026-07-03T01:00:00.000Z", rows: [{ sku: "OLD" }] });
  writeJson(path.join(target, "packhai_stock.json"), { exportedAt: "2026-07-03T02:00:00.000Z", rows: [{ sku: "LIVE" }] });

  seedCloudStorage({ sourceDataDir: source, targetDataDir: target, log: () => {} });

  assert.equal(readJson(path.join(target, "packhai_stock.json")).rows[0].sku, "LIVE");
});

test("cloud storage seed refreshes Alibaba snapshot when repository data is newer", () => {
  const root = makeTempDir();
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  writeJson(path.join(source, "alibaba_purchase_orders.json"), {
    exportedAt: "2026-07-03T06:41:22.168Z",
    capturedRowCount: 64,
    orders: [{ orderNo: "27296729001038359" }],
  });
  writeJson(path.join(target, "alibaba_purchase_orders.json"), {
    exportedAt: "",
    orders: [],
  });

  seedCloudStorage({ sourceDataDir: source, targetDataDir: target, log: () => {} });

  assert.equal(readJson(path.join(target, "alibaba_purchase_orders.json")).capturedRowCount, 64);
});

test("cloud storage seed keeps a newer Alibaba snapshot already on cloud storage", () => {
  const root = makeTempDir();
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  writeJson(path.join(source, "alibaba_purchase_orders.json"), {
    exportedAt: "2026-07-03T06:41:22.168Z",
    capturedRowCount: 64,
    orders: [{ orderNo: "OLD" }],
  });
  writeJson(path.join(target, "alibaba_purchase_orders.json"), {
    exportedAt: "2026-07-03T07:00:00.000Z",
    capturedRowCount: 65,
    orders: [{ orderNo: "NEWER" }],
  });

  seedCloudStorage({ sourceDataDir: source, targetDataDir: target, log: () => {} });

  assert.equal(readJson(path.join(target, "alibaba_purchase_orders.json")).orders[0].orderNo, "NEWER");
});
