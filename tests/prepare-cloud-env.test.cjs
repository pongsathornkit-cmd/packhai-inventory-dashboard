const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("prepare-cloud-env writes the env keys required by the cloud sync server", () => {
  const source = readRepoFile("scripts/prepare-cloud-env.cjs");
  const packageJson = JSON.parse(readRepoFile("package.json"));

  assert.match(source, /PACKHAI_AUTH_TOKEN/);
  assert.match(source, /GITHUB_TOKEN/);
  assert.match(source, /SHOPEE_STORAGE_STATE_B64/);
  assert.match(source, /LAZADA_STORAGE_STATE_B64/);
  assert.match(source, /FLOWACCOUNT_STORAGE_STATE_B64/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_WRITE_KEY/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /PUBLIC_SUPABASE_URL/);
  assert.match(source, /PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /SELLER_COMPARE_DIR/);
  assert.match(source, /\/app\/storage\/data\/seller_compare/);
  assert.match(source, /--github-token-from-gh/);
  assert.match(source, /gh",\s*\["auth",\s*"token"\]/);
  assert.match(source, /githubTokenSource/);
  assert.match(source, /missingRequired/);
  assert.match(source, /normalizePublicSyncApiBase/);
  assert.match(source, /publicSyncApiBasePresent/);
  assert.match(source, /supabaseUrlPresent/);
  assert.match(source, /\.tmp.*cloud-sync\.env/s);
  assert.equal(packageJson.scripts["cloud:env"], "node scripts/prepare-cloud-env.cjs");
});
