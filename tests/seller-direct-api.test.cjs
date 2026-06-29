const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

test("seller direct API helpers build browser-like cookie headers", () => {
  const {
    cookieHeaderForHost,
    cookieValueForHost,
  } = require("../scripts/seller-direct-api.cjs");
  const state = {
    cookies: [
      { name: "root", value: "1", domain: ".lazada.co.th", path: "/" },
      { name: "seller", value: "2", domain: "sellercenter.lazada.co.th", path: "/" },
      { name: "api", value: "3", domain: "acs-m.lazada.co.th", path: "/h5" },
      { name: "wrong-path", value: "4", domain: "acs-m.lazada.co.th", path: "/other" },
      { name: "wrong-domain", value: "5", domain: "example.com", path: "/" },
    ],
  };

  assert.equal(
    cookieHeaderForHost(state, "acs-m.lazada.co.th", "/h5/demo/1.0/"),
    "root=1; api=3"
  );
  assert.equal(cookieValueForHost(state, "seller", "sellercenter.lazada.co.th"), "2");
});

test("seller direct API helpers sign Lazada mtop URLs", () => {
  const { createLazadaMtopUrl } = require("../scripts/seller-direct-api.cjs");
  const request = createLazadaMtopUrl({
    token: "token",
    appKey: "app",
    timestamp: "12345",
    data: JSON.stringify({ ok: true }),
  });
  const expectedSign = crypto.createHash("md5").update('token&12345&app&{"ok":true}').digest("hex");

  assert.equal(request.url.hostname, "acs-m.lazada.co.th");
  assert.equal(request.url.searchParams.get("sign"), expectedSign);
  assert.equal(request.url.searchParams.get("appKey"), "app");
});

test("seller price export scripts prefer direct API before browser fallback", () => {
  const shopee = fs.readFileSync(path.join(projectRoot, "scripts", "export-shopee-products.cjs"), "utf8");
  const lazada = fs.readFileSync(path.join(projectRoot, "scripts", "export-lazada-products.cjs"), "utf8");
  const server = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");

  assert.match(shopee, /fetchShopeeSellerData/);
  assert.match(lazada, /fetchLazadaSellerData/);
  assert.doesNotMatch(shopee, /require\("\.\/playwright-runtime\.cjs"\)/);
  assert.doesNotMatch(lazada, /const\s+\{[^}]*chromium[^}]*\}\s*=\s*require\("\.\/playwright-runtime\.cjs"\)/);
  assert.doesNotMatch(server, /const\s+\{[^}]*chromium[^}]*\}\s*=\s*require\("\.\/playwright-runtime\.cjs"\)/);
  assert.doesNotMatch(shopee, /raw:\s*product/);
  assert.doesNotMatch(lazada, /raw:\s*(row|sku)/);
  assert.match(shopee, /models:\s*Array\.isArray\(product\.model_list\)/);
  assert.match(lazada, /specialPrice:\s*firstPositive/);
  assert.ok(
    shopee.indexOf("fetchShopeeSellerData") < shopee.indexOf("openAuthContext"),
    "Shopee direct API should be attempted before opening Chromium"
  );
  assert.ok(
    lazada.indexOf("fetchLazadaSellerData") < lazada.indexOf("openAuthContext"),
    "Lazada direct API should be attempted before opening Chromium"
  );
});
