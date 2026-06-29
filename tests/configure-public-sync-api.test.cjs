const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("configure-public-sync-api wires a live backend URL into the static dashboard", () => {
  const source = readRepoFile("scripts/configure-public-sync-api.cjs");
  const packageJson = JSON.parse(readRepoFile("package.json"));

  assert.match(source, /normalizePublicSyncApiBase/);
  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/sync\/status/);
  assert.match(source, /--require-ready/);
  assert.match(source, /Missing:/);
  assert.match(source, /\.sync-api-base\.local/);
  assert.match(source, /build-dashboard\.cjs/);
  assert.match(source, /publish-supabase-app\.cjs/);
  assert.equal(packageJson.scripts["sync:configure-api"], "node scripts/configure-public-sync-api.cjs");
});
