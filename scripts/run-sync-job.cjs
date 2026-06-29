const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { loadCloudEnv } = require("./cloud-env-loader.cjs");
const { materializeStorageStateEnv } = require("./materialize-auth-state-env.cjs");

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

function concise(text) {
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "failed"
  ).slice(0, 260);
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
  if (step.code !== 0) warnings.push(`${stepName}: ${concise(step.error || step.output)}`);
  return step;
}

function writeSyncStatusFile(type, steps, warnings) {
  const statusFile = path.join(projectRoot, "dist", "sync-status.json");
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        type,
        ok: warnings.length === 0,
        warning: warnings.length > 0,
        message: warnings.length
          ? `Sync บางส่วนไม่สำเร็จ: ${warnings.join(" · ")}`
          : "Sync ข้อมูลทั้งหมดสำเร็จ",
        warnings,
        steps,
      },
      null,
      2
    ),
    "utf8"
  );
  return statusFile;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validTypes = new Set(["all", "packhai", "flowaccount", "seller", "seller-payments"]);
  if (!validTypes.has(args.type)) throw new Error(`Unknown sync type: ${args.type}`);

  loadCloudEnv();
  const authStates = materializeStorageStateEnv();
  if (authStates.length) {
    console.log(
      JSON.stringify({
        name: "Materialize auth states",
        written: authStates.map((item) => ({ kind: item.kind, file: item.file, bytes: item.bytes })),
      })
    );
  }
  const warnings = [];
  const steps = [];

  if (args.type === "all" || args.type === "packhai") {
    steps.push(runStep("Sync Packhai stock", "sync-packhai-stock.cjs"));
  }
  if (args.type === "all" || args.type === "flowaccount") {
    steps.push(runStep("Use Website stock snapshot", "use-website-stock-snapshot.cjs"));
  }
  if (args.type === "all" || args.type === "seller") {
    steps.push(sellerOptional("Sync Shopee Seller", "export-shopee-products.cjs", warnings));
    steps.push(sellerOptional("Sync Lazada Seller", "export-lazada-products.cjs", warnings));
    steps.push(sellerOptional("Sync Seller order payments", "export-seller-order-payments.cjs", warnings));
  }
  if (args.type === "seller-payments") {
    steps.push(runStep("Sync Seller order payments", "export-seller-order-payments.cjs"));
  }

  steps.push(runStep("Build dashboard", "build-dashboard.cjs"));
  const statusFile = writeSyncStatusFile(args.type, steps, warnings);
  steps.push(runStep("Publish Supabase app", "publish-supabase-app.cjs"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        type: args.type,
        warning: warnings.length > 0,
        warnings,
        statusFile,
      },
      null,
      2
    )
  );
}

main();
