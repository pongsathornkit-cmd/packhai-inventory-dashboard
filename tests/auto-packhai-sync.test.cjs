const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  createAutoSyncSettings,
  createSellerPaymentsAutoSyncSettings,
  publicAutoSyncState,
} = require("../scripts/auto-sync-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

test("auto Packhai sync settings enable scheduled packhai-only sync with a safe minimum interval", () => {
  const settings = createAutoSyncSettings({
    PACKHAI_AUTO_SYNC: "1",
    PACKHAI_AUTO_SYNC_INTERVAL_MINUTES: "1",
    PACKHAI_AUTO_SYNC_START_DELAY_SECONDS: "0",
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.type, "packhai");
  assert.equal(settings.intervalMs, 5 * 60 * 1000);
  assert.equal(settings.startDelayMs, 0);
});

test("auto Packhai sync is disabled by default unless explicitly enabled", () => {
  const settings = createAutoSyncSettings({});

  assert.equal(settings.enabled, false);
  assert.equal(settings.type, "packhai");
  assert.equal(settings.intervalMs, 15 * 60 * 1000);
});

test("auto seller platform payment sync imports every missing platform order continuously", () => {
  const settings = createSellerPaymentsAutoSyncSettings({
    SELLER_PAYMENTS_AUTO_SYNC: "1",
    SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES: "1",
    SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS: "30",
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.type, "seller-payments");
  assert.equal(settings.intervalMs, 5 * 60 * 1000);
  assert.equal(settings.startDelayMs, 30 * 1000);
});

test("public auto sync state hides timer handles and exposes next run metadata", () => {
  const settings = createAutoSyncSettings({
    PACKHAI_AUTO_SYNC: "1",
    PACKHAI_AUTO_SYNC_INTERVAL_MINUTES: "20",
  });
  const state = {
    timer: { internal: true },
    nextRunAt: "2026-06-29T09:00:00.000Z",
    lastRunAt: "2026-06-29T08:45:00.000Z",
    lastOk: true,
  };

  assert.deepEqual(publicAutoSyncState(settings, state), {
    enabled: true,
    type: "packhai",
    intervalMs: 20 * 60 * 1000,
    intervalMinutes: 20,
    nextRunAt: "2026-06-29T09:00:00.000Z",
    lastRunAt: "2026-06-29T08:45:00.000Z",
    lastFinishedAt: null,
    lastSkippedAt: null,
    lastSkipReason: "",
    lastOk: true,
  });
});

test("Render enables Packhai auto sync for the cloud service", () => {
  const renderSource = fs.readFileSync(path.join(projectRoot, "render.yaml"), "utf8");

  assert.match(renderSource, /key:\s*PACKHAI_AUTO_SYNC\s*\n\s*value:\s*"1"/);
  assert.match(renderSource, /key:\s*PACKHAI_AUTO_SYNC_INTERVAL_MINUTES\s*\n\s*value:\s*"15"/);
  assert.match(renderSource, /key:\s*SELLER_PAYMENTS_AUTO_SYNC\s*\n\s*value:\s*"1"/);
  assert.match(renderSource, /key:\s*SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES\s*\n\s*value:\s*"15"/);
  assert.match(renderSource, /key:\s*SELLER_ORDER_PAYMENT_MAX_NEW\s*\n\s*value:\s*"0"/);
});

test("sync server schedules Packhai and platform payment auto sync and exposes their status", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");

  assert.match(serverSource, /createAutoSyncSettings/);
  assert.match(serverSource, /createSellerPaymentsAutoSyncSettings/);
  assert.match(serverSource, /publicAutoSyncState/);
  assert.match(serverSource, /function\s+scheduleNextAutoSync/);
  assert.match(serverSource, /function\s+runAutoSync/);
  assert.match(serverSource, /runSync\(job\.settings\.type\)/);
  assert.match(serverSource, /autoSync:\s*publicAutoSyncState\(autoSyncSettings,\s*autoSyncState\)/);
  assert.match(serverSource, /autoSyncJobs:\s*\{/);
  assert.match(serverSource, /sellerPayments:\s*publicAutoSyncState\(sellerPaymentsAutoSyncSettings,\s*sellerPaymentsAutoSyncState\)/);
  assert.match(serverSource, /scheduleNextAutoSync\(job,\s*job\.settings\.startDelayMs\)/);
});

test("platform payment sync uses long-running live progress and process tree timeout handling", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");
  const paymentsSource = fs.readFileSync(path.join(projectRoot, "scripts", "export-seller-order-payments.cjs"), "utf8");

  assert.match(serverSource, /SELLER_PAYMENTS_TIMEOUT_MS/);
  assert.match(serverSource, /90\s*\*\s*60\s*\*\s*1000/);
  assert.match(serverSource, /function\s+killChildTree/);
  assert.match(serverSource, /process\.kill\(-child\.pid/);
  assert.match(serverSource, /trackLiveStep/);
  assert.match(serverSource, /syncState\.steps\.includes\(step\)/);
  assert.match(paymentsSource, /SELLER_ORDER_PAYMENT_PROGRESS_EVERY/);
  assert.match(paymentsSource, /seller-payment-progress/);
  assert.match(paymentsSource, /seller-payment-targets/);
});

test("dashboard renders Packhai and platform payment auto sync status from the sync API response", () => {
  const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");

  assert.match(appSource, /function\s+autoSyncStatusText/);
  assert.match(appSource, /status\.autoSync/);
  assert.match(appSource, /status\.autoSyncJobs/);
  assert.match(appSource, /Auto Sync Packhai/);
  assert.match(appSource, /Auto Sync ยอดเก็บเงิน Platform/);
});
