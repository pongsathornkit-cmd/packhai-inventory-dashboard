const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("sync smoke script validates health, readiness, and optional sync without printing secrets", () => {
  const source = readRepoFile("scripts/smoke-sync-server.cjs");
  const packageJson = JSON.parse(readRepoFile("package.json"));

  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/sync\/status/);
  assert.match(source, /\/api\/sync\/\$\{args\.sync\}/);
  assert.match(source, /missingConfig/);
  assert.match(source, /Sync server is online but not ready/);
  assert.doesNotMatch(source, /PACKHAI_AUTH_TOKEN|STORAGE_STATE_B64|GITHUB_TOKEN/);
  assert.equal(packageJson.scripts["sync:smoke"], "node scripts/smoke-sync-server.cjs");
});
