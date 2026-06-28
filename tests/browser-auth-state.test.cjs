const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  defaultStorageStateFile,
  loadStorageState,
  resolveStorageStateFile,
} = require("../scripts/browser-auth-state.cjs");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("auth state file defaults to ignored storage-states directory", () => {
  assert.match(defaultStorageStateFile("shopee"), /storage-states[\\/]+shopee\.json$/);
});

test("auth state can be loaded from base64 environment variable", () => {
  const previous = process.env.SHOPEE_STORAGE_STATE_B64;
  try {
    process.env.SHOPEE_STORAGE_STATE_B64 = Buffer.from(JSON.stringify({ cookies: [], origins: [] }), "utf8").toString(
      "base64"
    );
    const loaded = loadStorageState("shopee");
    assert.equal(loaded.source, "env");
    assert.deepEqual(loaded.state, { cookies: [], origins: [] });
  } finally {
    if (previous == null) delete process.env.SHOPEE_STORAGE_STATE_B64;
    else process.env.SHOPEE_STORAGE_STATE_B64 = previous;
  }
});

test("auth state can be loaded from explicit file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packhai-auth-state-"));
  const file = path.join(dir, "lazada.json");
  fs.writeFileSync(file, JSON.stringify({ cookies: [{ name: "x", value: "1" }], origins: [] }), "utf8");

  const loaded = loadStorageState("lazada", file);
  assert.equal(resolveStorageStateFile("lazada", file), file);
  assert.equal(loaded.source, "file");
  assert.equal(loaded.state.cookies[0].name, "x");
});

test("seller and FlowAccount sync scripts support portable auth state", () => {
  const shopee = readRepoFile("scripts/export-shopee-products.cjs");
  const lazada = readRepoFile("scripts/export-lazada-products.cjs");
  const payments = readRepoFile("scripts/export-seller-order-payments.cjs");
  const flow = readRepoFile("scripts/sync-flowaccount-stock.cjs");

  assert.match(shopee, /openAuthContext\(\{\s*kind:\s*"shopee"/);
  assert.match(lazada, /openAuthContext\(\{\s*kind:\s*"lazada"/);
  assert.match(payments, /openAuthContext\(\{\s*kind:\s*"shopee"/);
  assert.match(payments, /openAuthContext\(\{\s*kind:\s*"lazada"/);
  assert.match(flow, /openAuthContext\(\{\s*kind:\s*"flowaccount"/);
});

test("cloud deployment config exposes portable auth state secrets", () => {
  const renderSource = readRepoFile("render.yaml");
  const dockerfile = readRepoFile("Dockerfile");
  const packageJson = JSON.parse(readRepoFile("package.json"));
  const gitignore = readRepoFile(".gitignore");

  assert.match(renderSource, /PACKHAI_AUTH_STATE_DIR/);
  assert.match(renderSource, /SHOPEE_STORAGE_STATE_B64/);
  assert.match(renderSource, /LAZADA_STORAGE_STATE_B64/);
  assert.match(renderSource, /FLOWACCOUNT_STORAGE_STATE_B64/);
  assert.match(dockerfile, /PACKHAI_AUTH_STATE_DIR=\/app\/storage\/auth-states/);
  assert.equal(packageJson.scripts["auth:export"], "node scripts/export-browser-auth-state.cjs --write-env-file .tmp/render-auth-state.env");
  assert.match(gitignore, /storage-states\//);
});
