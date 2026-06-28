const fs = require("fs");
const path = require("path");

const { chromium, chromiumOptions } = require("./playwright-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const authStateDir = process.env.PACKHAI_AUTH_STATE_DIR
  ? path.resolve(process.env.PACKHAI_AUTH_STATE_DIR)
  : path.join(projectRoot, "storage-states");

function envName(kind, suffix) {
  return `${String(kind || "").trim().toUpperCase()}_STORAGE_STATE_${suffix}`;
}

function defaultStorageStateFile(kind) {
  return path.join(authStateDir, `${String(kind || "").trim().toLowerCase()}.json`);
}

function readInlineStorageState(kind) {
  const json = String(process.env[envName(kind, "JSON")] || "").trim();
  if (json) return JSON.parse(json);

  const b64 = String(process.env[envName(kind, "B64")] || "").trim();
  if (b64) return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

  return null;
}

function resolveStorageStateFile(kind, explicitFile) {
  const envFile = String(process.env[envName(kind, "FILE")] || "").trim();
  return path.resolve(envFile || explicitFile || defaultStorageStateFile(kind));
}

function loadStorageState(kind, explicitFile) {
  const inline = readInlineStorageState(kind);
  if (inline) return { state: inline, file: resolveStorageStateFile(kind, explicitFile), source: "env" };

  const file = resolveStorageStateFile(kind, explicitFile);
  if (!fs.existsSync(file)) return { state: null, file, source: "" };
  return { state: JSON.parse(fs.readFileSync(file, "utf8")), file, source: "file" };
}

async function openAuthContext(options) {
  const {
    kind,
    persistentDir,
    storageStateFile,
    headless,
    viewport = { width: 1365, height: 900 },
    locale = "th-TH",
    args = [],
  } = options;
  const loaded = loadStorageState(kind, storageStateFile);
  const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", ...args];

  if (loaded.state) {
    const browser = await chromium.launch({
      ...chromiumOptions(),
      headless,
      args: launchArgs,
    });
    const context = await browser.newContext({
      storageState: loaded.state,
      viewport,
      locale,
    });
    const page = await context.newPage();
    return {
      mode: `storage-state:${loaded.source}:${loaded.file}`,
      context,
      page,
      close: async () => {
        fs.mkdirSync(path.dirname(loaded.file), { recursive: true });
        await context.storageState({ path: loaded.file }).catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  }

  const context = await chromium.launchPersistentContext(persistentDir, {
    ...chromiumOptions(),
    headless,
    viewport,
    locale,
    args: launchArgs,
  });
  const page = context.pages()[0] || (await context.newPage());
  return {
    mode: `profile:${persistentDir}`,
    context,
    page,
    close: async () => {
      fs.mkdirSync(path.dirname(loaded.file), { recursive: true });
      await context.storageState({ path: loaded.file }).catch(() => {});
      await context.close().catch(() => {});
    },
  };
}

module.exports = {
  defaultStorageStateFile,
  loadStorageState,
  openAuthContext,
  resolveStorageStateFile,
};
