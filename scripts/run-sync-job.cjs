const path = require("path");
const { spawnSync } = require("child_process");
const { loadCloudEnv } = require("./cloud-env-loader.cjs");

const projectRoot = path.resolve(__dirname, "..");
const nodePath = process.execPath;

function parseArgs(argv) {
  const args = { type: "all" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--type") args.type = argv[++i] || args.type;
    else if (!item.startsWith("--")) args.type = item;
  }
  return args;
}

function summarize(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .slice(0, 1600);
}

function runStep(name, scriptName, options = {}) {
  const result = spawnSync(nodePath, [path.join(projectRoot, "scripts", scriptName)], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  const step = {
    name,
    code: result.status,
    output: summarize(result.stdout),
    error: summarize(result.stderr || result.error?.message || ""),
  };
  console.log(JSON.stringify(step));
  if (result.status !== 0 && !options.optional) {
    throw new Error(`${name} failed with exit code ${result.status}\n${step.error || step.output}`);
  }
  return step;
}

function sellerOptional(stepName, scriptName, warnings) {
  const step = runStep(stepName, scriptName, { optional: true });
  if (step.code !== 0) warnings.push(`${stepName}: ${step.error || step.output || "failed"}`);
  return step;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validTypes = new Set(["all", "packhai", "flowaccount", "seller", "seller-payments"]);
  if (!validTypes.has(args.type)) throw new Error(`Unknown sync type: ${args.type}`);

  loadCloudEnv();
  const warnings = [];

  if (args.type === "all" || args.type === "packhai") {
    runStep("Sync Packhai stock", "sync-packhai-stock.cjs");
  }
  if (args.type === "all" || args.type === "flowaccount") {
    runStep("Sync FlowAccount stock", "sync-flowaccount-stock.cjs");
  }
  if (args.type === "all" || args.type === "seller") {
    sellerOptional("Sync Shopee Seller", "export-shopee-products.cjs", warnings);
    sellerOptional("Sync Lazada Seller", "export-lazada-products.cjs", warnings);
    sellerOptional("Sync Seller order payments", "export-seller-order-payments.cjs", warnings);
  }
  if (args.type === "seller-payments") {
    runStep("Sync Seller order payments", "export-seller-order-payments.cjs");
  }

  runStep("Build dashboard", "build-dashboard.cjs");
  runStep("Publish dashboard", "publish-github-pages.cjs");

  console.log(
    JSON.stringify(
      {
        ok: true,
        type: args.type,
        warning: warnings.length > 0,
        warnings,
      },
      null,
      2
    )
  );
}

main();
