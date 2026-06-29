const { normalizePublicSyncApiBase } = require("./sync-api-base-core.cjs");

const allowedSyncTypes = new Set(["all", "packhai", "flowaccount", "seller", "seller-prices", "seller-payments"]);

function parseArgs(argv) {
  const args = {
    base: process.env.PUBLIC_SYNC_API_BASE || "http://127.0.0.1:8123",
    sync: "",
    timeoutSeconds: 240,
    allowNotReady: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--base") args.base = argv[++i] || "";
    else if (item === "--sync") args.sync = argv[++i] || "";
    else if (item === "--timeout") args.timeoutSeconds = Number(argv[++i] || args.timeoutSeconds);
    else if (item === "--allow-not-ready") args.allowNotReady = true;
  }
  return args;
}

function normalizeBase(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(raw)) return raw;
  return normalizePublicSyncApiBase(raw, { source: "env" });
}

async function readJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

async function pollSync(base, timeoutSeconds) {
  const deadline = Date.now() + Math.max(5, Number(timeoutSeconds || 240)) * 1000;
  let status = null;
  while (Date.now() < deadline) {
    status = await readJson(`${base}/api/sync/status`);
    if (!status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Sync did not finish within ${timeoutSeconds} seconds.`);
}

function publicStatus(status) {
  return {
    ready: Boolean(status?.ready),
    running: Boolean(status?.running),
    ok: status?.ok ?? null,
    warning: Boolean(status?.warning),
    message: status?.message || "",
    missingConfig: Array.isArray(status?.missingConfig) ? status.missingConfig : [],
    steps: (status?.steps || []).map((step) => ({
      name: step.name,
      code: step.code ?? null,
      skipped: Boolean(step.skipped),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = normalizeBase(args.base);
  if (!base) throw new Error("Use --base https://YOUR-SYNC-SERVER or a local http://127.0.0.1:<port> URL.");
  if (args.sync && !allowedSyncTypes.has(args.sync)) {
    throw new Error(`--sync must be one of: ${[...allowedSyncTypes].join(", ")}`);
  }

  const health = await readJson(`${base}/api/health`);
  const initialStatus = await readJson(`${base}/api/sync/status`);
  if (!args.allowNotReady && !initialStatus.ready) {
    throw new Error(`Sync server is online but not ready. Missing: ${(initialStatus.missingConfig || []).join(", ")}`);
  }

  let finalStatus = null;
  if (args.sync) {
    await readJson(`${base}/api/sync/${args.sync}`, { method: "POST" });
    finalStatus = await pollSync(base, args.timeoutSeconds);
    if (finalStatus.ok === false) throw new Error(finalStatus.message || "Sync failed.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        base,
        health: {
          ok: Boolean(health.ok),
          ready: Boolean(health.ready),
          missingConfig: health.missingConfig || [],
        },
        initialStatus: publicStatus(initialStatus),
        finalStatus: finalStatus ? publicStatus(finalStatus) : null,
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
