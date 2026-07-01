const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_SELLER_PRICES_START_DELAY_SECONDS = 60;
const DEFAULT_SELLER_PAYMENTS_START_DELAY_SECONDS = 240;
const MIN_INTERVAL_MINUTES = 5;
const HOURLY_CLOUD_AUTO_SYNC_OVERRIDES = {
  AUTO_SYNC_BUSY_RETRY_SECONDS: "120",
  AUTO_SYNC_SECONDARY_JOBS: "1",
  PACKHAI_AUTO_SYNC: "1",
  PACKHAI_AUTO_SYNC_INTERVAL_MINUTES: "60",
  PACKHAI_AUTO_SYNC_START_DELAY_SECONDS: "60",
  SELLER_PAYMENTS_AUTO_SYNC: "1",
  SELLER_PAYMENTS_AUTO_SYNC_INTERVAL_MINUTES: "60",
  SELLER_PAYMENTS_AUTO_SYNC_START_DELAY_SECONDS: "180",
  SELLER_ORDER_PAYMENT_MAX_NEW: "0",
  SELLER_ORDER_PAYMENT_PROGRESS_EVERY: "25",
  SELLER_PAYMENTS_TIMEOUT_MS: "21600000",
  SELLER_PRICES_AUTO_SYNC: "1",
  SELLER_PRICES_AUTO_SYNC_INTERVAL_MINUTES: "60",
  SELLER_PRICES_AUTO_SYNC_START_DELAY_SECONDS: "300",
};

function enabledValue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function explicitBoolean(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^(1|true|yes|on)$/i.test(text)) return true;
  if (/^(0|false|no|off)$/i.test(text)) return false;
  return null;
}

function shouldUseHourlyCloudAutoSync(env = process.env) {
  const explicit = explicitBoolean(env.HOURLY_CLOUD_AUTO_SYNC);
  if (explicit !== null) return explicit;
  return Boolean(env.RENDER_GIT_COMMIT || env.RENDER_GIT_COMMIT_SHA || env.RENDER_EXTERNAL_URL || env.RENDER_SERVICE_ID);
}

function withHourlyCloudAutoSyncEnv(env = process.env) {
  const source = { ...(env || {}) };
  if (!shouldUseHourlyCloudAutoSync(source)) return source;
  return { ...source, ...HOURLY_CLOUD_AUTO_SYNC_OVERRIDES };
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
  withHourlyCloudAutoSyncEnv,
  publicAutoSyncState,
};
