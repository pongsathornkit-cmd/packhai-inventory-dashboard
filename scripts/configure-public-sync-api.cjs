const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { normalizePublicSyncApiBase } = require("./sync-api-base-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const syncApiBaseFile = path.join(projectRoot, ".sync-api-base.local");
const nodePath = process.execPath;

function parseArgs(argv) {
  const args = {
    base: "",
    skipHealth: false,
    publish: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--base") args.base = argv[++i] || "";
    else if (item === "--skip-health") args.skipHealth = true;
    else if (item === "--publish") args.publish = true;
    else if (!item.startsWith("--") && !args.base) args.base = item;
  }
  return args;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${output}`);
  }
  return output;
}

async function readJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = normalizePublicSyncApiBase(args.base || process.env.PUBLIC_SYNC_API_BASE, { source: "env" });
  if (!base) throw new Error("Usage: node scripts/configure-public-sync-api.cjs --base https://your-sync-server");

  let health = null;
  if (!args.skipHealth) {
    health = await readJson(`${base}/api/health`);
    if (!health.ok) throw new Error(`${base}/api/health is not ok`);
  }

  fs.writeFileSync(syncApiBaseFile, `${base}\n`, "utf8");
  run(nodePath, [path.join(projectRoot, "scripts", "build-dashboard.cjs")], {
    ...process.env,
    PUBLIC_SYNC_API_BASE: base,
  });
  if (args.publish) {
    run(nodePath, [path.join(projectRoot, "scripts", "publish-github-pages.cjs")], {
      ...process.env,
      PUBLIC_SYNC_API_BASE: base,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicSyncApiBase: base,
        health: health
          ? {
              ok: health.ok,
              ready: health.ready,
              missingConfig: health.missingConfig || [],
              checkedAt: health.checkedAt || "",
            }
          : null,
        published: args.publish,
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
