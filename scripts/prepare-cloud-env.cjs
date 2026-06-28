const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join(projectRoot, ".tmp", "cloud-sync.env");
const authStateEnvFile = path.join(projectRoot, ".tmp", "render-auth-state.env");
const packhaiTokenFile = path.join(projectRoot, ".packhai-token.local");

function parseArgs(argv) {
  const args = {
    output: defaultOutput,
    publicSyncApiBase: "",
    githubToken: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--output") args.output = path.resolve(argv[++i] || defaultOutput);
    else if (item === "--public-sync-api-base") args.publicSyncApiBase = argv[++i] || "";
    else if (item === "--github-token") args.githubToken = argv[++i] || "";
  }
  return args;
}

function readSecretFile(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function readEnvFile(file) {
  const env = {};
  const text = readSecretFile(file);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function formatEnvValue(value) {
  return String(value || "").replace(/\r?\n/g, "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const authStateEnv = readEnvFile(authStateEnvFile);
  const env = {
    HOST: "0.0.0.0",
    SELLER_HEADLESS: "1",
    SYNC_REQUIRE_KEY: "0",
    PACKHAI_DATA_DIR: "/app/storage/data",
    PACKHAI_AUTH_STATE_DIR: "/app/storage/auth-states",
    FLOW_PROFILE: "/app/storage/browser-profiles/flowaccount",
    SHOPEE_SESSION_DIR: "/app/storage/browser-profiles/shopee",
    SELLER_SESSION_DIR: "/app/storage/browser-profiles/lazada",
    PACKHAI_AUTH_TOKEN: process.env.PACKHAI_AUTH_TOKEN || readSecretFile(packhaiTokenFile),
    PUBLIC_SYNC_API_BASE: args.publicSyncApiBase || process.env.PUBLIC_SYNC_API_BASE || "",
    GITHUB_TOKEN: args.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
    SHOPEE_STORAGE_STATE_B64: authStateEnv.SHOPEE_STORAGE_STATE_B64 || process.env.SHOPEE_STORAGE_STATE_B64 || "",
    LAZADA_STORAGE_STATE_B64: authStateEnv.LAZADA_STORAGE_STATE_B64 || process.env.LAZADA_STORAGE_STATE_B64 || "",
    FLOWACCOUNT_STORAGE_STATE_B64:
      authStateEnv.FLOWACCOUNT_STORAGE_STATE_B64 || process.env.FLOWACCOUNT_STORAGE_STATE_B64 || "",
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(
    args.output,
    Object.entries(env)
      .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
      .join("\n") + "\n",
    "utf8"
  );

  const required = [
    "PACKHAI_AUTH_TOKEN",
    "GITHUB_TOKEN",
    "SHOPEE_STORAGE_STATE_B64",
    "LAZADA_STORAGE_STATE_B64",
    "FLOWACCOUNT_STORAGE_STATE_B64",
  ];
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: args.output,
        keys: Object.keys(env).map((key) => ({
          key,
          present: Boolean(String(env[key] || "")),
          length: String(env[key] || "").length,
          required: required.includes(key),
        })),
        missingRequired: required.filter((key) => !String(env[key] || "")),
      },
      null,
      2
    )
  );
}

main();
