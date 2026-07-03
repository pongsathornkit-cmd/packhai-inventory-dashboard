const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDataDir = path.join(projectRoot, "data");
const targetDataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : sourceDataDir;

const REPOSITORY_REFRESH_FILES = new Set(["alibaba_purchase_orders.json"]);

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function exportedAtMs(file) {
  const data = readJsonSafe(file);
  const value = data?.exportedAt || data?.capturedAt || "";
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldRefreshFromRepository(relativePath, source, target) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!REPOSITORY_REFRESH_FILES.has(normalized)) return false;
  if (!fs.existsSync(target)) return true;

  const sourceData = readJsonSafe(source);
  const targetData = readJsonSafe(target);
  const sourceRows = Number(sourceData?.capturedRowCount || sourceData?.orders?.length || 0);
  const targetRows = Number(targetData?.capturedRowCount || targetData?.orders?.length || 0);
  const sourceTime = exportedAtMs(source);
  const targetTime = exportedAtMs(target);

  if (sourceTime && sourceTime > targetTime) return true;
  return sourceRows > 0 && targetRows === 0 && sourceTime >= targetTime;
}

function copySeedFile(source, target, relativePath = "") {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copySeedFile(path.join(source, entry), path.join(target, entry), path.join(relativePath, entry));
    }
    return;
  }
  if (!fs.existsSync(target) || shouldRefreshFromRepository(relativePath, source, target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function seedCloudStorage(options = {}) {
  const source = path.resolve(options.sourceDataDir || sourceDataDir);
  const target = path.resolve(options.targetDataDir || targetDataDir);
  const log = options.log || console.log;

  if (source === target) {
    log("Cloud storage seed skipped: using repository data directory.");
    return;
  }
  copySeedFile(source, target);
  log(`Cloud storage seed checked: ${target}`);
}

function main() {
  seedCloudStorage();
}

if (require.main === module) {
  main();
}

module.exports = {
  seedCloudStorage,
  shouldRefreshFromRepository,
};
