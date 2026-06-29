# Supabase Inventory Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Website Stock balances and stock adjustment transactions from GitHub JSON files to Supabase, while keeping the existing dashboard usable during the migration.

**Architecture:** Supabase Postgres becomes the source of truth for website-managed warehouses. The existing static dashboard still builds from local JSON for Packhai/seller data, but a new Supabase sync layer can pull website stock balances/transactions into the build and the server can write adjustments to Supabase. Public GitHub Pages remains read-only until a Supabase anon/publishable key or backend URL is configured.

**Tech Stack:** Node.js CommonJS scripts, Supabase Postgres, existing static HTML/CSS/JS dashboard, built-in `node:test`.

---

### Task 1: Supabase Schema

**Files:**
- Create: `supabase/migrations/20260629_inventory_core.sql`

- [ ] **Step 1: Write schema migration**

Create tables:
- `public.products` with `sku` primary key, product name, barcode, image/url metadata.
- `public.warehouses` with numeric source id and Thai display name.
- `public.stock_balances` keyed by `(sku, warehouse_id)`.
- `public.stock_transactions` keyed by text transaction id.
- `public.sync_jobs` for future Packhai/Shopee/Lazada sync runs.

Add indexes:
- `stock_balances_warehouse_quantity_idx` on `(warehouse_id, quantity desc)`.
- `stock_transactions_sku_created_idx` on `(sku, created_at desc)`.
- `stock_transactions_warehouse_created_idx` on `(warehouse_id, created_at desc)`.

Add RLS enabled for all public tables. Keep anonymous writes disabled by default. Add read policies for `anon`/`authenticated` only after a public key is intentionally configured.

- [ ] **Step 2: Apply migration**

Run Supabase migration against project `fabfhzcsppniuwtdwvfg` with migration name `inventory_core`.

- [ ] **Step 3: Verify schema**

Run SQL:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('products','warehouses','stock_balances','stock_transactions','sync_jobs')
order by table_name;
```

Expected: all five table names.

### Task 2: Supabase Stock Core

**Files:**
- Create: `scripts/supabase-stock-core.cjs`
- Create: `tests/supabase-stock-core.test.cjs`

- [ ] **Step 1: Write failing tests**

Tests must assert:
- `buildInventorySeedSql(snapshot)` emits upserts for the two selected website warehouses and current stock rows.
- `buildStockAdjustmentSql(payload)` emits one transaction insert and one stock balance upsert for a set operation.
- `mapSupabaseWebsiteSnapshot(rows, transactions)` returns the same JSON shape expected by `build-dashboard.cjs`.

Run:

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\supabase-stock-core.test.cjs
```

Expected: fails because module does not exist.

- [ ] **Step 2: Implement core helpers**

Implement pure helpers only; no network calls in this file.

- [ ] **Step 3: Verify tests pass**

Run the same test command. Expected: pass.

### Task 3: Seed Current Website Stock

**Files:**
- Create: `scripts/seed-supabase-inventory.cjs`

- [ ] **Step 1: Create seed command**

The command reads `data/flowaccount_stock_selected_warehouses.json`, builds SQL with `buildInventorySeedSql`, and prints it with `--print` for review. It should not print secrets.

- [ ] **Step 2: Apply seed through Supabase connector**

Execute the generated SQL against project `fabfhzcsppniuwtdwvfg`.

- [ ] **Step 3: Verify row counts**

Run SQL:

```sql
select
  (select count(*) from public.products) as products,
  (select count(*) from public.warehouses) as warehouses,
  (select count(*) from public.stock_balances) as stock_balances,
  (select count(*) from public.stock_transactions) as stock_transactions;
```

Expected: at least 13 stock balances and 2 warehouses.

### Task 4: Server Endpoint

**Files:**
- Modify: `scripts/serve-dashboard.cjs`
- Modify: `scripts/assistant-core.cjs` only if endpoint naming leaks into assistant actions.
- Test: `tests/smoke-sync-server.test.cjs`

- [ ] **Step 1: Add compatibility endpoint**

Keep `/api/github-stock/adjust` working for old UI, but route it to Supabase when `SUPABASE_PROJECT_ID` or `SUPABASE_REST_URL` is configured. Add canonical `/api/supabase-stock/adjust`.

- [ ] **Step 2: Keep fallback behavior**

If Supabase is not configured, retain current JSON-file behavior so local/offline builds still work.

- [ ] **Step 3: Verify no secrets leak**

Run existing smoke test and ensure page source does not include service role/GitHub tokens.

### Task 5: Dashboard Build Integration

**Files:**
- Modify: `scripts/build-dashboard.cjs`
- Create: `scripts/export-supabase-website-stock.cjs`
- Test: `tests/website-stock-transactions.test.cjs`

- [ ] **Step 1: Add importer**

`export-supabase-website-stock.cjs` reads Supabase output JSON from `data/supabase_website_stock.json` when present and writes `data/flowaccount_stock_selected_warehouses.json` in the existing shape for compatibility.

- [ ] **Step 2: Build uses Supabase snapshot first**

`build-dashboard.cjs` should prefer `data/supabase_website_stock.json` for Website Stock when present, otherwise use existing JSON.

- [ ] **Step 3: Verify dashboard data**

Run build and verify `dist/inventory-valuation-data.json` contains `websiteStockTransactions`.

### Task 6: Frontend UX Improvement

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `src/index.template.html` only if config injection is needed.

- [ ] **Step 1: Make stock adjustment state clearer**

Change modal text from “GitHub Stock” language to “Supabase Stock Transaction”. If no online write config exists, show clear setup status, not a confusing “Sync API URL” message.

- [ ] **Step 2: Improve table density**

Keep grouped SKU rows compact with fixed-height warehouse chips and a short transaction button area. No nested cards inside table cells.

- [ ] **Step 3: Verify interaction locally**

Start local server, open the dashboard, click a website-stock `ปรับ` button, submit a safe no-op set to the same quantity if backend is local, and verify a transaction response or clear setup warning.

### Task 7: Publish

**Files:**
- Generated: `dist/index.html`
- Generated: `dist/inventory-valuation-data.json`

- [ ] **Step 1: Run full tests**

Run:

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

- [ ] **Step 2: Build dashboard**

Run:

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts\build-dashboard.cjs
```

- [ ] **Step 3: Commit and publish**

Stage only related files. Do not stage unrelated dirty seller export data.

```powershell
git add supabase scripts tests src docs dist
git commit -m "Add Supabase inventory core"
git push origin main
```

---

## Scope Notes

This phase deliberately moves Website Stock first. Expenses, seller payment collection, Packhai movements, and AI commands should be migrated next using the same Supabase schema and endpoint pattern after the stock transaction path is verified in production.
