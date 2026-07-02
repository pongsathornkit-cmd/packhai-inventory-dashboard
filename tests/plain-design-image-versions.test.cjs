const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  completePlainDesignCodexImageJob,
  createPlainDesignAiImageRevision,
  loadPlainDesignState,
  queuePlainDesignCodexImageJob,
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
    version: 2,
    files: [
      {
        name: "plain-angle-2-v2.jpg",
        type: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==",
      },
    ],
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].angleIndex, 2);
  assert.equal(created[0].version, 2);
  assert.throws(() => savePlainDesignAssetFiles(options, {
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
  }), /Plain image version is invalid/);

  const updated = updatePlainDesignProduct(options, {
    sku: "SKU-1",
    plainImageVersionSelections: { 1: 2, 2: 3 },
  });
  assert.deepEqual(updated.plainImageVersionSelections, { 1: 2, 2: 1 });

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === "SKU-1");
  assert.deepEqual(product.plainImageVersionSelections, { 1: 2, 2: 1 });
  assert.equal(product.assets[0].angleIndex, 2);
  assert.equal(product.assets[0].version, 2);
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

test("AI image edit sends attached reference images with the source image", async () => {
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
    version: 1,
    files: [
      {
        name: "plain-angle-1-v1.jpg",
        type: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,c291cmNlLWltYWdl",
      },
    ],
  });

  let openAiRequestBody = null;
  const result = await createPlainDesignAiImageRevision(
    options,
    {
      sku: "SKU-1",
      angleIndex: 1,
      version: 1,
      prompt: "match the attached brown package reference",
      referenceImages: [
        {
          name: "package-front.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,cmVmZXJlbmNlLW9uZQ==",
        },
        {
          name: "style-board.webp",
          type: "image/webp",
          dataUrl: "data:image/webp;base64,cmVmZXJlbmNlLXR3bw==",
        },
      ],
    },
    {
      apiKey: "test-key",
      model: "gpt-image-test",
      fetchImpl: async (_url, request) => {
        openAiRequestBody = JSON.parse(request.body);
        return {
          ok: true,
          text: async () => JSON.stringify({
            data: [{ b64_json: "YWktZWRpdGVkLXdpdGgtcmVmZXJlbmNlcw==" }],
          }),
        };
      },
    }
  );

  assert.equal(openAiRequestBody.model, "gpt-image-test");
  assert.equal(openAiRequestBody.images.length, 3);
  assert.match(openAiRequestBody.images[0].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(openAiRequestBody.images[1].image_url, "data:image/png;base64,cmVmZXJlbmNlLW9uZQ==");
  assert.equal(openAiRequestBody.images[2].image_url, "data:image/webp;base64,cmVmZXJlbmNlLXR3bw==");
  assert.equal(result.asset.metadata.referenceImageCount, 2);
});

test("Codex image jobs queue a pending redesign without calling OpenAI", () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images", sourceImageUrl: "https://shop.ktw.co.th/source-1.jpg" }],
  });

  const result = queuePlainDesignCodexImageJob(options, {
    sku: "sku-1",
    angleIndex: 1,
    version: 1,
    prompt: "redesign as PLAIN premium brown gold",
    referenceImages: [
      {
        name: "style.png",
        type: "image/png",
        dataUrl: "data:image/png;base64,c3R5bGUtcmVm",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.job.sku, "SKU-1");
  assert.equal(result.job.status, "pending");
  assert.equal(result.job.angleIndex, 1);
  assert.equal(result.job.sourceVersion, 1);
  assert.equal(result.job.newVersion, 1.1);
  assert.equal(result.job.referenceImages.length, 1);
  assert.equal(result.job.referenceImages[0].dataUrl, undefined);
  assert.match(result.job.referenceImages[0].publicUrl, /\/api\/plain-design\/assets\/SKU-1\/codex_reference_images\//);
  assert.match(result.job.referenceImages[0].filePath, /^SKU-1\/codex_reference_images\//);
  assert.match(result.job.prompt, /PLAIN premium/);

  const state = loadPlainDesignState(options);
  assert.equal(state.codexAiJobs.length, 1);
  assert.equal(state.codexAiJobs[0].status, "pending");
  assert.equal(state.codexAiJobs[0].referenceImages[0].dataUrl, undefined);
  assert.match(state.codexAiJobs[0].referenceImages[0].publicUrl, /\/api\/plain-design\/assets\/SKU-1\/codex_reference_images\//);
});

test("stored Codex image jobs strip heavy reference data URLs from state", () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images", sourceImageUrl: "https://shop.ktw.co.th/source-1.jpg" }],
  }, {
    codexAiJobs: [
      {
        id: "job-legacy-reference",
        status: "pending",
        sku: "SKU-1",
        angleIndex: 1,
        sourceVersion: 1,
        newVersion: 1.1,
        prompt: "legacy job with pasted references",
        referenceImages: [
          {
            name: "legacy-reference.png",
            type: "image/png",
            size: 123,
            dataUrl: `data:image/png;base64,${"a".repeat(2048)}`,
          },
        ],
      },
    ],
  });

  const state = loadPlainDesignState(options);
  assert.equal(state.codexAiJobs[0].referenceImages.length, 1);
  assert.equal(state.codexAiJobs[0].referenceImages[0].dataUrl, undefined);
  assert.equal(state.codexAiJobs[0].referenceImages[0].name, "legacy-reference.png");
  assert.ok(state.codexAiJobs[0].referenceImages[0].dataUrlBytes > 2048);
});

test("Plain product upload compacts legacy Codex reference images in saved state", () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images", sourceImageUrl: "https://shop.ktw.co.th/source-1.jpg" }],
  }, {
    codexAiJobs: [
      {
        id: "job-heavy-reference",
        status: "pending",
        sku: "SKU-1",
        angleIndex: 1,
        sourceVersion: 1,
        newVersion: 1.1,
        prompt: "legacy heavy reference",
        referenceImages: [{
          name: "heavy.png",
          type: "image/png",
          size: 123,
          dataUrl: `data:image/png;base64,${"a".repeat(4096)}`,
        }],
      },
    ],
  });

  savePlainDesignAssetFiles(options, {
    sku: "SKU-1",
    group: "product_images",
    angleIndex: 1,
    version: 1,
    files: [{
      name: "plain-angle-1.jpg",
      type: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,cGxhaW4=",
    }],
  });

  const rawState = fs.readFileSync(options.stateFile, "utf8");
  assert.doesNotMatch(rawState, /data:image\/png;base64/);
  const state = JSON.parse(rawState);
  assert.equal(state.codexAiJobs[0].referenceImages[0].dataUrl, undefined);
  assert.ok(state.codexAiJobs[0].referenceImages[0].dataUrlBytes > 4096);
});

test("Codex image job completion saves the returned image as the reserved Plain version", () => {
  const options = makePlainDesignOptions({
    statusOptions: [],
    categoryOptions: [],
    assetGroups: [],
    products: [{ sku: "SKU-1", name: "Blade", status: "waiting_ai_images", sourceImageUrl: "https://shop.ktw.co.th/source-1.jpg" }],
  });
  const queued = queuePlainDesignCodexImageJob(options, {
    sku: "SKU-1",
    angleIndex: 1,
    version: 1,
    prompt: "redesign as PLAIN",
  });

  const result = completePlainDesignCodexImageJob(options, {
    jobId: queued.job.id,
    imageDataUrl: "data:image/png;base64,Y29kZXgtcmVzdWx0",
    fileName: "plain-v1-1.png",
    revisedPrompt: "final PLAIN redesign",
  });

  assert.equal(result.ok, true);
  assert.equal(result.job.status, "completed");
  assert.equal(result.asset.version, 1.1);
  assert.equal(result.asset.angleIndex, 1);
  assert.equal(result.asset.metadata.codexJobId, queued.job.id);
  assert.equal(result.product.plainImageVersionSelections[1], 1.1);

  const state = loadPlainDesignState(options);
  const product = state.products.find((item) => item.sku === "SKU-1");
  assert.equal(product.assets[0].version, 1.1);
  assert.equal(state.codexAiJobs[0].assetId, result.asset.id);
});

test("Render exposes OpenAI image editing environment variables", () => {
  const renderSource = fs.readFileSync(path.join(__dirname, "..", "render.yaml"), "utf8");

  assert.match(renderSource, /key:\s*OPENAI_API_KEY\s*\n\s*sync:\s*false/);
  assert.match(renderSource, /key:\s*OPENAI_IMAGE_MODEL\s*\n\s*value:\s*gpt-image-2/);
});
