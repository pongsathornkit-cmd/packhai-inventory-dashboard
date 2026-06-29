# Packhai Inventory Valuation Dashboard

Executive dashboard for Packhai warehouse stock valuation.

## Build

```powershell
& "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\scripts\build-dashboard.cjs
```

## Website

```powershell
& "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\scripts\serve-dashboard.cjs
```

Then open `http://127.0.0.1:8123/`.

The website includes sync buttons:

- `Sync ทั้งหมด`: Packhai stock, Shopee Seller, Lazada Seller, then rebuilds the dashboard. If `PACKHAI_AUTH_TOKEN` is missing, Packhai is skipped with a warning and Seller sync still runs.
- `คลัง Packhai`: requires `PACKHAI_AUTH_TOKEN` in the server environment.
- `ราคาขาย Seller`: refreshes Shopee and Lazada seller exports, then rebuilds the dashboard.

## Sources

- Packhai stock snapshot: `..\packhai_stock_20260622.json`
- Shopee Seller export: `..\outputs\seller_compare\shopee_products_export.json`
- Lazada Seller export: `..\outputs\seller_compare\lazada_products_export.json`
- KTW fallback source: `..\outputs\ktw_product_source\ktw_price_update_plan.json`

The generated website is `dist\index.html` and can be opened directly in a browser.

## Online Website

Use Supabase as the data/API hub and deploy `scripts/serve-dashboard.cjs` on a normal web host such as Render or a VPS.

Required cloud environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PACKHAI_AUTH_TOKEN` and seller browser sessions when cloud sync should fetch Packhai/Shopee/Lazada directly

The server rebuilds the dashboard and publishes app snapshots plus Packhai movement history to Supabase with `scripts/publish-supabase-app.cjs`. GitHub Pages and GitHub Actions are no longer part of the production runtime.
