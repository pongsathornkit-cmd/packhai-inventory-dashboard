const fs = require("fs");
const path = require("path");

const { chromium, chromiumOptions, boolEnv } = require("./playwright-runtime.cjs");
const { defaultStorageStateFile } = require("./browser-auth-state.cjs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const headless = boolEnv("SELLER_HEADLESS", false);

const targets = {
  shopee: {
    env: "SHOPEE_STORAGE_STATE_B64",
    profile:
      process.env.SHOPEE_SESSION_DIR ||
      (fs.existsSync(path.join(workspaceRoot, ".codex-seller-browser-session"))
        ? path.join(workspaceRoot, ".codex-seller-browser-session")
        : path.join(projectRoot, "browser-profiles", "shopee")),
    url: "https://seller.shopee.co.th/portal/product/list/live/all",
  },
  lazada: {
    env: "LAZADA_STORAGE_STATE_B64",
    profile:
      process.env.SELLER_SESSION_DIR ||
      (fs.existsSync(path.join(workspaceRoot, "chrome-lazada-cdp-profile"))
        ? path.join(workspaceRoot, "chrome-lazada-cdp-profile")
        : path.join(projectRoot, "browser-profiles", "lazada")),
    url: "https://sellercenter.lazada.co.th/apps/product/list?tab=online_product",
  },
  flowaccount: {
    env: "FLOWACCOUNT_STORAGE_STATE_B64",
    profile:
      process.env.FLOW_PROFILE ||
      (fs.existsSync(path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada"))
        ? path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada")
        : path.join(projectRoot, "browser-profiles", "flowaccount")),
    url: "https://advance.flowaccount.com/N8387296/business/reports/inventory",
  },
  ktw: {
    env: "KTW_STORAGE_STATE_B64",
    profile: process.env.KTW_SESSION_DIR || path.join(projectRoot, "browser-profiles", "ktw"),
    url: "https://shop.ktw.co.th/p/P525-1310",
  },
};

function parseArgs(argv) {
  const args = new Set(argv);
  const selected = argv.filter((item) => targets[item]);
  return {
    selected: selected.length ? selected : Object.keys(targets),
    writeEnvFile: argv.includes("--write-env-file")
      ? path.resolve(argv[argv.indexOf("--write-env-file") + 1] || path.join(projectRoot, ".tmp", "render-auth-state.env"))
      : "",
    printB64: args.has("--print-b64"),
  };
}

async function exportTarget(name) {
  const target = targets[name];
  if (!fs.existsSync(target.profile)) {
    throw new Error(`${name} profile not found: ${target.profile}`);
  }
  const outputFile = defaultStorageStateFile(name);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const context = await chromium.launchPersistentContext(target.profile, {
    ...chromiumOptions(),
    headless,
    viewport: { width: 1365, height: 900 },
    locale: "th-TH",
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(headless ? [] : ["--start-maximized"])],
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await context.storageState({ path: outputFile });
  } finally {
    await context.close().catch(() => {});
  }

  const json = fs.readFileSync(outputFile, "utf8");
  return {
    name,
    env: target.env,
    outputFile,
    bytes: Buffer.byteLength(json),
    b64: Buffer.from(json, "utf8").toString("base64"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const exports = [];
  for (const name of options.selected) {
    exports.push(await exportTarget(name));
  }

  if (options.writeEnvFile) {
    fs.mkdirSync(path.dirname(options.writeEnvFile), { recursive: true });
    fs.writeFileSync(options.writeEnvFile, exports.map((item) => `${item.env}=${item.b64}`).join("\n") + "\n", "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        writeEnvFile: options.writeEnvFile || "",
        exports: exports.map((item) => ({
          name: item.name,
          env: item.env,
          outputFile: item.outputFile,
          bytes: item.bytes,
          b64Printed: options.printB64,
          b64: options.printB64 ? item.b64 : undefined,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
