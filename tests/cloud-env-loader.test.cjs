const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  candidateEnvFiles,
  candidateSealedEnvFiles,
  loadCloudEnv,
  parseEnvFile,
} = require("../scripts/cloud-env-loader.cjs");
const { writeSealedFile } = require("../scripts/sealed-env-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("cloud env parser reads plain env files without exposing secret values", () => {
  const parsed = parseEnvFile([
    "# comment",
    "PACKHAI_AUTH_TOKEN=token-value",
    "PUBLIC_SYNC_API_BASE=https://packhai-sync.example.com",
    "QUOTED=\"hello\"",
    "",
  ].join("\n"));

  assert.equal(parsed.PACKHAI_AUTH_TOKEN, "token-value");
  assert.equal(parsed.PUBLIC_SYNC_API_BASE, "https://packhai-sync.example.com");
  assert.equal(parsed.QUOTED, "hello");
});

test("cloud env loader uses explicit secret file and does not overwrite existing env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packhai-cloud-env-"));
  const file = path.join(dir, "cloud-sync.env");
  fs.writeFileSync(file, "PACKHAI_AUTH_TOKEN=from-file\nPUBLIC_SYNC_API_BASE=https://sync.example.com\n", "utf8");

  const previousFile = process.env.PACKHAI_CLOUD_ENV_FILE;
  const previousToken = process.env.PACKHAI_AUTH_TOKEN;
  const previousBase = process.env.PUBLIC_SYNC_API_BASE;
  try {
    process.env.PACKHAI_CLOUD_ENV_FILE = file;
    process.env.PACKHAI_AUTH_TOKEN = "already-set";
    delete process.env.PUBLIC_SYNC_API_BASE;

    const loaded = loadCloudEnv();
    assert.equal(process.env.PACKHAI_AUTH_TOKEN, "already-set");
    assert.equal(process.env.PUBLIC_SYNC_API_BASE, "https://sync.example.com");
    assert.ok(loaded.some((item) => item.file === file && item.keys.includes("PUBLIC_SYNC_API_BASE")));
    assert.ok(candidateEnvFiles().includes(path.resolve(file)));
  } finally {
    if (previousFile == null) delete process.env.PACKHAI_CLOUD_ENV_FILE;
    else process.env.PACKHAI_CLOUD_ENV_FILE = previousFile;
    if (previousToken == null) delete process.env.PACKHAI_AUTH_TOKEN;
    else process.env.PACKHAI_AUTH_TOKEN = previousToken;
    if (previousBase == null) delete process.env.PUBLIC_SYNC_API_BASE;
    else process.env.PUBLIC_SYNC_API_BASE = previousBase;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cloud env loader lets plain secret files refresh browser storage states", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packhai-cloud-env-auth-"));
  const file = path.join(dir, "cloud-sync.env");
  fs.writeFileSync(
    file,
    [
      "PACKHAI_AUTH_TOKEN=from-file",
      "SHOPEE_STORAGE_STATE_B64=fresh-shopee",
      "LAZADA_STORAGE_STATE_B64=fresh-lazada",
      "FLOWACCOUNT_STORAGE_STATE_B64=fresh-flowaccount",
      "",
    ].join("\n"),
    "utf8"
  );

  const previousFile = process.env.PACKHAI_CLOUD_ENV_FILE;
  const previousToken = process.env.PACKHAI_AUTH_TOKEN;
  const previousShopee = process.env.SHOPEE_STORAGE_STATE_B64;
  const previousLazada = process.env.LAZADA_STORAGE_STATE_B64;
  const previousFlowaccount = process.env.FLOWACCOUNT_STORAGE_STATE_B64;
  try {
    process.env.PACKHAI_CLOUD_ENV_FILE = file;
    process.env.PACKHAI_AUTH_TOKEN = "already-set";
    process.env.SHOPEE_STORAGE_STATE_B64 = "old-shopee";
    process.env.LAZADA_STORAGE_STATE_B64 = "old-lazada";
    process.env.FLOWACCOUNT_STORAGE_STATE_B64 = "old-flowaccount";

    const loaded = loadCloudEnv();
    assert.equal(process.env.PACKHAI_AUTH_TOKEN, "already-set");
    assert.equal(process.env.SHOPEE_STORAGE_STATE_B64, "fresh-shopee");
    assert.equal(process.env.LAZADA_STORAGE_STATE_B64, "fresh-lazada");
    assert.equal(process.env.FLOWACCOUNT_STORAGE_STATE_B64, "fresh-flowaccount");
    assert.ok(loaded.some((item) => item.file === file && item.keys.includes("LAZADA_STORAGE_STATE_B64")));
  } finally {
    if (previousFile == null) delete process.env.PACKHAI_CLOUD_ENV_FILE;
    else process.env.PACKHAI_CLOUD_ENV_FILE = previousFile;
    if (previousToken == null) delete process.env.PACKHAI_AUTH_TOKEN;
    else process.env.PACKHAI_AUTH_TOKEN = previousToken;
    if (previousShopee == null) delete process.env.SHOPEE_STORAGE_STATE_B64;
    else process.env.SHOPEE_STORAGE_STATE_B64 = previousShopee;
    if (previousLazada == null) delete process.env.LAZADA_STORAGE_STATE_B64;
    else process.env.LAZADA_STORAGE_STATE_B64 = previousLazada;
    if (previousFlowaccount == null) delete process.env.FLOWACCOUNT_STORAGE_STATE_B64;
    else process.env.FLOWACCOUNT_STORAGE_STATE_B64 = previousFlowaccount;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cloud env loader can override stale seller auth from a sealed env file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packhai-cloud-env-sealed-"));
  const plainFile = path.join(dir, "cloud-sync.env");
  const sealedFile = path.join(dir, "cloud-sync.env.enc");
  fs.writeFileSync(
    plainFile,
    [
      "PACKHAI_AUTH_TOKEN=from-plain",
      "SHOPEE_STORAGE_STATE_B64=old-shopee",
      "LAZADA_STORAGE_STATE_B64=old-lazada",
      "",
    ].join("\n"),
    "utf8"
  );
  writeSealedFile(
    sealedFile,
    "SHOPEE_STORAGE_STATE_B64=fresh-shopee\nLAZADA_STORAGE_STATE_B64=fresh-lazada\n",
    "sealed-pass"
  );

  const previousPlainFile = process.env.PACKHAI_CLOUD_ENV_FILE;
  const previousSealedFile = process.env.PACKHAI_SEALED_ENV_FILE;
  const previousPassphrase = process.env.PACKHAI_SYNC_ENV_PASSPHRASE;
  const previousToken = process.env.PACKHAI_AUTH_TOKEN;
  const previousShopee = process.env.SHOPEE_STORAGE_STATE_B64;
  const previousLazada = process.env.LAZADA_STORAGE_STATE_B64;
  try {
    process.env.PACKHAI_CLOUD_ENV_FILE = plainFile;
    process.env.PACKHAI_SEALED_ENV_FILE = sealedFile;
    process.env.PACKHAI_SYNC_ENV_PASSPHRASE = "sealed-pass";
    delete process.env.PACKHAI_AUTH_TOKEN;
    delete process.env.SHOPEE_STORAGE_STATE_B64;
    delete process.env.LAZADA_STORAGE_STATE_B64;

    const loaded = loadCloudEnv();
    assert.equal(process.env.PACKHAI_AUTH_TOKEN, "from-plain");
    assert.equal(process.env.SHOPEE_STORAGE_STATE_B64, "fresh-shopee");
    assert.equal(process.env.LAZADA_STORAGE_STATE_B64, "fresh-lazada");
    assert.ok(loaded.some((item) => item.file === sealedFile && item.sealed));
    assert.ok(candidateSealedEnvFiles().includes(path.resolve(sealedFile)));
  } finally {
    if (previousPlainFile == null) delete process.env.PACKHAI_CLOUD_ENV_FILE;
    else process.env.PACKHAI_CLOUD_ENV_FILE = previousPlainFile;
    if (previousSealedFile == null) delete process.env.PACKHAI_SEALED_ENV_FILE;
    else process.env.PACKHAI_SEALED_ENV_FILE = previousSealedFile;
    if (previousPassphrase == null) delete process.env.PACKHAI_SYNC_ENV_PASSPHRASE;
    else process.env.PACKHAI_SYNC_ENV_PASSPHRASE = previousPassphrase;
    if (previousToken == null) delete process.env.PACKHAI_AUTH_TOKEN;
    else process.env.PACKHAI_AUTH_TOKEN = previousToken;
    if (previousShopee == null) delete process.env.SHOPEE_STORAGE_STATE_B64;
    else process.env.SHOPEE_STORAGE_STATE_B64 = previousShopee;
    if (previousLazada == null) delete process.env.LAZADA_STORAGE_STATE_B64;
    else process.env.LAZADA_STORAGE_STATE_B64 = previousLazada;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("package start boots through cloud sync startup script", () => {
  const packageJson = JSON.parse(readRepoFile("package.json"));
  const startSource = readRepoFile("scripts/start-cloud-sync.cjs");
  const renderConfig = readRepoFile("render.yaml");

  assert.equal(packageJson.scripts.start, "node scripts/start-cloud-sync.cjs");
  assert.match(startSource, /loadCloudEnv/);
  assert.match(startSource, /materializeStorageStateEnv/);
  assert.ok(
    startSource.indexOf("materializeStorageStateEnv") < startSource.indexOf('runScript("seed-cloud-storage.cjs")'),
    "startup must remove large storage-state env vars before spawning child scripts"
  );
  assert.match(startSource, /seed-cloud-storage\.cjs/);
  assert.match(startSource, /build-dashboard\.cjs/);
  assert.match(startSource, /serve-dashboard\.cjs/);
  assert.match(renderConfig, /key:\s*PACKHAI_SYNC_ENV_PASSPHRASE\s*\n\s*sync:\s*false/);
});
