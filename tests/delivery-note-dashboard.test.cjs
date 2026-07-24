const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(projectRoot, "src", "index.template.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(projectRoot, "src", "styles.css"), "utf8");
const serverSource = fs.readFileSync(path.join(projectRoot, "scripts", "serve-dashboard.cjs"), "utf8");
const buildSource = fs.readFileSync(path.join(projectRoot, "scripts", "build-dashboard.cjs"), "utf8");

test("dashboard exposes delivery notes as a dedicated left-menu route", () => {
  assert.match(template, /href="#delivery-notes"/);
  assert.match(template, /id="delivery-notes"/);
  assert.match(appSource, /function isDeliveryNoteRoute\(\)/);
  assert.match(appSource, /body\.classList\.toggle\("delivery-notes-route", deliveryNoteRoute\)/);
  assert.match(cssSource, /body\.delivery-notes-route main > section:not\(#delivery-notes\)/);
});

test("delivery note UI supports create, row add-remove, inspection fields, and confirm stock deduction", () => {
  assert.match(appSource, /data-delivery-new/);
  assert.match(appSource, /data-delivery-add-line/);
  assert.match(appSource, /data-delivery-remove-line/);
  assert.match(appSource, /data-delivery-line-field="previousCheck"/);
  assert.match(appSource, /data-delivery-line-field="stockCutCheck"/);
  assert.match(appSource, /data-delivery-line-field="evidenceLink"/);
  assert.match(appSource, /ยืนยันตรวจแล้ว \+ ตัด stock/);
  assert.match(appSource, /deliveryLineImage/);
  assert.match(appSource, /deliveryWarehouseStock/);
});

test("server and build pipeline include delivery note persistence", () => {
  assert.match(buildSource, /delivery_notes\.json/);
  assert.match(buildSource, /publicDeliveryNoteState/);
  assert.match(serverSource, /\/api\/delivery-notes/);
  assert.match(serverSource, /confirmDeliveryNoteWithStock/);
  assert.match(serverSource, /buildStockDeductionPayloads/);
});
