# Design QA — restored PLAIN sidebar

## Comparison setup

- Reference: `C:\Users\theki\AppData\Local\Temp\codex-clipboard-9afd659e-0140-456c-b96d-ecab3abc41e3.png`
- Implementation: `output/sidebar-local-crop-185x872.png`
- Combined comparison: `output/sidebar-reference-comparison.png`
- Route/state: `#products`, 120 of 120 products visible, Accounting Expert active.
- Viewport: implementation rendered at 1656 × 872 and was cropped to the same 185 × 872 sidebar region as the reference.

## Visible-difference review

1. `[P1]` The products route hid the entire left sidebar. Fixed by removing the products-only shell override and sidebar `display: none` rule.
2. Post-fix structure, 178 px sidebar width, divider, branding, navigation spacing, and bottom Packhai status card match the reference.
3. The reference highlights `ใบสั่งซื้อ`; the implementation highlights `รายการสินค้า` because the verified route is `#products`. This is the correct active state, not a visual defect.
4. No remaining P0, P1, or P2 visual differences.

## Interaction and accessibility checks

- `รายการสินค้า` and `ใบสั่งซื้อ` are exposed as navigation links.
- Clicking `ใบสั่งซื้อ` changes the route to `#purchase-order`, shows the purchase-order panel, and moves the active state to that menu item.
- Clicking `รายการสินค้า` returns to `#products`, restores the product table, and moves the active state back.
- Browser console: 0 warnings and 0 errors.
- Automated verification: 199 tests passed; production build completed successfully.

## Open questions

- None.

final result: passed
