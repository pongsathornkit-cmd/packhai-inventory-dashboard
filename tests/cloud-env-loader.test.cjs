const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { candidateEnvFiles, loadCloudEnv, parseEnvFile } = require("../scripts/cloud-env-loader.cjs");

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

test("package start boots through cloud sync startup script", () => {
  const packageJson = JSON.parse(readRepoFile("package.json"));
  const startSource = readRepoFile("scripts/start-cloud-sync.cjs");

  assert.equal(packageJson.scripts.start, "node scripts/start-cloud-sync.cjs");
  assert.match(startSource, /loadCloudEnv/);
  assert.match(startSource, /seed-cloud-storage\.cjs/);
  assert.match(startSource, /build-dashboard\.cjs/);
  assert.match(startSource, /serve-dashboard\.cjs/);
});
