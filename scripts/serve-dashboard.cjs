const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const distDir = path.join(projectRoot, "dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8123);
const nodePath = process.execPath;
const localPackhaiTokenFile = path.join(projectRoot, ".packhai-token.local");
const localSyncKeyFile = path.join(projectRoot, ".sync-key.local");
const localFlowProfile =
  process.env.FLOW_PROFILE ||
  (fs.existsSync(path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada"))
    ? path.join(workspaceRoot, ".codex-seller-browser-session-vatfix-lazada")
    : path.join(projectRoot, "browser-profiles", "flowaccount"));
const publishGithub = process.env.SYNC_PUBLISH_GITHUB !== "0";
const extraAllowedOrigins = String(process.env.SYNC_ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const syncState = {
  running: false,
  type: null,
  startedAt: null,
  finishedAt: null,
  ok: null,
  warning: false,
  message: "พร้อม Sync",
  steps: [],
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function readSyncApiKey() {
  if (process.env.SYNC_API_KEY) return process.env.SYNC_API_KEY.trim();
  try {
    return fs.readFileSync(localSyncKeyFile, "utf8").trim();
  } catch {
    return "";
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed =
    /^https:\/\/pongsathornkit-cmd\.github\.io$/i.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin) ||
    extraAllowedOrigins.includes(origin.replace(/\/+$/, ""));
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Key");
}

function syncAuthorized(req, res) {
  const syncApiKey = readSyncApiKey();
  if (!syncApiKey) return true;
  if (String(req.headers["x-sync-key"] || "") === syncApiKey) return true;
  sendJson(res, 401, { ok: false, message: "Unauthorized Sync key" });
  return false;
}

function packhaiConfigured() {
  if (process.env.PACKHAI_AUTH_TOKEN) return true;
  try {
    return fs.readFileSync(localPackhaiTokenFile, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function flowaccountConfigured() {
  return Boolean(process.env.FLOW_PROFILE) || fs.existsSync(localFlowProfile);
}

function publicSyncState(extra = {}) {
  return {
    ...syncState,
    ...extra,
    config: {
      packhaiConfigured: packhaiConfigured(),
      flowaccountConfigured: flowaccountConfigured(),
    },
  };
}

function summarizeOutput(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= 10) return lines.join("\n").slice(0, 1200);
  return [lines[0], "...", ...lines.slice(-8)].join("\n").slice(0, 1200);
}

function runCommand(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const step = {
        name,
        code,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: summarizeOutput(stdout),
        error: summarizeOutput(stderr),
      };
      if (code === 0) resolve(step);
      else reject(Object.assign(new Error(`${name} failed with exit code ${code}`), { step }));
    });
  });
}

async function pushStep(promise) {
  try {
    const step = await promise;
    syncState.steps.push(step);
    return step;
  } catch (error) {
    if (error.step) syncState.steps.push(error.step);
    throw error;
  }
}

async function pushOptionalStep(promise, errors) {
  try {
    return await pushStep(promise);
  } catch (error) {
    errors.push(error.message || String(error));
    return null;
  }
}

function sellerWarningMessage(error) {
  const message = error.message || String(error);
  const detail = `${error.step?.error || ""} ${error.step?.output || ""}`;
  if (/Lazada Seller Center is not logged in/i.test(detail)) {
    return "ข้าม Lazada Seller เพราะ session ในเครื่องหลักหมดอายุหรือยังไม่ได้ login ระบบใช้ข้อมูล Lazada ล่าสุดที่มีอยู่ใน dashboard แทน";
  }
  if (/Shopee/i.test(message) && /login|logged in|sign in/i.test(detail)) {
    return "ข้าม Shopee Seller เพราะ session ในเครื่องหลักหมดอายุหรือยังไม่ได้ login ระบบใช้ข้อมูล Shopee ล่าสุดที่มีอยู่ใน dashboard แทน";
  }
  return message;
}

async function pushWarningStep(promise, warnings) {
  try {
    return await pushStep(promise);
  } catch (error) {
    warnings.push(sellerWarningMessage(error));
    return null;
  }
}

async function runBuild() {
  return pushStep(runCommand("Build dashboard", nodePath, [path.join(projectRoot, "scripts", "build-dashboard.cjs")], projectRoot));
}

async function runPublishGithub() {
  if (!publishGithub) {
    syncState.steps.push({
      name: "Publish GitHub Pages",
      code: null,
      skipped: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      output: "",
      error: "SYNC_PUBLISH_GITHUB=0",
    });
    return null;
  }
  return runCommand("Publish GitHub Pages", nodePath, [path.join(projectRoot, "scripts", "publish-github-pages.cjs")], projectRoot);
}

async function runSync(type) {
  syncState.running = true;
  syncState.type = type;
  syncState.startedAt = new Date().toISOString();
  syncState.finishedAt = null;
  syncState.ok = null;
  syncState.warning = false;
  syncState.message = "กำลัง Sync...";
  syncState.steps = [];

  try {
    const errors = [];
    const warnings = [];
    const runPackhai = () =>
      runCommand("Sync Packhai stock", nodePath, [path.join(projectRoot, "scripts", "sync-packhai-stock.cjs")], projectRoot);
    const runFlowaccount = () =>
      runCommand("Sync FlowAccount stock", nodePath, [path.join(projectRoot, "scripts", "sync-flowaccount-stock.cjs")], projectRoot);
    const runShopee = () =>
      runCommand("Sync Shopee Seller", nodePath, [path.join(projectRoot, "scripts", "export-shopee-products.cjs")], projectRoot);
    const runLazada = () =>
      runCommand("Sync Lazada Seller", nodePath, [path.join(projectRoot, "scripts", "export-lazada-products.cjs")], projectRoot);

    if (type === "all") {
      if (packhaiConfigured()) {
        await pushOptionalStep(runPackhai(), errors);
      } else {
        warnings.push("ข้าม Packhai เพราะยังไม่มี PACKHAI_AUTH_TOKEN");
        syncState.steps.push({
          name: "Sync Packhai stock",
          code: null,
          skipped: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          output: "",
          error: "PACKHAI_AUTH_TOKEN is not configured.",
        });
      }
      if (flowaccountConfigured()) {
        await pushOptionalStep(runFlowaccount(), errors);
      } else {
        warnings.push("ข้าม FlowAccount เพราะยังไม่พบ browser session สำหรับ FlowAccount");
        syncState.steps.push({
          name: "Sync FlowAccount stock",
          code: null,
          skipped: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          output: "",
          error: "FlowAccount browser session is not configured.",
        });
      }
      const shopeeStep = await pushWarningStep(runShopee(), warnings);
      const lazadaStep = await pushWarningStep(runLazada(), warnings);
      if (!shopeeStep && !lazadaStep) {
        errors.push("Sync ราคา Seller ไม่สำเร็จทั้ง Shopee และ Lazada");
      }
    } else if (type === "packhai") {
      if (!packhaiConfigured()) {
        syncState.steps.push({
          name: "Sync Packhai stock",
          code: null,
          skipped: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          output: "",
          error: "PACKHAI_AUTH_TOKEN is not configured.",
        });
        syncState.ok = false;
        syncState.warning = true;
        syncState.message = "ยัง Sync คลัง Packhai ไม่ได้: ต้องตั้งค่า PACKHAI_AUTH_TOKEN ก่อน";
        return;
      }
      await pushStep(runPackhai());
    } else if (type === "flowaccount") {
      if (!flowaccountConfigured()) {
        syncState.steps.push({
          name: "Sync FlowAccount stock",
          code: null,
          skipped: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          output: "",
          error: "FlowAccount browser session is not configured.",
        });
        syncState.ok = false;
        syncState.warning = true;
        syncState.message = "ยัง Sync คลัง FlowAccount ไม่ได้: ต้อง login FlowAccount ใน browser session ก่อน";
        return;
      }
      await pushStep(runFlowaccount());
    } else if (type === "seller") {
      const shopeeStep = await pushWarningStep(runShopee(), warnings);
      const lazadaStep = await pushWarningStep(runLazada(), warnings);
      if (!shopeeStep && !lazadaStep) {
        throw new Error("Sync ราคา Seller ไม่สำเร็จทั้ง Shopee และ Lazada");
      }
    }

    await runBuild();
    await pushOptionalStep(runPublishGithub(), errors);
    syncState.warning = warnings.length > 0 && errors.length === 0;
    syncState.ok = errors.length === 0;
    syncState.message = errors.length
      ? `Sync บางส่วนไม่สำเร็จ: ${errors.join(" | ")}`
      : warnings.length
      ? `Sync ข้อมูลที่พร้อมใช้งานสำเร็จ และ rebuild dashboard แล้ว · ${warnings.join(" | ")}`
      : "Sync สำเร็จ";
  } catch (error) {
    syncState.ok = false;
    syncState.warning = false;
    syncState.message = error.message || "Sync ไม่สำเร็จ";
  } finally {
    syncState.running = false;
    syncState.finishedAt = new Date().toISOString();
  }
}

function startSync(type, res) {
  if (syncState.running) {
    sendJson(res, 409, publicSyncState({ message: "มีงาน Sync กำลังทำงานอยู่" }));
    return;
  }
  runSync(type);
  sendJson(res, 202, publicSyncState());
}

function resolveRequestPath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, `http://${host}:${port}`).pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(distDir, requested);
  if (!filePath.startsWith(distDir)) return null;
  return filePath;
}

const server = http.createServer((req, res) => {
  applyCors(req, res);
  const url = new URL(req.url || "/", `http://${host}:${port}`);

  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sync/status") {
    if (!syncAuthorized(req, res)) return;
    sendJson(res, 200, publicSyncState());
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/sync/")) {
    if (!syncAuthorized(req, res)) return;
    const type = url.pathname.split("/").pop();
    if (!["packhai", "flowaccount", "seller", "all"].includes(type)) {
      sendJson(res, 404, { ok: false, message: "Unknown sync type" });
      return;
    }
    startSync(type, res);
    return;
  }

  const filePath = resolveRequestPath(req.url || "/");
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }

    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, data, contentType);
  });
});

server.listen(port, host, () => {
  console.log(`Packhai dashboard website: http://${host}:${port}/`);
});
