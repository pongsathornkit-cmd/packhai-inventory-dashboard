const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("sync server runs FlowAccount export instead of GitHub snapshot for FlowAccount stock", () => {
  const source = readRepoFile("scripts/serve-dashboard.cjs");

  assert.match(source, /runFlowaccount\s*=\s*\(\)\s*=>\s*\n\s*runCommand\("Sync FlowAccount stock"/);
  assert.match(source, /path\.join\(projectRoot,\s*"scripts",\s*"sync-flowaccount-stock\.cjs"\)/);
  assert.doesNotMatch(source, /pushFlowaccountSnapshotStep/);
  assert.match(source, /flowaccountSource:\s*"flowaccount-sync"/);
});

test("sync server does not append null steps when publish is skipped", () => {
  const source = readRepoFile("scripts/serve-dashboard.cjs");

  assert.match(source, /if\s*\(step\)\s*syncState\.steps\.push\(step\)/);
});

test("dashboard labels FlowAccount rows as FlowAccount, not GitHub stock", () => {
  const buildSource = readRepoFile("scripts/build-dashboard.cjs");
  const appSource = readRepoFile("src/app.js");
  const templateSource = readRepoFile("src/index.template.html");

  assert.match(buildSource, /stockSource:\s*"FlowAccount"/);
  assert.doesNotMatch(buildSource, /Packhai \+ GitHub Stock/);
  assert.doesNotMatch(buildSource, /github-snapshot/);
  assert.doesNotMatch(appSource, /GitHub Stock|คลัง GitHub/);
  assert.match(appSource, /syncFlowaccount/);
  assert.match(templateSource, /id="syncFlowaccount"/);
  assert.doesNotMatch(templateSource, /Packhai \+ GitHub Stock|คลัง GitHub/);
});
