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

test("stock adjustment server exposes Supabase endpoint without leaking service credentials", () => {
  const serverSource = readRepoFile("scripts/serve-dashboard.cjs");
  const appSource = readRepoFile("src/app.js");
  const templateSource = readRepoFile("src/index.template.html");

  assert.match(serverSource, /\/api\/supabase-stock\/adjust/);
  assert.match(serverSource, /SUPABASE_ANON_KEY/);
  assert.match(serverSource, /SUPABASE_WRITE_KEY/);
  assert.doesNotMatch(appSource, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(templateSource, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("sync server stores browser auth states behind an admin key", () => {
  const serverSource = readRepoFile("scripts/serve-dashboard.cjs");

  assert.match(serverSource, /\/api\/admin\/auth-state/);
  assert.match(serverSource, /x-admin-key/);
  assert.match(serverSource, /readJsonBody\(req,\s*5\s*\*\s*1024\s*\*\s*1024\)/);
  assert.match(serverSource, /writeStorageStateFile/);
  assert.doesNotMatch(serverSource, /storageState:\s*state/);
});
