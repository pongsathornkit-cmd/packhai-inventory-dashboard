const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(projectRoot, "src", "index.template.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(projectRoot, "src", "styles.css"), "utf8");

function sidebarNav() {
  const start = template.indexOf('<nav class="sidebar-nav">');
  const end = template.indexOf("</nav>", start);
  assert.ok(start >= 0, "sidebar nav should exist");
  assert.ok(end > start, "sidebar nav should close");
  return template.slice(start, end);
}

test("inventory table is exposed as a dedicated left-menu route", () => {
  const navBlock = sidebarNav();
  assert.match(navBlock, /href="#inventory-table"/);
  assert.doesNotMatch(navBlock, /href="#inventory-detail"/);
  assert.match(template, /<section class="table-section" id="inventory-detail"/);
});

test("executive summary and valuation are not shown in the left menu", () => {
  const navBlock = sidebarNav();
  assert.doesNotMatch(navBlock, /href="#executive"/);
  assert.doesNotMatch(navBlock, /href="#valuation"/);
  assert.match(template, /id="executive"/);
  assert.match(template, /id="valuation"/);
  assert.doesNotMatch(cssSource, /\.sidebar-nav a\[href="#executive"\]/);
  assert.doesNotMatch(cssSource, /\.sidebar-nav a\[href="#valuation"\]/);
});

test("methodology and manual sync controls are not shown in the sidebar", () => {
  const navBlock = sidebarNav();
  assert.doesNotMatch(navBlock, /href="#methodology"/);
  assert.doesNotMatch(template, /class="sidebar-sync"/);
  assert.doesNotMatch(template, /id="syncAll"/);
  assert.doesNotMatch(template, /id="syncPackhai"/);
  assert.doesNotMatch(template, /id="syncFlowaccount"/);
  assert.doesNotMatch(template, /id="syncSeller"/);
  assert.doesNotMatch(cssSource, /\.sidebar-nav a\[href="#methodology"\]/);
  assert.doesNotMatch(cssSource, /\.sidebar-sync/);
});

test("inventory table route hides the dashboard shell content and keeps the legacy hash as an alias", () => {
  assert.match(appSource, /function isInventoryTableRoute\(\)/);
  assert.match(appSource, /route === "inventory-table" \|\| route === "inventory-detail"/);
  assert.match(appSource, /body\.classList\.toggle\("inventory-table-route", inventoryTableRoute\)/);
  assert.match(appSource, /inventoryTableRoute \? "#inventory-table" : routeHash/);
  assert.match(appSource, /if \(inventoryTableRoute\)/);

  assert.match(cssSource, /body\.inventory-table-route \.report-header/);
  assert.match(cssSource, /body\.inventory-table-route main > section:not\(#inventory-detail\)/);
  assert.match(cssSource, /body\.inventory-table-route #inventory-detail/);
});
