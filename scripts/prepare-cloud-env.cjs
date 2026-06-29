const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { normalizePublicSyncApiBase } = require("./sync-api-base-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join(projectRoot, ".tmp", "cloud-sync.env");
const authStateEnvFile = path.join(projectRoot, ".tmp", "render-auth-state.env");
const packhaiTokenFile = path.join(projectRoot, ".packhai-token.local");

function parseArgs(argv) {
  const args = {
    output: defaultOutput,
    publicSyncApiBase: "",
    githubToken: "",
    githubTokenFromGh: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--output") args.output = path.resolve(argv[++i] || defaultOutput);
    else if (item === "--public-sync-api-base") args.publicSyncApiBase = argv[++i] || "";
    else if (item === "--github-token") args.githubToken = argv[++i] || "";
    else if (item === "--github-token-from-gh") args.githubTokenFromGh = true;
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

function readGithubTokenFromGh() {
  const result = spawnSync("gh", ["auth", "token"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function supabaseUrlFromEnv() {
  const explicit = String(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const projectId = String(process.env.SUPABASE_PROJECT_ID || "").trim();
  return projectId ? `https://${projectId}.supabase.co` : "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const authStateEnv = readEnvFile(authStateEnvFile);
  const githubToken =
    args.githubToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (args.githubTokenFromGh ? readGithubTokenFromGh() : "");
  const publicSyncApiBase = normalizePublicSyncApiBase(args.publicSyncApiBase || process.env.PUBLIC_SYNC_API_BASE, {
    source: "env",
  });
  const supabaseUrl = supabaseUrlFromEnv();
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
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || supabaseUrl,
    PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    PUBLIC_SYNC_API_BASE: publicSyncApiBase,
    GITHUB_TOKEN: githubToken,
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
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
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
        publicSyncApiBasePresent: Boolean(publicSyncApiBase),
        supabaseUrlPresent: Boolean(supabaseUrl),
        githubTokenSource: githubToken
          ? args.githubToken
            ? "argument"
            : process.env.GITHUB_TOKEN || process.env.GH_TOKEN
            ? "environment"
            : args.githubTokenFromGh
            ? "gh"
            : ""
          : "",
      },
      null,
      2
    )
  );
}

main();
