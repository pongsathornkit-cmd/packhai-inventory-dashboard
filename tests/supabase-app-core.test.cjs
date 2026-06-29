const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Supabase app core builds snapshot seed SQL without GitHub runtime dependencies", () => {
  const { buildAppSnapshotSeedSql } = require("../scripts/supabase-app-core.cjs");

  const sql = buildAppSnapshotSeedSql({
    dashboard: { summary: { totalInventoryValue: 100 }, rows: [{ sku: "A", quantity: 1 }] },
    stockMovements: { rows: [{ stockShopId: "P1", sku: "A" }] },
    sellerPayments: { payments: [{ platform: "Shopee", orderNo: "S1", collectedAmount: 99 }] },
    indexHtml: "<!doctype html><title>Packhai</title>",
    expenses: [
      {
        id: "exp_1",
        expenseNo: "EXP-202606-0001",
        paymentDate: "2026-06-29",
        recipientName: "Supplier",
        recipientType: "company",
        pndType: "PND53",
        category: "Service",
        amountInput: 100,
        subtotal: 100,
        vatAmount: 7,
        grossAmount: 107,
        withholdingAmount: 3,
        netPayable: 104,
        status: "posted",
      },
    ],
  });

  assert.match(sql, /insert into public\.app_snapshots/);
  assert.match(sql, /dashboard_current/);
  assert.match(sql, /stock_movements_current/);
  assert.match(sql, /seller_payments_current/);
  assert.match(sql, /index_html/);
  assert.match(sql, /insert into public\.expense_records/);
  assert.doesNotMatch(sql, /github\.com|GitHub Pages|workflow_dispatch/i);
});

test("Supabase app migration exposes public dashboard and expense RPCs", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "migrations", "20260629_supabase_app_hub.sql"),
    "utf8"
  );

  assert.match(migration, /create table if not exists public\.app_snapshots/);
  assert.match(migration, /create table if not exists public\.expense_records/);
  assert.match(migration, /public\.dashboard_state/);
  assert.match(migration, /public\.packhai_stock_movements/);
  assert.match(migration, /public\.stock_movements_for_stock_shop_ids/);
  assert.match(migration, /public\.list_expenses/);
  assert.match(migration, /public\.create_expense/);
  assert.match(migration, /public\.cancel_expense/);
  assert.match(migration, /grant execute on function public\.dashboard_state\(\) to anon/);
});

test("Supabase Edge Function serves dashboard HTML from app_snapshots", () => {
  const functionSource = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "functions", "packhai-dashboard", "index.ts"),
    "utf8"
  );

  assert.match(functionSource, /app_snapshots/);
  assert.match(functionSource, /index_html/);
  assert.match(functionSource, /text\/html/);
  assert.doesNotMatch(functionSource, /github\.io|github\.com/i);
});

test("frontend uses Supabase app hub RPCs for dashboard and expenses", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.match(appSource, /dashboard_state/);
  assert.match(appSource, /list_expenses/);
  assert.match(appSource, /create_expense/);
  assert.match(appSource, /cancel_expense/);
  assert.match(appSource, /stock_movements_for_stock_shop_ids/);
  assert.match(appSource, /supabaseAppHubConfigured/);
});

test("sync job publishes rebuilt app snapshots to Supabase instead of GitHub Pages", () => {
  const syncJobSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-sync-job.cjs"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "serve-dashboard.cjs"), "utf8");
  const publishSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish-supabase-app.cjs"), "utf8");

  assert.match(syncJobSource, /publish-supabase-app\.cjs/);
  assert.match(serverSource, /function\s+runPublishSupabase/);
  assert.match(serverSource, /publish-supabase-app\.cjs/);
  assert.match(publishSource, /packhai_stock_movements/);
  assert.match(publishSource, /function\s+sellerPaymentsSnapshotPayload/);
  assert.match(publishSource, /ordersMeta/);
  assert.match(publishSource, /omittedFromSupabaseSnapshot/);
  assert.match(publishSource, /sellerPaymentsSnapshotPayload\(sellerPayments\)/);
  assert.doesNotMatch(syncJobSource, /publish-github-pages\.cjs/);
});
