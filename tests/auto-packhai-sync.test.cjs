const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  createAutoSyncSettings,
  createSellerPriceAutoSyncSettings,
  createSellerPaymentsAutoSyncSettings,
  publicAutoSyncState,
  withHourlyCloudAutoSyncEnv,
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

test("auto seller price sync refreshes Shopee and Lazada product prices continuously", () => {
  const settings = createSellerPriceAutoSyncSettings({
    SELLER_PRICES_AUTO_SYNC: "1",
    SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES: "1",
    SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS: "45",
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.type, "seller-prices");
  assert.equal(settings.intervalMs, 5 * 60 * 1000);
  assert.equal(settings.startDelayMs, 45 * 1000);
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

test("Render keeps the web service in web-only mode by default", () => {
  const renderSource = fs.readFileSync(path.join(projectRoot, "render.yaml"), "utf8");

  assert.match(renderSource, /key:\s*HOURLY_CLOUD_AUTO_SYNC\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*SYNC_PUBLISH_SUPABASE\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*PACKHAI_AUTO_SYNC\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*PACKHAI_AUTO_SYNC_INTERVAL_MINUTES\s*\n\s*value:\s*"60"/);
  assert.match(renderSource, /key:\s*PACKHAI_AUTO_SYNC_START_DELAY_SECONDS\s*\n\s*value:\s*"60"/);
  assert.match(renderSource, /key:\s*SELLER_PAYMENTS_AUTO_SYNC\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES\s*\n\s*value:\s*"60"/);
  assert.match(renderSource, /key:\s*SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS\s*\n\s*value:\s*"180"/);
  assert.match(renderSource, /key:\s*SELLER_PRICES_AUTO_SYNC\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES\s*\n\s*value:\s*"60"/);
  assert.match(renderSource, /key:\s*SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS\s*\n\s*value:\s*"300"/);
  assert.match(renderSource, /key:\s*SELLER_COMPARE_DIR\s*\n\s*value:\s*\/app\/storage\/data\/seller_compare/);
  assert.match(renderSource, /key:\s*SELLER_ORDER_PAYMENT_MAX_NEW\s*\n\s*value:\s*"0"/);
  assert.match(renderSource, /key:\s*AUTO_SYNC_BUSY_RETRY_SECONDS\s*\n\s*value:\s*"120"/);
  assert.match(renderSource, /key:\s*AUTO_SYNC_SECONDARY_JOBS\s*\n\s*value:\s*"0"/);
});

test("Render runtime disables heavy automatic sync jobs unless explicitly re-enabled", () => {
  const env = withHourlyCloudAutoSyncEnv({
    RENDER_GIT_COMMIT: "abc123",
    AUTO_SYNC_SECONDARY_JOBS: "1",
    PACKHAI_AUTO_SYNC: "1",
    PACKHAI_AUTO_SYNC_INTERVAL_MINUTES: "15",
    PACKHAI_AUTO_SYNC_START_DELAY_SECONDS: "300",
    SELLER_PAYMENTS_AUTO_SYNC: "1",
    SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES: "15",
    SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS: "60",
    SELLER_PRICES_AUTO_SYNC: "1",
    SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES: "15",
    SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS: "60",
  });

  assert.equal(env.AUTO_SYNC_SECONDARY_JOBS, "0");
  assert.equal(env.PACKHAI_AUTO_SYNC, "0");
  assert.equal(env.PACKHAI_AUTO_SYNC_INTERVAL_MINUTES, "60");
  assert.equal(env.PACKHAI_AUTO_SYNC_START_DELAY_SECONDS, "60");
  assert.equal(env.SELLER_PAYMENTS_AUTO_SYNC, "0");
  assert.equal(env.SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES, "60");
  assert.equal(env.SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS, "180");
  assert.equal(env.SELLER_ORDER_PAYMENT_MAX_NEW, "0");
  assert.equal(env.SELLER_PAYMENTS_TIMEOUT_MS, "21600000");
  assert.equal(env.SELLER_PRICES_AUTO_SYNC, "0");
  assert.equal(env.SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES, "60");
  assert.equal(env.SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS, "300");
});

test("sync server prioritizes seller price auto sync and exposes paused secondary jobs", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");

  assert.match(serverSource, /createAutoSyncSettings/);
  assert.match(serverSource, /createSellerPriceAutoSyncSettings/);
  assert.match(serverSource, /createSellerPaymentsAutoSyncSettings/);
  assert.match(serverSource, /withHourlyCloudAutoSyncEnv\(process\.env\)/);
  assert.match(serverSource, /publicAutoSyncState/);
  assert.match(serverSource, /function\s+scheduleNextAutoSync/);
  assert.match(serverSource, /function\s+runAutoSync/);
  assert.match(serverSource, /runSync\(job\.settings\.type\)/);
  assert.match(serverSource, /autoSync:\s*publicScheduledAutoSyncState\(autoSyncSettings,\s*autoSyncState,\s*secondaryAutoSyncJobsScheduled\)/);
  assert.match(serverSource, /autoSyncJobs:\s*\{/);
  assert.match(serverSource, /sellerPrices:\s*publicAutoSyncState\(sellerPriceAutoSyncSettings,\s*sellerPriceAutoSyncState\)/);
  assert.match(serverSource, /sellerPayments:\s*publicScheduledAutoSyncState\(/);
  assert.ok(
    serverSource.indexOf('key: "sellerPrices"') < serverSource.indexOf('key: "packhai"'),
    "seller price refresh must get startup priority when auto-sync timers overlap"
  );
  assert.match(serverSource, /type\s*===\s*"seller-prices"/);
  assert.match(serverSource, /\["packhai",\s*"flowaccount",\s*"seller",\s*"seller-prices",\s*"seller-payments",\s*"all"\]/);
  assert.match(serverSource, /scheduleNextAutoSync\(job,\s*job\.settings\.startDelayMs\)/);
  assert.match(serverSource, /AUTO_SYNC_BUSY_RETRY_SECONDS/);
  assert.match(serverSource, /scheduleNextAutoSync\(job,\s*autoSyncBusyRetryMs\)/);
  assert.match(serverSource, /AUTO_SYNC_SECONDARY_JOBS/);
  assert.match(serverSource, /secondaryAutoSyncJobsScheduled/);
});

test("auto seller price sync does not run platform payment collection import", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");
  const branch = serverSource.match(/else if \(type === "seller-prices"\) \{([\s\S]*?)\n    \} else if \(type === "seller"\)/);

  assert.ok(branch, "seller-prices branch should be separate from manual seller sync");
  assert.match(branch[1], /runShopee\(\)/);
  assert.match(branch[1], /runLazada\(\)/);
  assert.doesNotMatch(branch[1], /runSellerPayments\(\)/);
});

test("platform payment sync uses long-running live progress and process tree timeout handling", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");
  const paymentsSource = fs.readFileSync(path.join(projectRoot, "scripts", "export-seller-order-payments.cjs"), "utf8");

  assert.match(serverSource, /SELLER_PAYMENTS_TIMEOUT_MS/);
  assert.match(serverSource, /6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(serverSource, /Math\.max\(resolved,\s*defaultMs\)/);
  assert.match(serverSource, /sellerPaymentsTimeoutMs:\s*commandTimeoutMs\("Sync Seller order payments"\)/);
  assert.match(serverSource, /appCommit:\s*process\.env\.RENDER_GIT_COMMIT/);
  assert.match(serverSource, /function\s+killChildTree/);
  assert.match(serverSource, /process\.kill\(-child\.pid/);
  assert.match(serverSource, /trackLiveStep/);
  assert.match(serverSource, /syncState\.steps\.includes\(step\)/);
  assert.match(paymentsSource, /SELLER_ORDER_PAYMENT_PROGRESS_EVERY/);
  assert.match(paymentsSource, /seller-payment-progress/);
  assert.match(paymentsSource, /seller-payment-targets/);
  assert.match(paymentsSource, /seller-payment-checkpoint/);
  assert.match(paymentsSource, /LAZADA_ORDER_PAYMENT_EMPTY_ABORT_AFTER/);
  assert.match(paymentsSource, /seller-payment-platform-skip/);
  assert.match(paymentsSource, /writePaymentOutput/);
});

test("platform payment export preserves item-level amounts for SKU allocation", () => {
  const paymentsSource = fs.readFileSync(path.join(projectRoot, "scripts", "export-seller-order-payments.cjs"), "utf8");

  assert.match(paymentsSource, /lineAmount/);
  assert.match(paymentsSource, /shopeeItemLineAmount/);
  assert.match(paymentsSource, /lazadaItemLineAmount/);
  assert.match(paymentsSource, /recordNeedsItemAmountRefresh/);
  assert.match(paymentsSource, /needsItemAmountRefresh/);
});

test("dashboard renders Packhai and platform payment auto sync status from the sync API response", () => {
  const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");

  assert.match(appSource, /function\s+autoSyncStatusText/);
  assert.match(appSource, /status\.autoSync/);
  assert.match(appSource, /status\.autoSyncJobs/);
  assert.match(appSource, /Auto Sync Packhai/);
  assert.match(appSource, /autoSyncStatusText\(jobs\.sellerPrices,\s*"Auto Sync/);
  assert.match(appSource, /Auto Sync ยอดเก็บเงิน Platform/);
});
