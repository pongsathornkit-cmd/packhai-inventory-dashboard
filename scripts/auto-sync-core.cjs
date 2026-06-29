const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;

function enabledValue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createAutoSyncSettings(env = process.env) {
  const intervalMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    positiveNumber(env.PACKHAI_AUTO_SYNC_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
  );
  const startDelaySeconds = positiveNumber(env.PACKHAI_AUTO_SYNC_START_DELAY_SECONDS, 60);

  return {
    enabled: enabledValue(env.PACKHAI_AUTO_SYNC),
    type: "packhai",
    intervalMs: Math.round(intervalMinutes * 60 * 1000),
    intervalMinutes,
    startDelayMs: Math.round(startDelaySeconds * 1000),
  };
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
  publicAutoSyncState,
};
