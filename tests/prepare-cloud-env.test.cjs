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
  assert.match(source, /--github-token-from-gh/);
  assert.match(source, /gh",\s*\["auth",\s*"token"\]/);
  assert.match(source, /githubTokenSource/);
  assert.match(source, /missingRequired/);
  assert.match(source, /\.tmp.*cloud-sync\.env/s);
  assert.equal(packageJson.scripts["cloud:env"], "node scripts/prepare-cloud-env.cjs");
});
