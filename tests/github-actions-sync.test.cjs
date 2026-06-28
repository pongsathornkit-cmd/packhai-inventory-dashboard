const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  formatEnvFile,
  openText,
  parseEnvFile,
  sealText,
} = require("../scripts/sealed-env-core.cjs");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("sealed env round trips through authenticated encryption", () => {
  const plain = "PACKHAI_AUTH_TOKEN=token\nSHOPEE_STORAGE_STATE_B64=state\n";
  const sealed = sealText(plain, "test-passphrase");
  assert.equal(openText(sealed, "test-passphrase"), plain);
  assert.throws(() => openText(sealed, "wrong-passphrase"));
});

test("sealed env formatting parses normal env values", () => {
  const parsed = parseEnvFile("A=1\n# ignore\nB=hello\n");
  assert.deepEqual(parsed, { A: "1", B: "hello" });
  assert.equal(formatEnvFile(parsed), "A=1\nB=hello\n");
});

test("GitHub Actions sync workflow decrypts env and runs sync job", () => {
  const workflow = readRepoFile(".github/workflows/sync-dashboard.yml");
  const packageJson = JSON.parse(readRepoFile("package.json"));
  const sealSource = readRepoFile("scripts/seal-sync-env.cjs");

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /PACKHAI_SYNC_ENV_PASSPHRASE/);
  assert.match(workflow, /open-sealed-sync-env\.cjs/);
  assert.match(workflow, /run-sync-job\.cjs/);
  assert.match(workflow, /payment_batch_size/);
  assert.match(workflow, /SELLER_ORDER_PAYMENT_MAX_NEW:\s*\$\{\{\s*inputs\.payment_batch_size\s*\}\}/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /add-mask/);
  assert.doesNotMatch(workflow, /done < \.tmp\/github-actions-sync\.env/);
  assert.doesNotMatch(workflow, /PACKHAI_AUTH_STATE_DIR:\s*\$\{\{\s*runner\.temp/);
  assert.match(sealSource, /excludedKeys/);
  assert.match(sealSource, /GITHUB_TOKEN/);
  assert.match(sealSource, /PUBLIC_SYNC_API_BASE/);
  assert.equal(packageJson.scripts["sync:seal-env"], "node scripts/seal-sync-env.cjs");
});
