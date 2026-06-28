const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePublicSyncApiBase, selectPublicSyncApiBase } = require("../scripts/sync-api-base-core.cjs");

test("public sync API base ignores ephemeral tunnel URLs read from local files", () => {
  assert.equal(
    normalizePublicSyncApiBase("https://ourselves-dress-move-babies.trycloudflare.com", { source: "local-file" }),
    ""
  );
});

test("public sync API base rejects ephemeral tunnel URLs even when passed explicitly", () => {
  assert.equal(
    normalizePublicSyncApiBase("https://ourselves-dress-move-babies.trycloudflare.com/", { source: "env" }),
    ""
  );
});

test("public sync API base keeps stable HTTPS URLs", () => {
  assert.equal(
    normalizePublicSyncApiBase("https://packhai-inventory-dashboard.onrender.com/", { source: "env" }),
    "https://packhai-inventory-dashboard.onrender.com"
  );
  assert.equal(
    normalizePublicSyncApiBase("https://packhai-inventory-dashboard.onrender.com/", { source: "local-file" }),
    "https://packhai-inventory-dashboard.onrender.com"
  );
});

test("public sync API base rejects invalid or insecure public values", () => {
  assert.equal(normalizePublicSyncApiBase("not-a-url", { source: "env" }), "");
  assert.equal(normalizePublicSyncApiBase("http://example.com", { source: "env" }), "");
  assert.equal(normalizePublicSyncApiBase("https://example-sync.invalid", { source: "env" }), "");
  assert.equal(normalizePublicSyncApiBase("https://YOUR-SYNC-SERVER", { source: "env" }), "");
});

test("public sync API base can fall back to Render external URL", () => {
  assert.equal(
    selectPublicSyncApiBase({
      publicSyncApiBase: "",
      renderExternalUrl: "https://packhai-inventory-dashboard.onrender.com/",
      localFileSyncApiBase: "https://ourselves-dress-move-babies.trycloudflare.com",
    }),
    "https://packhai-inventory-dashboard.onrender.com"
  );
});

test("explicit public sync API base wins over Render external URL", () => {
  assert.equal(
    selectPublicSyncApiBase({
      publicSyncApiBase: "https://packhai-sync.onrender.com",
      renderExternalUrl: "https://packhai-inventory-dashboard.onrender.com",
      localFileSyncApiBase: "https://local-sync.onrender.com",
    }),
    "https://packhai-sync.onrender.com"
  );
});
