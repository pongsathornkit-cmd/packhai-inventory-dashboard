# Design QA — PLAIN product form

## Comparison setup

- Reference: `C:\Users\theki\AppData\Local\Temp\codex-clipboard-4caa36cd-a321-4346-8ef9-6c9483f8f19c.png`
- Implementation: `output/plain-form-reference-qa-local.png`
- Full comparison: `output/plain-form-design-qa-full.png`
- Focused top-region comparison: `output/plain-form-design-qa-top.png`
- Responsive evidence: `output/plain-form-qa-tablet.png`, `output/plain-form-qa-mobile.png`
- Route/state: `#products`, category `ทั้งหมด`, empty search, Accounting Expert active, product detail collapsed, 120 of 120 products visible, light theme.
- Viewport and density: both desktop captures are 1656 × 859 physical pixels at 1× density. The in-app browser viewport override was 1671 × 867 so its rendered content area matched the 1656 × 859 reference without resampling.

## Visible-difference history

1. `[P2]` The existing sidebar, top-bar actions, status filter, reset button, and product-detail column compressed the desktop table compared with the reference. Fixed by activating a full-width `product-form-view` shell on the products route and collapsing the detail panel for Accounting Expert.
2. `[P2]` The tablet breakpoint retained the stacked application shell. Fixed by applying the products-route shell rules at all viewport widths.
3. `[P2]` The mobile section title and mode toggle overlapped and clipped. Fixed by stacking the section heading and allowing the mode toggle to scroll horizontally.
4. Post-fix desktop comparison: no remaining P0, P1, or P2 visual differences. Cost and profit numbers differ from the reference only because the implementation renders current stored costs and the latest exchange-rate-derived values.

## Surface review

- Typography: same product font stack, weights, hierarchy, and compact line heights as the reference.
- Spacing and geometry: title bar, search row, card header, bulk toolbar, table header, row heights, borders, and circular thumbnails align with the reference.
- Color: warm neutral surfaces, brown active mode, red destructive action, and green profit values match the source design system.
- Images: real product images are used at the correct circular crop and density; no placeholders or drawn substitutes were introduced.
- Copy and controls: labels, filters, Accounting/Designer/combined modes, bulk controls, and table columns match the reference.
- Accessibility: semantic buttons, selects, inputs, table markup, pressed states, and existing ARIA labels remain intact. Narrow screens keep the page width stable while the dense table scrolls within its own container.

## Interaction and error checks

- Search: filtering for `W0586` showed 1 of 120 products; clearing the query restored 120 of 120.
- Mode switching: Designer Expert expanded its detailed workflow; switching back to Accounting Expert restored the compact accounting table and collapsed detail state.
- Routing: `#purchase-order` retained the original application shell, while returning to `#products` restored the full-width form.
- Responsive: desktop 1656 × 859, tablet 1024 × 796, and mobile 390 × 820 showed no page-level horizontal overflow or overlapping controls.
- Browser console: 0 warnings and 0 errors.
- Automated verification: 196 tests passed; production build completed successfully; `git diff --check` passed.

## Open questions

- None.

## Final result

passed
