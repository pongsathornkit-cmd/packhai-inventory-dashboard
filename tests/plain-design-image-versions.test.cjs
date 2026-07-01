const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createPlainDesignAiImageRevision,
  loadPlainDesignState,
  savePlainDesignAssetFiles,
  updatePlainDesignProduct,
} = require("../scripts/plain-design-core.cjs");

function makePlainDesignOptions(seed, storedState = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-design-image-versions-"));
  const seedFile = path.join(dir, "seed.json");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(seedFile, JSON.stringify(seed, null, 2));
  if (storedState) fs.writeFileSync(stateFile, JSON.stringify(storedState, null, 2));
  return {
    seedFile,
    stateFile,
    dashboardFile: path.join(dir, "dashboard.json"),
    ktwLogisticsFile: path.join(dir, "ktw-logistics.json"),
    assetDir: path.join(dir, "assets"),
  };
}

test("Plain product image uploads can target a KTW angle and selectable version", () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images" }],
  });

  const created = savePlainDesignAssetFiles(options, {
    sku: "sku-1",
    group: "product_images",
    angleIndex: 2,
    version: 3,
    files: [
      {
        name: "plain-angle-2-v3.jpg",
        type: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==",
      },
    ],
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].angleIndex, 2);
  assert.equal(created[0].version, 3);

  const updated = updatePlainDesignProduct(options, {
    sku: "SKU-1",
    plainImageVersionSelections: { 1: 2, 2: 3 },
  });
  assert.deepEqual(updated.plainImageVersionSelections, { 1: 2, 2: 3 });

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === "SKU-1");
  assert.deepEqual(product.plainImageVersionSelections, { 1: 2, 2: 3 });
  assert.equal(product.assets[0].angleIndex, 2);
  assert.equal(product.assets[0].version, 3);
});

test("AI image edit creates the next sub-version and selects it for that angle", async () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images" }],
  });
  savePlainDesignAssetFiles(options, {
    sku: "SKU-1",
    group: "product_images",
    angleIndex: 1,
    version: 2,
    files: [
      {
        name: "plain-angle-1-v2.jpg",
        type: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,c291cmNlLWltYWdl",
      },
    ],
  });

  const result = await createPlainDesignAiImageRevision(
    options,
    {
      sku: "SKU-1",
      angleIndex: 1,
      version: 2,
      prompt: "make the blade darker and add PLAIN packaging style",
    },
    {
      generateImageEdit: async (request) => {
        assert.equal(request.sku, "SKU-1");
        assert.equal(request.angleIndex, 1);
        assert.equal(request.sourceVersion, 2);
        assert.equal(request.newVersion, 2.1);
        assert.match(request.sourceImageDataUrl, /^data:image\/jpeg;base64,/);
        assert.match(request.prompt, /make the blade darker/);
        return {
          dataUrl: "data:image/png;base64,YWktZWRpdGVkLWltYWdl",
          mimeType: "image/png",
          model: "fake-image-model",
        };
      },
    }
  );

  assert.equal(result.newVersion, 2.1);
  assert.equal(result.sourceVersion, 2);
  assert.equal(result.asset.version, 2.1);
  assert.equal(result.asset.angleIndex, 1);
  assert.equal(result.asset.metadata.aiGenerated, true);
  assert.equal(result.asset.metadata.sourceVersion, 2);
  assert.equal(result.product.plainImageVersionSelections[1], 2.1);

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === "SKU-1");
  assert.equal(product.plainImageVersionSelections[1], 2.1);
  assert.equal(product.assets[0].version, 2.1);
});
