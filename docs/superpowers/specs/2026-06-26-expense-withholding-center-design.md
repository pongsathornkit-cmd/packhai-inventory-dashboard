# Expense & Withholding Center Design

## Goal

Build an expense entry and withholding tax module inside the Packhai dashboard so the team can record expenses, calculate VAT and withholding tax, issue payment voucher PDFs, issue withholding certificate PDFs, search historical documents, and export PND 3 / PND 53 working files without entering the same transaction in FlowAccount first.

## Scope

Phase 1 includes:

- Expense dashboard for monthly totals.
- Expense form with supplier, recipient type, category, document date, invoice/reference, amount, VAT mode, withholding rate, and notes.
- VAT calculation for VAT 7%, no VAT, and VAT-exempt transactions.
- Withholding calculation for 0%, 1%, 2%, 3%, and 5%.
- Automatic document numbers:
  - `EXP-YYYYMM-0001` for payment vouchers.
  - `WHT-YYYYMM-0001` for withholding certificates.
- Recipient type maps to report type:
  - individual -> PND 3
  - company -> PND 53
- Statuses: draft, posted, cancelled.
- API-backed storage on the existing sync server persistent data directory.
- PDF output for payment voucher and 50 bis withholding certificate.
- CSV export for all expenses, PND 3, or PND 53.

Out of scope for phase 1:

- Direct filing to the Revenue Department.
- Direct sync into FlowAccount.
- Multi-user approval workflow.
- OCR for receipt uploads.
- Full accounting journal entries.

## Architecture

The GitHub Pages dashboard remains the read-mostly frontend. The existing sync server becomes the write API for expenses, using the same public API base that sync buttons already use. Expense data is saved in a JSON file under `PACKHAI_DATA_DIR` so it persists on Render/VPS persistent storage and is seeded only when missing.

Calculation logic is isolated in `scripts/expense-core.cjs` and tested with Node's built-in test runner. The HTTP API is added to `scripts/serve-dashboard.cjs` and delegates all tax math, validation, storage normalization, CSV rendering, and HTML document rendering to the expense module.

## Data Model

Each expense stores:

- `id`
- `createdAt`, `updatedAt`
- `status`
- `expenseNo`
- `whtNo`
- `paymentDate`
- `recipientName`
- `recipientTaxId`
- `recipientAddress`
- `recipientType`: `individual` or `company`
- `pndType`: `PND3` or `PND53`
- `category`
- `description`
- `invoiceNo`
- `amountInput`
- `amountMode`: `exclusive` or `inclusive`
- `vatMode`: `vat7`, `none`, or `exempt`
- `whtRate`
- computed totals: `subtotal`, `vatAmount`, `grossAmount`, `withholdingBase`, `withholdingAmount`, `netPayable`
- `notes`

## Calculation Rules

- `exclusive + vat7`: subtotal is the input amount, VAT is 7%, gross is subtotal plus VAT.
- `inclusive + vat7`: gross is the input amount, subtotal is gross divided by 1.07, VAT is the difference.
- `none` and `exempt`: VAT is zero and gross equals subtotal.
- withholding base is the subtotal before VAT.
- withholding amount is withholding base multiplied by the withholding rate.
- net payable is gross minus withholding.
- money is rounded to two decimals.

## UI

Add a sidebar item and a new section:

- KPI cards: month expense total, VAT purchase, withholding, net payable.
- Form panel: enter and save an expense.
- Recent expense table: search, filter by status/report type, open PDFs, cancel documents.
- Export buttons: all CSV, PND 3 CSV, PND 53 CSV.

The UI follows the existing NIPA-inspired dashboard styling and avoids a separate landing page.

## Error Handling

- The frontend shows an API setup notice if opened from GitHub Pages without a sync API base.
- Invalid form data returns HTTP 400 with a user-readable message.
- PDF generation returns HTTP 500 with a concise message if Chromium is unavailable.
- Cancelled expenses remain stored but are excluded from posted totals.

## Verification

- Unit tests cover VAT/WHT calculations, recipient-to-report mapping, document numbering, validation, and CSV output.
- Browser QA covers page load, expense creation, dashboard update, search, CSV export link, payment voucher PDF endpoint, and withholding PDF endpoint.
