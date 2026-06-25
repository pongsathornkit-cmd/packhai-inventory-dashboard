# Packhai Inventory Valuation Dashboard

Static executive dashboard for Packhai warehouse stock valuation.

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

Use GitHub Pages to publish the dashboard online from the `dist` folder.

See `DEPLOY_GITHUB_PAGES.md` for setup steps.

Important: the GitHub Pages version is a read-only report snapshot. Sync must still run on the main local machine because Packhai, FlowAccount, Shopee Seller, and Lazada Seller sync need private tokens and logged-in browser sessions.
