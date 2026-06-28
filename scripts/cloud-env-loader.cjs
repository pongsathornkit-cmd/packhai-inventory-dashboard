const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const defaultRenderSecretFile = "/etc/secrets/cloud-sync.env";

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

function loadCloudEnv() {
  const loaded = [];
  for (const file of candidateEnvFiles()) {
    if (!fs.existsSync(file)) continue;
    const values = parseEnvFile(fs.readFileSync(file, "utf8"));
    const keys = [];
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key]) continue;
      process.env[key] = value;
      keys.push(key);
    }
    loaded.push({ file, keys });
  }
  return loaded;
}

module.exports = {
  candidateEnvFiles,
  loadCloudEnv,
  parseEnvFile,
};
