const fs = require("fs");
const path = require("path");

const { readSealedFile } = require("./sealed-env-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const defaultRenderSecretFile = "/etc/secrets/cloud-sync.env";
const defaultRenderSealedSecretFile = "/etc/secrets/cloud-sync.env.enc";
const defaultRepositorySealedEnvFile = path.join(projectRoot, "sync-secrets", "cloud-sync.env.enc");

function parseEnvFile(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function candidateEnvFiles() {
  const files = [];
  if (process.env.PACKHAI_CLOUD_ENV_FILE) files.push(path.resolve(process.env.PACKHAI_CLOUD_ENV_FILE));
  files.push(defaultRenderSecretFile);
  if (/^(1|true|yes)$/i.test(String(process.env.LOAD_LOCAL_CLOUD_ENV || ""))) {
    files.push(path.join(projectRoot, ".tmp", "cloud-sync.env"));
  }
  return [...new Set(files)];
}

function candidateSealedEnvFiles() {
  if (process.env.PACKHAI_SEALED_ENV_FILE) return [path.resolve(process.env.PACKHAI_SEALED_ENV_FILE)];
  const files = [];
  files.push(defaultRenderSealedSecretFile);
  files.push(defaultRepositorySealedEnvFile);
  return [...new Set(files)];
}

function isBrowserStorageStateKey(key) {
  return /^(SHOPEE|LAZADA|FLOWACCOUNT)_STORAGE_STATE_(B64|JSON|FILE)$/.test(String(key || ""));
}

function shouldOverrideFromPlainCloudFile(key, value) {
  return isBrowserStorageStateKey(key) && String(value || "").trim().length > 0;
}

function applyEnvValues(values, { file, sealed = false, override = false, overridePredicate = null } = {}) {
  const keys = [];
  for (const [key, value] of Object.entries(values)) {
    const shouldOverride = override || (typeof overridePredicate === "function" && overridePredicate(key, value));
    if (!shouldOverride && process.env[key]) continue;
    process.env[key] = value;
    keys.push(key);
  }
  return keys.length ? { file, keys, sealed } : null;
}

function loadCloudEnv() {
  const loaded = [];
  for (const file of candidateEnvFiles()) {
    if (!fs.existsSync(file)) continue;
    const values = parseEnvFile(fs.readFileSync(file, "utf8"));
    const applied = applyEnvValues(values, { file, overridePredicate: shouldOverrideFromPlainCloudFile });
    if (applied) loaded.push(applied);
  }

  const passphrase = String(process.env.PACKHAI_SYNC_ENV_PASSPHRASE || "").trim();
  if (passphrase) {
    for (const file of candidateSealedEnvFiles()) {
      if (!fs.existsSync(file)) continue;
      const values = parseEnvFile(readSealedFile(file, passphrase));
      const applied = applyEnvValues(values, { file, sealed: true, override: true });
      if (applied) loaded.push(applied);
    }
  }
  return loaded;
}

module.exports = {
  candidateEnvFiles,
  candidateSealedEnvFiles,
  isBrowserStorageStateKey,
  loadCloudEnv,
  parseEnvFile,
};
