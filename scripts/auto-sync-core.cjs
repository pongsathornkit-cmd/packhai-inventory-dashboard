const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_SELLER_PRICES_START_DELAY_SECONDS = 60;
const DEFAULT_SELLER_PAYMENTS_START_DELAY_SECONDS = 240;
const MIN_INTERVAL_MINUTES = 5;

function enabledValue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createTypedAutoSyncSettings(env = process.env, options = {}) {
  const intervalKey = options.intervalKey || "PACKHAI_AUTO_SYNC_INTERVAL_MINUTES";
  const enabledKey = options.enabledKey || "PACKHAI_AUTO_SYNC";
  const startDelayKey = options.startDelayKey || "PACKHAI_AUTO_SYNC_START_DELAY_SECONDS";
  const intervalMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    positiveNumber(env[intervalKey], options.defaultIntervalMinutes || DEFAULT_INTERVAL_MINUTES)
  );
  const startDelaySeconds = positiveNumber(env[startDelayKey], options.defaultStartDelaySeconds ?? 60);

  return {
    enabled: enabledValue(env[enabledKey]),
    type: options.type || "packhai",
    intervalMs: Math.round(intervalMinutes * 60 * 1000),
    intervalMinutes,
    startDelayMs: Math.round(startDelaySeconds * 1000),
  };
}

function createAutoSyncSettings(env = process.env) {
  return createTypedAutoSyncSettings(env, { type: "packhai" });
}

function createSellerPriceAutoSyncSettings(env = process.env) {
  return createTypedAutoSyncSettings(env, {
    type: "seller-prices",
    enabledKey: "SELLER_PRICES_AUTO_SYNC",
    intervalKey: "SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES",
    startDelayKey: "SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS",
    defaultStartDelaySeconds: DEFAULT_SELLER_PRICES_START_DELAY_SECONDS,
  });
}

function createSellerPaymentsAutoSyncSettings(env = process.env) {
  return createTypedAutoSyncSettings(env, {
    type: "seller-payments",
    enabledKey: "SELLER_PAYMENTS_AUTO_SYNC",
    intervalKey: "SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES",
    startDelayKey: "SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS",
    defaultStartDelaySeconds: DEFAULT_SELLER_PAYMENTS_START_DELAY_SECONDS,
  });
}

function publicAutoSyncState(settings, state = {}) {
  return {
    enabled: Boolean(settings?.enabled),
    type: settings?.type || "packhai",
    intervalMs: Number(settings?.intervalMs || 0),
    intervalMinutes: Number(settings?.intervalMinutes || 0),
    nextRunAt: state.nextRunAt || null,
    lastRunAt: state.lastRunAt || null,
    lastFinishedAt: state.lastFinishedAt || null,
    lastSkippedAt: state.lastSkippedAt || null,
    lastSkipReason: state.lastSkipReason || "",
    lastOk: typeof state.lastOk === "boolean" ? state.lastOk : null,
  };
}

module.exports = {
  createAutoSyncSettings,
  createSellerPriceAutoSyncSettings,
  createSellerPaymentsAutoSyncSettings,
  publicAutoSyncState,
};
