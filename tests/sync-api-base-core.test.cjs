const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePublicSyncApiBase } = require("../scripts/sync-api-base-core.cjs");

test("public sync API base ignores ephemeral tunnel URLs read from local files", () => {
  assert.equal(
    normalizePublicSyncApiBase("https://ourselves-dress-move-babies.trycloudflare.com", { source: "local-file" }),
    ""
  );
});

test("public sync API base keeps explicit environment URLs and stable HTTPS URLs", () => {
  assert.equal(
    normalizePublicSyncApiBase("https://ourselves-dress-move-babies.trycloudflare.com/", { source: "env" }),
    "https://ourselves-dress-move-babies.trycloudflare.com"
  );
  assert.equal(
    normalizePublicSyncApiBase("https://packhai-sync.example.com/", { source: "local-file" }),
    "https://packhai-sync.example.com"
  );
});

test("public sync API base rejects invalid or insecure public values", () => {
  assert.equal(normalizePublicSyncApiBase("not-a-url", { source: "env" }), "");
  assert.equal(normalizePublicSyncApiBase("http://example.com", { source: "env" }), "");
});
