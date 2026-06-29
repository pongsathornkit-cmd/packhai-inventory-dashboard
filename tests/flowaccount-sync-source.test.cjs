const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("sync server uses website stock snapshot instead of FlowAccount export", () => {
  const source = readRepoFile("scripts/serve-dashboard.cjs");
  const runJobSource = readRepoFile("scripts/run-sync-job.cjs");

  assert.match(source, /runWebsiteStockSnapshot\s*=\s*\(\)\s*=>\s*\n\s*runCommand\("Use Website stock snapshot"/);
  assert.match(source, /path\.join\(projectRoot,\s*"scripts",\s*"use-website-stock-snapshot\.cjs"\)/);
  assert.doesNotMatch(source, /runCommand\("Sync FlowAccount stock"/);
  assert.doesNotMatch(source, /path\.join\(projectRoot,\s*"scripts",\s*"sync-flowaccount-stock\.cjs"\)/);
  assert.match(source, /flowaccountSource:\s*"website-stock"/);
  assert.match(runJobSource, /runStep\("Use Website stock snapshot",\s*"use-website-stock-snapshot\.cjs"\)/);
  assert.doesNotMatch(runJobSource, /runStep\("Sync FlowAccount stock"/);
});

test("sync server does not append null steps when publish is skipped", () => {
  const source = readRepoFile("scripts/serve-dashboard.cjs");

  assert.match(source, /if\s*\(step\)\s*syncState\.steps\.push\(step\)/);
});

test("sync all keeps stock sync usable when seller sessions fail", () => {
  const source = readRepoFile("scripts/serve-dashboard.cjs");

  assert.doesNotMatch(source, /errors\.push\("[^"]*Seller[^"]*Shopee[^"]*Lazada[^"]*"\)/);
  assert.match(source, /warnings\.push\("[^"]*Seller[^"]*Shopee[^"]*Lazada/);
});

test("dashboard labels selected warehouse rows as Website Stock, not FlowAccount sync", () => {
  const buildSource = readRepoFile("scripts/build-dashboard.cjs");
  const appSource = readRepoFile("src/app.js");
  const templateSource = readRepoFile("src/index.template.html");

  assert.match(buildSource, /WEBSITE_STOCK_SOURCE\s*=\s*"Website Stock"/);
  assert.match(buildSource, /storage:\s*"website-stock"/);
  assert.doesNotMatch(buildSource, /Packhai \+ GitHub Stock/);
  assert.doesNotMatch(buildSource, /github-snapshot/);
  assert.doesNotMatch(buildSource, /storage:\s*"flowaccount-sync"/);
  assert.match(appSource, /Website Stock/);
  assert.match(templateSource, /Website Stock/);
  assert.match(appSource, /syncFlowaccount/);
  assert.match(templateSource, /id="syncFlowaccount"/);
});

test("dashboard exposes a dedicated sync path for platform collection payments", () => {
  const serverSource = readRepoFile("scripts/serve-dashboard.cjs");
  const appSource = readRepoFile("src/app.js");

  assert.match(serverSource, /type\s*===\s*"seller-payments"/);
  assert.match(serverSource, /pushStep\(runSellerPayments\(\)\)/);
  assert.match(serverSource, /\["packhai",\s*"flowaccount",\s*"seller",\s*"seller-payments",\s*"all"\]/);
  assert.match(appSource, /syncSellerPayments/);
  assert.match(appSource, /startSync\("seller-payments"\)/);
});

test("sidebar does not show platform collection payments as a sync menu item", () => {
  const templateSource = readRepoFile("src/index.template.html");
  const sidebarSync = templateSource.match(/<div class="sidebar-sync"[\s\S]*?<\/div>\s*<div class="sidebar-status">/)?.[0] || "";

  assert.ok(sidebarSync.includes('id="syncPackhai"'));
  assert.ok(sidebarSync.includes('id="syncSeller"'));
  assert.doesNotMatch(sidebarSync, /id="syncSellerPayments"/);
  assert.doesNotMatch(sidebarSync, /ยอดเก็บเงิน Platform/);
});

test("sync server exposes a health endpoint for cloud hosting checks", () => {
  const serverSource = readRepoFile("scripts/serve-dashboard.cjs");
  const renderSource = readRepoFile("render.yaml");

  assert.match(serverSource, /url\.pathname\s*===\s*"\/api\/health"/);
  assert.match(serverSource, /sendJson\(res,\s*200,\s*\{\s*ok:\s*true/);
  assert.match(renderSource, /healthCheckPath:\s*\/api\/health/);
});

test("sync server exposes cloud readiness without leaking secret values", () => {
  const serverSource = readRepoFile("scripts/serve-dashboard.cjs");
  const appSource = readRepoFile("src/app.js");

  assert.match(serverSource, /function\s+syncReadiness/);
  assert.match(serverSource, /shopeeAuthConfigured/);
  assert.match(serverSource, /lazadaAuthConfigured/);
  assert.doesNotMatch(serverSource, /FLOWACCOUNT_STORAGE_STATE_B64/);
  assert.match(serverSource, /ready:\s*readiness\.ready/);
  assert.doesNotMatch(serverSource, /STORAGE_STATE_B64[^,\n]*value/i);
  assert.match(appSource, /renderSyncReadiness/);
  assert.match(appSource, /getSyncStatus\(true\)/);
  assert.match(appSource, /Sync server ออนไลน์/);
});

test("online dashboard clears stale sync API URL when a remote fetch fails", () => {
  const appSource = readRepoFile("src/app.js");

  assert.match(appSource, /function\s+clearRemoteSyncApiBase/);
  assert.match(appSource, /localStorage\.removeItem\("packhaiSyncApiBase"\)/);
  assert.match(appSource, /renderSyncApiBaseFailure\(type,\s*error\)/);
});

test("online dashboard ignores saved temporary tunnel URLs and does not prompt users for sync setup", () => {
  const appSource = readRepoFile("src/app.js");

  assert.match(appSource, /function\s+isEphemeralSyncApiBase/);
  assert.match(appSource, /isEphemeralSyncApiBase\(rawEmbeddedSyncApiBase\)/);
  assert.match(appSource, /isEphemeralSyncApiBase\(rawStoredSyncApiBase\)/);
  assert.doesNotMatch(appSource, /window\.prompt/);
});

test("online dashboard shows sync setup notice when no public sync API is configured", () => {
  const appSource = readRepoFile("src/app.js");

  assert.match(appSource, /if\s*\(syncApiUnavailable\)\s*{\s*renderStaticSyncNotice\("seller-payments"\);/);
  assert.match(appSource, /supabaseAppHubConfigured/);
  assert.match(appSource, /staticSyncStatusUrl/);
  assert.match(appSource, /sync-status\.json/);
  assert.match(appSource, /loadStaticSyncStatusFile/);
  assert.match(appSource, /openStaticSyncStatus\(type\)/);
  assert.match(appSource, /loadGitHubSyncStatus\(type,\s*true\)/);
  assert.match(appSource, /data-sync-run-refresh/);
  assert.match(appSource, /data-dashboard-refresh/);
  assert.match(appSource, /Supabase Data Hub/);
  assert.match(appSource, /โหลดข้อมูลจาก Supabase/);
  assert.match(appSource, /ตรวจ snapshot/);
  assert.match(appSource, /loadSupabaseDashboardState/);
  assert.match(appSource, /scrollIntoView/);
  assert.doesNotMatch(appSource, /local sync only/);
  assert.doesNotMatch(appSource, /githubSyncWorkflowUrl/);
  assert.doesNotMatch(appSource, /https:\/\/github\.com\/[^"']*actions\/workflows/);
  assert.doesNotMatch(appSource, /Manual Sync/);
  assert.doesNotMatch(appSource, /ดู run ล่าสุด/);
  assert.doesNotMatch(appSource, /window\.open/);
});
