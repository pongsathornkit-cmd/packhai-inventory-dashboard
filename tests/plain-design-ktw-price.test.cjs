const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..");

function loadSyncHelpers() {
  const file = path.join(projectRoot, "scripts", "sync-plain-design-ktw-logistics.cjs");
  const source = fs.readFileSync(file, "utf8").replace(/main\(\)\.catch\([\s\S]*?\);\s*$/, "");
  const sandbox = {
    require,
    __dirname: path.join(projectRoot, "scripts"),
    console,
    fetch,
    module: { exports: {} },
    process: { env: {}, exitCode: 0 },
  };
  vm.runInNewContext(`${source}\nmodule.exports = { parseKtwSourcePrice };`, sandbox, { filename: file });
  return sandbox.module.exports;
}

test("KTW price parser prefers the visible discounted website price", () => {
  const { parseKtwSourcePrice } = loadSyncHelpers();
  const html = `
    <script>
      dataLayer.push({
        ecommerce: { items: [{ "item_id": "P525-1310", "price": 203.36 }] }
      });
    </script>
    <aside>
      <p>ราคาตั้ง : 310.00 ลด 50.0%</p>
      <p>ราคา : <strong>155.00</strong> บาท</p>
      <p>ราคาปลีกแนะนำ : 248.00</p>
    </aside>
  `;

  assert.equal(parseKtwSourcePrice(html, "P525-1310"), 155);
});

test("KTW price parser can compute a discounted website price from list price and percent", () => {
  const { parseKtwSourcePrice } = loadSyncHelpers();
  const html = `
    <script>
      dataLayer.push({
        ecommerce: { items: [{ "item_id": "P525-1310", "price": 203.36 }] }
      });
    </script>
    <aside>
      <p>ราคาตั้ง : 310.00 ลด 50.0%</p>
      <p>ราคาปลีกแนะนำ : 248.00</p>
    </aside>
  `;

  assert.equal(parseKtwSourcePrice(html, "P525-1310"), 155);
});
