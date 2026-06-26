# Expense Withholding Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an API-backed expense and withholding tax module to the Packhai dashboard.

**Architecture:** Put tax math, validation, storage, CSV, and document HTML in `scripts/expense-core.cjs`, backed by a JSON file in `PACKHAI_DATA_DIR`. Add HTTP routes in `scripts/serve-dashboard.cjs`, then add a new `#expenses` UI section in the static dashboard that calls the API through the existing sync API base.

**Tech Stack:** Node.js CommonJS, Node built-in test runner, existing static HTML/CSS/JS, Playwright Chromium for PDF generation.

---

### Task 1: Tax Core

**Files:**
- Create: `scripts/expense-core.cjs`
- Create: `tests/expense-core.test.cjs`

- [ ] Write failing tests for VAT/WHT math, report type mapping, numbering, validation, and CSV rendering.
- [ ] Run `node --test tests/expense-core.test.cjs` and verify the tests fail because the module is missing.
- [ ] Implement `calculateExpense`, `normalizeExpensePayload`, `createExpenseRecord`, `summarizeExpenses`, `renderExpensesCsv`, `renderPaymentVoucherHtml`, and `renderWithholdingCertificateHtml`.
- [ ] Run the tests and verify they pass.

### Task 2: Expense API

**Files:**
- Modify: `scripts/serve-dashboard.cjs`
- Modify: `scripts/seed-cloud-storage.cjs`

- [ ] Add JSON body parsing and expense routes:
  - `GET /api/expenses`
  - `POST /api/expenses`
  - `GET /api/expenses/export.csv`
  - `GET /api/expenses/:id/payment-voucher.pdf`
  - `GET /api/expenses/:id/wht-certificate.pdf`
  - `POST /api/expenses/:id/cancel`
- [ ] Add Playwright PDF rendering helper.
- [ ] Seed `data/expenses.json` only when missing.
- [ ] Verify API routes with local requests.

### Task 3: Frontend UI

**Files:**
- Modify: `src/index.template.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] Add sidebar link and `#expenses` section.
- [ ] Add expense form, KPI cards, filters, table, export buttons, and PDF actions.
- [ ] Add API helpers that use the existing remote sync API base.
- [ ] Add form validation and visible API error states.
- [ ] Build dashboard and verify `dist/index.html` contains the new section.

### Task 4: Browser QA And Deploy

**Files:**
- Modify generated `dist/*` through `scripts/build-dashboard.cjs`.

- [ ] Run syntax checks and unit tests.
- [ ] Start or reuse local server.
- [ ] Use the in-app browser to create an expense, verify totals, verify table search, open PDF endpoints, and check console health.
- [ ] Commit selected files, excluding unrelated dirty raw data files.
- [ ] Push to GitHub and wait for GitHub Pages deployment.
- [ ] Verify the online GitHub Pages UI loads the expense section and can reach the configured API.
