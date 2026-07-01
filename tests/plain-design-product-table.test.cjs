const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function functionBlock(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
  assert.ok(start >= 0, `${functionName} was not found`);
  assert.ok(end > start, `${nextFunctionName} was not found after ${functionName}`);
  return source.slice(start, end);
}

function blockUntil(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return source.slice(start, end);
}

test("product list places SKU under the product name instead of a separate SKU column", () => {
  const source = readRepoFile("src/plain-design.js");
  const headerBlock = functionBlock(source, "renderProductTableHead", "filteredProducts");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");

  assert.doesNotMatch(headerBlock, /<th>SKU<\/th>/);
  assert.match(combinedRowBlock, /class="table-product-sku"/);
  assert.match(combinedRowBlock, /SKU\s+\$\{escapeHtml\(product\.sku\)\}/);
  assert.doesNotMatch(combinedRowBlock, /<td><strong class="sku-code">/);
  assert.match(source, /function productTableColspan/);
  assert.match(source, /return 12;/);
});

test("product list shows editable product cost, shipping cost, and profit columns", () => {
  const source = readRepoFile("src/plain-design.js");
  const headerBlock = functionBlock(source, "renderProductTableHead", "filteredProducts");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(headerBlock, />ต้นทุนสินค้า</);
  assert.match(headerBlock, />ต้นทุนขนส่ง</);
  assert.match(headerBlock, />กำไร</);
  assert.match(combinedRowBlock, /class="table-cost-input"/);
  assert.match(combinedRowBlock, /data-table-usd=/);
  assert.match(combinedRowBlock, /data-table-cell="shippingUnit"/);
  assert.match(combinedRowBlock, /data-table-cell="profitUnit"/);
  assert.match(source, /productTableColspan\(mode\)/);
  assert.match(eventsBlock, /event\.target\.closest\("\[data-table-usd\]"\)/);
  assert.match(eventsBlock, /queueProductCommercialSave\(.*\.dataset\.tableUsd/);
});

test("product list keeps the cost, shipping, and profit columns near the visible left side", () => {
  const css = readRepoFile("src/plain-design.css");

  assert.match(css, /\.product-table\s*\{\s*min-width:\s*920px;/);
  assert.match(css, /\.product-table th,\s*\.po-table th\s*\{[\s\S]*?padding:\s*0 6px;/);
  assert.match(css, /\.product-table td,\s*\.po-table td\s*\{[\s\S]*?padding:\s*7px 6px;/);
  assert.match(css, /\.product-table th:nth-child\(3\),\s*\.product-table td:nth-child\(3\)\s*\{\s*width:\s*150px;/);
  assert.match(css, /\.table-product-name\s*\{[\s\S]*?max-width:\s*145px;/);
  assert.match(css, /\.table-cost-input\s*\{[\s\S]*?width:\s*72px;/);
});

test("product list USD cost editors display a dollar unit beside the numeric input", () => {
  const source = readRepoFile("src/plain-design.js");
  const css = readRepoFile("src/plain-design.css");
  const accountingRowBlock = functionBlock(source, "renderAccountingProductRow", "renderDesignerProductRow");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");

  assert.match(accountingRowBlock, /class="table-cost-input-wrap"[\s\S]*?class="table-cost-currency" aria-hidden="true">\$/);
  assert.match(combinedRowBlock, /class="table-cost-input-wrap"[\s\S]*?class="table-cost-currency" aria-hidden="true">\$/);
  assert.match(css, /\.table-cost-input-wrap\s*\{[\s\S]*?position:\s*relative;/);
  assert.match(css, /\.table-cost-currency\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(css, /\.table-cost-input\s*\{[\s\S]*?padding:\s*0 6px 0 18px;/);
});

test("product list supports bulk redesign status updates from selected rows", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const headerBlock = functionBlock(source, "renderProductTableHead", "trackerCostInputValue");
  const selectionBlock = functionBlock(source, "renderBulkSelectionCell", "renderProductImagePairs");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="bulkStatusBar"/);
  assert.match(source, /bulkStatusSelectedSkus:\s*new Set\(\)/);
  assert.match(headerBlock, /data-bulk-status-toggle-all/);
  assert.match(selectionBlock, /data-bulk-status-row=/);
  assert.match(source, /function renderBulkStatusBar/);
  assert.match(source, /data-bulk-status-select/);
  assert.match(source, /data-bulk-status-apply/);
  assert.match(source, /function applyBulkRedesignStatus/);
  assert.match(source, /Promise\.all\(\s*skus\.map/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*sku,\s*status/);
  assert.match(eventsBlock, /data-bulk-status-row/);
  assert.match(eventsBlock, /data-bulk-status-toggle-all/);
  assert.match(eventsBlock, /data-bulk-status-apply/);
});

test("product list can bulk clear selected USD costs after confirmation", () => {
  const source = readRepoFile("src/plain-design.js");
  const bulkBarBlock = functionBlock(source, "renderBulkStatusBar", "renderProductImageModeToggle");
  const clearBlock = functionBlock(source, "clearBulkSelectedCosts", "applyBulkRedesignStatus");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(bulkBarBlock, /data-bulk-cost-clear/);
  assert.match(bulkBarBlock, /selectedCount \? "" : "disabled"/);
  assert.match(source, /function clearBulkSelectedCosts/);
  assert.match(clearBlock, /typeof window\.confirm !== "function"/);
  assert.match(clearBlock, /!window\.confirm/);
  assert.match(clearBlock, /purchaseUnitCostUsd:\s*0/);
  assert.match(clearBlock, /purchaseUnitCost:\s*0/);
  assert.match(clearBlock, /purchaseUnitCostCleared:\s*true/);
  assert.match(clearBlock, /Promise\.all\(\s*skus\.map/);
  assert.match(clearBlock, /body:\s*JSON\.stringify\(\{\s*sku,\s*purchaseUnitCostUsd:\s*0,\s*purchaseUnitCost:\s*0,\s*purchaseUnitCostCleared:\s*true\s*\}\)/);
  assert.match(eventsBlock, /data-bulk-cost-clear/);
  assert.match(eventsBlock, /clearBulkSelectedCosts\(\)/);
});

test("product list can switch cover images between KTW Mode and Plain Mode", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="productImageModeToggle"/);
  assert.match(template, /data-product-image-mode="ktw"/);
  assert.match(template, /data-product-image-mode="plain"/);
  assert.match(source, /productImageMode:\s*localStorage\.getItem\("plainProductImageMode"\)\s*\|\|\s*"ktw"/);
  assert.match(source, /function tableCoverImageFor/);
  assert.match(source, /assetsFor\(product,\s*"product_images"\)\[0\]/);
  assert.match(source, /plainProductImageMode/);
  assert.match(source, /function renderTableCoverImage/);
  assert.match(combinedRowBlock, /renderTableCoverImage\(product\)/);
  assert.match(source, /src="\$\{escapeHtml\(coverImage\.src\)\}"/);
  assert.match(source, /data-image-mode="\$\{escapeHtml\(coverImage\.mode\)\}"/);
  assert.match(eventsBlock, /data-product-image-mode/);
  assert.match(eventsBlock, /renderProductImageModeToggle/);
  assert.match(eventsBlock, /renderTrackerTable\(\)/);
});

test("Plain Mode shows no table cover image when a product has no Plain image", () => {
  const source = readRepoFile("src/plain-design.js");
  const css = readRepoFile("src/plain-design.css");
  const coverBlock = functionBlock(source, "tableCoverImageFor", "assetTarget");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");

  assert.match(coverBlock, /if \(state\.productImageMode === "plain"\)\s*\{/);
  assert.match(coverBlock, /src:\s*""/);
  assert.match(coverBlock, /empty:\s*true/);
  assert.match(combinedRowBlock, /renderTableCoverImage\(product\)/);
  assert.match(source, /table-product-image-empty/);
  assert.match(css, /\.table-product-image-empty/);
});

test("table product cover images open a multi-angle image gallery", () => {
  const source = readRepoFile("src/plain-design.js");
  const css = readRepoFile("src/plain-design.css");
  const accountingRowBlock = functionBlock(source, "renderAccountingProductRow", "renderDesignerProductRow");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");
  const poRowsBlock = functionBlock(source, "renderPoRows", "renderPoPanel");
  const lightboxBlock = functionBlock(source, "ensureImageLightbox", "openImageLightbox");
  const openGalleryBlock = functionBlock(source, "openProductImageGallery", "setImageLightboxSlide");
  const gallerySourceBlock = functionBlock(source, "tableImageGalleryFor", "renderTableCoverImage");
  const setSlideBlock = functionBlock(source, "setImageLightboxSlide", "openImageLightbox");
  const productEventsBlock = blockUntil(source, "$(\"productRows\").addEventListener(\"click\"", "if (event.target.closest(\"[data-table-usd]");
  const poEventsBlock = blockUntil(source, "$(\"poTableBody\")?.addEventListener(\"click\"", "$(\"poTableBody\")?.addEventListener(\"change\"");

  assert.match(source, /function tableImageGalleryFor/);
  assert.match(source, /function renderTableCoverImage/);
  assert.match(accountingRowBlock, /renderTableCoverImage\(product\)/);
  assert.match(combinedRowBlock, /renderTableCoverImage\(product\)/);
  assert.match(poRowsBlock, /renderTableCoverImage\(product\)/);
  assert.match(source, /data-open-gallery-sku=/);
  assert.match(source, /data-open-gallery-mode=/);
  assert.match(openGalleryBlock, /tableImageGalleryFor\(product,\s*mode\)/);
  assert.match(gallerySourceBlock, /ktwImagesFor\(product\)/);
  assert.match(gallerySourceBlock, /assetsFor\(product,\s*"product_images"\)/);
  assert.match(lightboxBlock, /data-gallery-prev/);
  assert.match(lightboxBlock, /data-gallery-next/);
  assert.match(lightboxBlock, /id="imageLightboxThumbs"/);
  assert.match(lightboxBlock, /id="imageLightboxCounter"/);
  assert.match(setSlideBlock, /image-lightbox-thumb/);
  assert.match(productEventsBlock, /data-open-gallery-sku/);
  assert.match(productEventsBlock, /openProductImageGallery/);
  assert.match(poEventsBlock, /data-open-gallery-sku/);
  assert.match(poEventsBlock, /openProductImageGallery/);
  assert.match(css, /\.table-product-image-button/);
  assert.match(css, /\.image-lightbox-nav/);
  assert.match(css, /\.image-lightbox-thumbs/);
});

test("selected product row shows a continuous animated arrow indicator", () => {
  const source = readRepoFile("src/plain-design.js");
  const css = readRepoFile("src/plain-design.css");
  const accountingRowBlock = functionBlock(source, "renderAccountingProductRow", "renderDesignerProductRow");
  const designerRowBlock = functionBlock(source, "renderDesignerProductRow", "renderCombinedProductRow");
  const combinedRowBlock = functionBlock(source, "renderCombinedProductRow", "renderTrackerTable");

  assert.match(accountingRowBlock, /product\.sku === state\.selectedSku \? "selected" : ""/);
  assert.match(designerRowBlock, /product\.sku === state\.selectedSku \? "selected" : ""/);
  assert.match(combinedRowBlock, /product\.sku === state\.selectedSku \? "selected" : ""/);
  assert.match(css, /#productRows tr\.selected > td:first-child\s*\{[\s\S]*?position:\s*relative;/);
  assert.match(css, /#productRows tr\.selected > td:first-child::before\s*\{[\s\S]*?content:\s*"";/);
  assert.match(css, /#productRows tr\.selected > td:first-child::before\s*\{[\s\S]*?border-left:\s*12px solid #9f7658;/);
  assert.match(css, /#productRows tr\.selected > td:first-child::before\s*\{[\s\S]*?animation:\s*selected-row-arrow 1s ease-in-out infinite;/);
  assert.match(css, /@keyframes selected-row-arrow/);
});

test("product detail sidebar can collapse and expand from the product table", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const css = readRepoFile("src/plain-design.css");
  const renderBlock = functionBlock(source, "render", "bindEvents");
  const detailBlock = functionBlock(source, "renderDesignDetail", "numberInput");
  const detailEventsBlock = functionBlock(source, "bindDetailEvents", "renderUploadGroup");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="plainMainGrid"/);
  assert.match(template, /id="detailPanelExpandButton"/);
  assert.match(template, /aria-controls="design"/);
  assert.match(source, /detailPanelCollapsed:\s*localStorage\.getItem\("plainDetailPanelCollapsed"\)\s*===\s*"1"/);
  assert.match(source, /function renderDetailPanelShell/);
  assert.match(source, /function setDetailPanelCollapsed/);
  assert.match(renderBlock, /renderDetailPanelShell\(\)/);
  assert.match(detailBlock, /data-detail-panel-collapse/);
  assert.match(detailEventsBlock, /data-detail-panel-collapse/);
  assert.match(eventsBlock, /detailPanelExpandButton/);
  assert.match(eventsBlock, /setDetailPanelCollapsed\(false\)/);
  assert.match(css, /\.main-grid\.detail-collapsed\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.main-grid\.detail-collapsed\s+\.detail-panel\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.detail-panel-expand-button\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
});

test("product detail sidebar shows image comparison before upload groups", () => {
  const source = readRepoFile("src/plain-design.js");
  const detailBlock = functionBlock(source, "renderDesignDetail", "numberInput");
  const compareIndex = detailBlock.indexOf("${renderImageComparison(product)}");
  const uploadStackIndex = detailBlock.indexOf('<div class="upload-stack" id="factory">');

  assert.ok(compareIndex >= 0, "image comparison is rendered in the detail sidebar");
  assert.ok(uploadStackIndex >= 0, "upload stack is rendered in the detail sidebar");
  assert.ok(compareIndex < uploadStackIndex, "image comparison appears before upload groups");
});

test("product detail sidebar places the KTW source link beside the top SKU", () => {
  const source = readRepoFile("src/plain-design.js");
  const detailBlock = functionBlock(source, "renderDesignDetail", "numberInput");
  const productCardBlock = blockUntil(detailBlock, '<section class="detail-product-card">', '<section class="detail-kpis">');
  const ktwReferenceBlock = blockUntil(detailBlock, '<section class="source-card ktw-reference">', '<section class="packhai-card">');
  const skuIndex = productCardBlock.indexOf("<strong>${escapeHtml(product.sku)}</strong>");
  const sourceLinkIndex = productCardBlock.indexOf('class="detail-ktw-source-link"');

  assert.ok(skuIndex >= 0, "top product card shows the selected SKU");
  assert.ok(sourceLinkIndex > skuIndex, "KTW source link appears after the top SKU");
  assert.match(productCardBlock, /href="\$\{escapeHtml\(product\.sourceUrl\)\}"/);
  assert.match(productCardBlock, /target="_blank"\s+rel="noreferrer"/);
  assert.doesNotMatch(ktwReferenceBlock, /href="\$\{escapeHtml\(product\.sourceUrl\)\}"/);
});

test("product list supports Accounting, Designer, and combined table modes", () => {
  const source = readRepoFile("src/plain-design.js");
  const template = readRepoFile("src/plain-design.template.html");
  const css = readRepoFile("src/plain-design.css");
  const headerBlock = functionBlock(source, "renderProductTableHead", "trackerCostInputValue");
  const accountingRowBlock = functionBlock(source, "renderAccountingProductRow", "renderDesignerProductRow");
  const tableBlock = functionBlock(source, "renderTrackerTable", "fileSize");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(template, /id="productTableModeToggle"/);
  assert.match(template, /data-product-table-mode="accounting"/);
  assert.match(template, /data-product-table-mode="designer"/);
  assert.match(template, /data-product-table-mode="combined"/);
  assert.match(template, /Accounting Expert/);
  assert.match(template, /Designer Expert/);
  assert.doesNotMatch(template, /💰|🎨/);
  assert.match(template, /<span class="table-mode-emoji table-mode-emoji-accounting" aria-hidden="true">฿<\/span>\s*Accounting Expert/);
  assert.match(template, /<span class="table-mode-emoji table-mode-emoji-designer" aria-hidden="true">✎<\/span>\s*Designer Expert/);
  assert.match(template, /Accounting&Design Mode/);
  assert.match(source, /productTableMode:\s*localStorage\.getItem\("plainProductTableMode"\)\s*\|\|\s*"combined"/);
  assert.match(source, /function normalizeProductTableMode/);
  assert.match(source, /function renderProductTableModeToggle/);
  assert.match(source, /if \(normalized === "accounting"\) return 10/);
  assert.match(headerBlock, />ยอดขายรวม</);
  assert.match(headerBlock, />กำไรรวม</);
  assert.match(accountingRowBlock, /class="product-image-cell"/);
  assert.match(accountingRowBlock, /renderTableCoverImage\(product\)/);
  assert.match(source, /class="table-product-image"/);
  assert.match(source, /class="table-product-image-empty"/);
  assert.match(tableBlock, /renderAccountingProductRow/);
  assert.match(tableBlock, /renderDesignerProductRow/);
  assert.match(tableBlock, /renderCombinedProductRow/);
  assert.match(source, /function renderProductImagePairs/);
  assert.match(source, /ktwImagesFor\(product\)/);
  assert.match(source, /assetsFor\(product,\s*"product_images"\)/);
  assert.match(eventsBlock, /data-product-table-mode/);
  assert.match(eventsBlock, /plainProductTableMode/);
  assert.match(eventsBlock, /renderProductTableModeToggle/);
  assert.match(css, /\.product-table\.accounting-mode/);
  assert.match(css, /\.product-table\.accounting-mode th:nth-child\(10\)/);
  assert.match(css, /\.product-table\.designer-mode/);
  assert.match(css, /\.product-image-pairs/);
  assert.match(css, /\.table-mode-emoji\s*\{[\s\S]*?background:\s*#efe6dc;[\s\S]*?color:\s*#9f7658;/);
  assert.match(css, /\.product-table-mode-toggle \.table-mode-emoji\s*\{[\s\S]*?color:\s*#9f7658;/);
  assert.match(css, /\.product-table-mode-toggle button\.active \.table-mode-emoji\s*\{[\s\S]*?color:\s*#fff;/);
});

test("Designer Expert can switch and upload Plain product image versions per KTW angle", () => {
  const source = readRepoFile("src/plain-design.js");
  const css = readRepoFile("src/plain-design.css");
  const pairBlock = functionBlock(source, "renderProductImagePairs", "renderAccountingProductRow");
  const paneBlock = functionBlock(source, "renderPlainImagePane", "renderImageComparison");
  const uploadBlock = functionBlock(source, "uploadFiles", "deleteAsset");
  const eventsBlock = blockUntil(source, "function bindEvents", "applyReferenceCopy();");

  assert.match(source, /const PLAIN_IMAGE_VERSION_COUNT = 3;/);
  assert.match(source, /function plainImageVersionSelection/);
  assert.match(source, /function plainImageAssetFor/);
  assert.match(source, /function renderPlainImageVersionControls/);
  assert.match(pairBlock, /renderPlainImageVersionControls\(product,\s*index\)/);
  assert.match(paneBlock, /renderPlainImageVersionControls\(product,\s*index\)/);
  assert.match(source, /data-plain-image-version=/);
  assert.match(source, /data-plain-image-version-upload=/);
  assert.match(eventsBlock, /data-plain-image-version/);
  assert.match(eventsBlock, /savePlainImageVersionSelection/);
  assert.match(eventsBlock, /data-plain-image-version-upload/);
  assert.match(uploadBlock, /angleIndex/);
  assert.match(uploadBlock, /version/);
  assert.match(css, /\.plain-image-version-selector/);
  assert.match(css, /\.plain-version-upload/);
});
