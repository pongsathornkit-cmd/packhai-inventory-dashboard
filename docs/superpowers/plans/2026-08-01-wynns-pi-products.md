# Wynn's PI 20260731 Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add every line from `PI 20260731 Pongsathorn CHAISANGUANJIRAKUL.pdf` to the PLAIN product catalog so all 97 Wynn's SKUs can be selected in purchase order `PLAIN-20260731-03` with the correct quantities and USD costs.

**Architecture:** Keep a structured, audited PI snapshot in `data/wynns_pi_20260731.json`, then use a deterministic importer to merge those items into the existing `data/plain_design_products.json` seed without changing existing P525 records. The existing Plain Design server will load the expanded seed and preserve live purchase-order state; after deployment, the browser UI will add each imported SKU and its PI quantity to the existing draft PO.

**Tech Stack:** Node.js CommonJS, Node test runner, JSON seed data, existing Plain Design browser UI, Render deployment from GitHub.

## Global Constraints

- Source document: `C:\Users\theki\Downloads\PI 20260731 Pongsathorn CHAISANGUANJIRAKUL.pdf`.
- Expected PI reconciliation: 97 unique SKUs, 6,957 pieces, RMB 83,750.41, USD 12,425.91.
- The PDF leaves `shipping fee` and `Total` blank; shipping must remain explicitly unknown, never guessed or presented as zero actual freight.
- Preserve all 23 existing P525 products and all live purchase orders.
- Keep existing uncommitted work in the main checkout untouched.

---

### Task 1: Add a failing PI reconciliation test

**Files:**
- Create: `tests/plain-design-wynns-pi-products.test.cjs`
- Read: `data/plain_design_products.json`
- Planned create: `data/wynns_pi_20260731.json`

**Interfaces:**
- Consumes: the production Plain Design seed JSON.
- Produces: a regression contract for the PI source, mapped seed records, and runtime normalization.

- [x] **Step 1: Write the failing test**

```js
test("Wynn's PI source reconciles all item and invoice totals", () => {
  assert.equal(fs.existsSync(piSourcePath), true, "PI source snapshot must exist");
  const pi = readJson(piSourcePath);
  assert.equal(pi.items.length, 97);
  assert.equal(new Set(pi.items.map((item) => item.sku)).size, 97);
  assert.equal(sum(pi.items, "quantity"), 6957);
  assert.equal(money(sum(pi.items, "amountRmb")), 83750.41);
  assert.equal(money(sum(pi.items, "amountUsd")), 12425.91);
  assert.equal(pi.shippingFeeRmb, null);
  assert.equal(pi.shippingFeeUsd, null);
});

test("Plain Design seed contains every Wynn's PI product without replacing P525 products", () => {
  const seed = readJson(seedPath);
  const imported = seed.products.filter((product) => product.sourceDocument === "PI 20260731");
  assert.equal(seed.products.filter((product) => product.sku.startsWith("P525-")).length, 23);
  assert.equal(imported.length, 97);
  assert.deepEqual(
    imported.find((product) => product.sku === "W0586"),
    expectW0586
  );
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/plain-design-wynns-pi-products.test.cjs`

Expected: FAIL because `data/wynns_pi_20260731.json` and the 97 seed records do not exist.

### Task 2: Create the audited PI snapshot and deterministic importer

**Files:**
- Create: `data/wynns_pi_20260731.json`
- Create: `scripts/import-wynns-pi-products.cjs`
- Modify: `data/plain_design_products.json`

**Interfaces:**
- Consumes: `data/wynns_pi_20260731.json` with `sku`, `description`, `unitsPerCarton`, `quantity`, `unitCostRmb`, `amountRmb`, `unitCostUsd`, and `amountUsd`.
- Produces: `mergeWynnsPiProducts(seed, pi)` and a generated seed containing category `wynns_tools`.

- [x] **Step 1: Extract all 97 PDF table rows into the structured JSON snapshot**

The root object records supplier, contact, customer, document date, both blank shipping fields as `null`, and the 97 table rows. Reconcile the literal totals before importing.

- [x] **Step 2: Implement the minimal merge**

```js
function toPlainProduct(item) {
  return {
    sku: item.sku,
    name: item.description.replace(/^\([^)]*\)\s*/, ""),
    category: "wynns_tools",
    ktwPrice: 0,
    orderQuantity: item.quantity,
    purchaseUnitCostUsd: item.unitCostUsd,
    purchaseUnitCostRmb: item.unitCostRmb,
    supplierAmountUsd: item.amountUsd,
    supplierAmountRmb: item.amountRmb,
    unitsPerCarton: item.unitsPerCarton,
    sourceDocument: "PI 20260731",
    sourceImageUrl: "",
    sourceUrl: "",
    status: "waiting_ai_images",
    notes: `PI 20260731 | ${item.unitsPerCarton} pcs/ctn | shipping fee not stated`,
  };
}
```

Merge by normalized SKU, replacing only records whose `sourceDocument` is `PI 20260731`, append the `wynns_tools` category once, and leave all other records byte-for-byte equivalent after JSON formatting.

- [x] **Step 3: Run the importer**

Run: `node scripts/import-wynns-pi-products.cjs`

Expected: reports `97 Wynn's PI products merged; 120 total products`.

- [x] **Step 4: Run the focused test**

Run: `node --test tests/plain-design-wynns-pi-products.test.cjs`

Expected: PASS for source reconciliation and seed mapping; runtime metadata assertion may still fail until Task 3.

### Task 3: Preserve supplier metadata in runtime product state

**Files:**
- Modify: `scripts/plain-design-core.cjs`
- Modify: `tests/plain-design-wynns-pi-products.test.cjs`

**Interfaces:**
- Consumes: imported product metadata from the seed.
- Produces: runtime product records carrying `sourceDocument`, `unitsPerCarton`, `purchaseUnitCostRmb`, `supplierAmountRmb`, and `supplierAmountUsd`.

- [x] **Step 1: Verify the runtime assertion fails for missing metadata**

Run: `node --test tests/plain-design-wynns-pi-products.test.cjs`

Expected: FAIL because `buildPlainDesignInitialState` currently drops supplier-only fields.

- [x] **Step 2: Add the minimal normalized fields to `buildPlainDesignInitialState`**

Use `numberValue` for quantities and costs and `String(...).trim()` for the source document. Do not change freight calculations or invent dimensions/weights.

- [x] **Step 3: Re-run the focused test**

Run: `node --test tests/plain-design-wynns-pi-products.test.cjs`

Expected: PASS.

### Task 4: Verify, build, and commit the isolated implementation

**Files:**
- Generated for verification only: `dist/plain-design/index.html`
- Verify: all modified files in this plan.

**Interfaces:**
- Consumes: tested source, importer, seed, and core.
- Produces: a deployable source/data commit on `feat/wynns-pi-20260731-products`; Render rebuilds `dist/` at startup.

- [x] **Step 1: Run the complete test suite**

Run: `node --test tests/*.test.cjs`

Expected: 0 failures.

- [x] **Step 2: Build the dashboard**

Run: `node scripts/build-dashboard.cjs`

Expected: exit code 0.

- [x] **Step 3: Verify generated product totals**

Run a Node check that loads the seed and initial state and asserts 120 total products, 97 PI products, 6,957 PI pieces, and USD 12,425.91.

- [x] **Step 4: Commit only the plan-scoped files**

```bash
git add docs/superpowers/plans/2026-08-01-wynns-pi-products.md \
  data/wynns_pi_20260731.json data/plain_design_products.json \
  scripts/import-wynns-pi-products.cjs scripts/plain-design-core.cjs \
  tests/plain-design-wynns-pi-products.test.cjs
git commit -m "feat: add Wynn's PI products to Plain Design"
```

### Task 5: Publish and populate the live draft PO

**Files:**
- No additional repository files expected.
- Live destination: `https://packhai-inventory-dashboard.onrender.com/plain-design/#purchase-order`.

**Interfaces:**
- Consumes: verified branch commit and live draft PO `PLAIN-20260731-03`.
- Produces: deployed product catalog and 97 PO lines with PI quantities.

- [ ] **Step 1: Integrate the scoped commit into `main` without staging unrelated dirty files**

Cherry-pick only the feature commit from the isolated worktree.

- [ ] **Step 2: Push `main` and wait for Render deployment**

Verify the live products page shows 120 products and category Wynn's Tools.

- [ ] **Step 3: Add all PI lines to `PLAIN-20260731-03` through the live purchase-order UI**

For each SKU, select the exact option, enter its PI `quantity`, click `+ เพิ่มรายการสินค้า`, and verify the resulting line before moving on.

- [ ] **Step 4: Verify the live PO**

Confirm 97 Wynn's lines, total quantity 6,957, supplier `Wynn's tools`, document date `2026-07-31`, and product cost USD 12,425.91 before exchange conversion. Report freight as unavailable because the PI contains no shipping amount, dimensions, or weights.
