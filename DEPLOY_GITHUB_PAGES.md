# Deploy to GitHub Pages

This dashboard can be published as a static website with GitHub Pages.

## What Works Online

- Everyone can open the latest published dashboard from the GitHub Pages URL.
- Search, sorting, product detail modal, print, and CSV export work in the browser.
- The online site uses the latest `dist` snapshot committed to GitHub.

## Important Limitation

GitHub Pages is static hosting. It cannot run the local Sync API, browser sessions, Packhai token, FlowAccount login, Shopee Seller export, or Lazada Seller export.

Use this operating model:

1. Run Sync on the main local machine.
2. Rebuild the dashboard.
3. Commit and push the updated `dist` files to GitHub.
4. GitHub Actions publishes the updated online report.

## GitHub Setup

1. Create a GitHub repository, for example `packhai-inventory-dashboard`.
2. Add this project folder to the repository.
3. In the repository, open `Settings` > `Pages`.
4. Under `Build and deployment`, set `Source` to `GitHub Actions`.
5. Push to the `main` branch.
6. Open the `Actions` tab and wait for `Deploy inventory dashboard to GitHub Pages` to finish.

The website URL will look like:

```text
https://<github-user-or-org>.github.io/packhai-inventory-dashboard/
```

## Files That Must Be Published

- `dist/index.html`
- `dist/inventory-valuation-data.json`
- `dist/packhai-inventory-valuation.csv`
- `.github/workflows/pages.yml`

Do not publish `.packhai-token.local`, browser profile folders, or server logs.
