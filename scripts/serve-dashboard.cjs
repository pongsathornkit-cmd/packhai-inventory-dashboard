const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium, chromiumOptions } = require("./playwright-runtime.cjs");
const {
  appendExpense,
  cancelExpense,
  findExpense,
  readExpenseStore,
  renderExpensesCsv,
  renderPaymentVoucherHtml,
  renderWithholdingCertificateHtml,
  summarizeExpenses,
} = require("./expense-core.cjs");
const {
  assistantSystemPrompt,
  buildAssistantContext,
  parseExpenseDraft,
  runRuleAssistant,
} = require("./assistant-core.cjs");
const { applyGithubStockUpdate, sanitizeStockUpdatePayload } = require("./github-stock-core.cjs");
const {
  createAutoSyncSettings,
  createSellerPaymentsAutoSyncSettings,
  publicAutoSyncState,
} = require("./auto-sync-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const dashboardDataFile = path.join(distDir, "inventory-valuation-data.json");
const dataDir = process.env.PACKHAI_DATA_DIR ? path.resolve(process.env.PACKHAI_DATA_DIR) : path.join(projectRoot, "data");
const expensesFile = path.join(dataDir, "expenses.json");
const flowaccountSnapshotFile = path.join(dataDir, "flowaccount_stock_selected_warehouses.json");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8123);
const nodePath = process.execPath;
const localPackhaiTokenFile = path.join(projectRoot, ".packhai-token.local");
const localSyncKeyFile = path.join(projectRoot, ".sync-key.local");
const authStateDir = process.env.PACKHAI_AUTH_STATE_DIR
  ? path.resolve(process.env.PACKHAI_AUTH_STATE_DIR)
  : path.join(projectRoot, "storage-states");
const publishSupabase = process.env.SYNC_PUBLISH_SUPABASE !== "0";
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
const autoSyncSettings = createAutoSyncSettings(process.env);
const autoSyncState = {
  timer: null,
  nextRunAt: null,
  lastRunAt: null,
  lastFinishedAt: null,
  lastSkippedAt: null,
  lastSkipReason: "",
  lastOk: null,
};
const sellerPaymentsAutoSyncSettings = createSellerPaymentsAutoSyncSettings(process.env);
const sellerPaymentsAutoSyncState = {
  timer: null,
  nextRunAt: null,
  lastRunAt: null,
  lastFinishedAt: null,
  lastSkippedAt: null,
  lastSkipReason: "",
  lastOk: null,
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

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readSyncApiKey() {
  if (!syncKeyRequired()) return "";
  if (process.env.SYNC_API_KEY) return process.env.SYNC_API_KEY.trim();
  try {
    return fs.readFileSync(localSyncKeyFile, "utf8").trim();
  } catch {
    return "";
  }
}

function syncKeyRequired() {
  return /^(1|true|yes|on)$/i.test(String(process.env.SYNC_REQUIRE_KEY || ""));
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed =
    /^https:\/\/pongsathornkit-cmd\.github\.io$/i.test(origin) ||
    /^https:\/\/fabfhzcsppniuwtdwvfg\.functions\.supabase\.co$/i.test(origin) ||
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

function websiteStockConfigured() {
  return fs.existsSync(flowaccountSnapshotFile);
}

function flowaccountConfigured() {
  return websiteStockConfigured();
}

function supabaseBaseUrl() {
  const explicitUrl = String(process.env.SUPABASE_URL || process.env.SUPABASE_REST_URL || "").trim().replace(/\/+$/, "");
  if (explicitUrl) return explicitUrl.replace(/\/rest\/v1$/i, "");
  const projectId = String(process.env.SUPABASE_PROJECT_ID || "").trim();
  return projectId ? `https://${projectId}.supabase.co` : "";
}

function supabaseApiKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function supabaseWriteKey() {
  if (process.env.SUPABASE_WRITE_KEY) return process.env.SUPABASE_WRITE_KEY.trim();
  if (process.env.SYNC_DB_WRITE_KEY) return process.env.SYNC_DB_WRITE_KEY.trim();
  try {
    return fs.readFileSync(localSyncKeyFile, "utf8").trim();
  } catch {
    return "";
  }
}

function supabaseConfigured() {
  return Boolean(supabaseBaseUrl() && supabaseApiKey());
}

function supabasePublishConfigured() {
  return Boolean(supabaseConfigured() && supabaseWriteKey());
}

function storageStateConfigured(kind) {
  const key = String(kind || "").trim().toUpperCase();
  if (!key) return false;
  if (String(process.env[`${key}_STORAGE_STATE_B64`] || "").trim()) return true;
  if (String(process.env[`${key}_STORAGE_STATE_JSON`] || "").trim()) return true;
  const envFile = String(process.env[`${key}_STORAGE_STATE_FILE`] || "").trim();
  if (envFile && fs.existsSync(path.resolve(envFile))) return true;
  return fs.existsSync(path.join(authStateDir, `${key.toLowerCase()}.json`));
}

function shopeeAuthConfigured() {
  return storageStateConfigured("shopee") || Boolean(process.env.SHOPEE_SESSION_DIR);
}

function lazadaAuthConfigured() {
  return storageStateConfigured("lazada") || Boolean(process.env.SELLER_SESSION_DIR);
}

function sellerPaymentsConfigured() {
  return shopeeAuthConfigured() || lazadaAuthConfigured();
}

function syncReadiness() {
  const config = {
    packhaiConfigured: packhaiConfigured(),
    flowaccountConfigured: flowaccountConfigured(),
    websiteStockConfigured: websiteStockConfigured(),
    shopeeAuthConfigured: shopeeAuthConfigured(),
    lazadaAuthConfigured: lazadaAuthConfigured(),
    supabaseConfigured: supabaseConfigured(),
    supabasePublishConfigured: supabasePublishConfigured(),
    syncKeyRequired: syncKeyRequired(),
  };
  const missing = [];
  if (!config.packhaiConfigured) missing.push("PACKHAI_AUTH_TOKEN");
  if (!config.websiteStockConfigured) missing.push("WEBSITE_STOCK_SNAPSHOT");
  if (!config.shopeeAuthConfigured) missing.push("SHOPEE_STORAGE_STATE_B64");
  if (!config.lazadaAuthConfigured) missing.push("LAZADA_STORAGE_STATE_B64");
  if (!config.supabaseConfigured) missing.push("SUPABASE_URL + SUPABASE_ANON_KEY");
  if (config.supabaseConfigured && !config.supabasePublishConfigured && publishSupabase) {
    missing.push("SUPABASE_WRITE_KEY");
  }
  if (config.syncKeyRequired) missing.push("SYNC_REQUIRE_KEY=0");
  return {
    ready: missing.length === 0,
    missing,
    config,
  };
}

function publicSyncState(extra = {}) {
  const readiness = syncReadiness();
  return {
    ...syncState,
    ...extra,
    config: {
      ...readiness.config,
      flowaccountSource: "website-stock",
    },
    ready: readiness.ready,
    missingConfig: readiness.missing,
    autoSync: publicAutoSyncState(autoSyncSettings, autoSyncState),
    autoSyncJobs: {
      packhai: publicAutoSyncState(autoSyncSettings, autoSyncState),
      sellerPayments: publicAutoSyncState(sellerPaymentsAutoSyncSettings, sellerPaymentsAutoSyncState),
    },
  };
}

function publicExpenseState(options = {}) {
  const store = readExpenseStore(expensesFile);
  const month = options.month || new Date().toISOString().slice(0, 7);
  return {
    ok: true,
    updatedAt: store.updatedAt || "",
    month,
    summary: summarizeExpenses(store.expenses, { month }),
    pnd3Summary: summarizeExpenses(store.expenses, { month, pndType: "PND3" }),
    pnd53Summary: summarizeExpenses(store.expenses, { month, pndType: "PND53" }),
    expenses: store.expenses || [],
  };
}

async function renderPdf(html) {
  const browser = await chromium.launch({
    ...chromiumOptions(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
  } finally {
    await browser.close();
  }
}

function expenseById(id) {
  const store = readExpenseStore(expensesFile);
  return { store, record: findExpense(store, id) };
}

function readDashboardData() {
  try {
    return JSON.parse(fs.readFileSync(dashboardDataFile, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { summary: {}, rows: [] };
  }
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" || content.type === "text") parts.push(content.text || "");
    }
  }
  return parts.join("\n").trim();
}

function sanitizeAssistantAction(action) {
  if (!action || typeof action !== "object") return null;
  if (action.type === "navigate") {
    return {
      type: "navigate",
      label: String(action.label || "เปิดหน้า").slice(0, 80),
      hash: String(action.hash || "").replace(/^#/, "").slice(0, 80),
    };
  }
  if (action.type === "filterInventory") {
    return {
      type: "filterInventory",
      label: String(action.label || "กรองตาราง").slice(0, 80),
      query: String(action.query || "").slice(0, 120),
      sort: ["valueDesc", "qtyDesc", "priceDesc", "movementDesc", "nameAsc", "sourceAsc"].includes(action.sort)
        ? action.sort
        : "valueDesc",
      warehouseName: String(action.warehouseName || "").slice(0, 80),
      hash: "inventory-detail",
    };
  }
  if (action.type === "fillExpenseForm") {
    const payload =
      action.payload && typeof action.payload === "object"
        ? {
            ...parseExpenseDraft(action.payload.sourceText || action.payload.notes || ""),
            ...action.payload,
            status: "posted",
          }
        : parseExpenseDraft("");
    return {
      type: "fillExpenseForm",
      label: String(action.label || "เติมฟอร์มค่าใช้จ่าย").slice(0, 80),
      payload: {
        paymentDate: String(payload.paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
        recipientType: payload.recipientType === "individual" ? "individual" : "company",
        recipientName: String(payload.recipientName || "").slice(0, 160),
        recipientTaxId: String(payload.recipientTaxId || "").slice(0, 40),
        recipientAddress: String(payload.recipientAddress || "").slice(0, 240),
        category: String(payload.category || "ค่าใช้จ่ายทั่วไป").slice(0, 80),
        description: String(payload.description || payload.category || "ค่าใช้จ่าย").slice(0, 160),
        invoiceNo: String(payload.invoiceNo || "").slice(0, 80),
        amountInput: Number(payload.amountInput || 0),
        amountMode: payload.amountMode === "inclusive" ? "inclusive" : "exclusive",
        vatMode: ["vat7", "none", "exempt"].includes(payload.vatMode) ? payload.vatMode : "none",
        whtRate: [0, 1, 2, 3, 5].includes(Number(payload.whtRate)) ? Number(payload.whtRate) : 0,
        notes: String(payload.notes || "").slice(0, 240),
        status: "posted",
      },
    };
  }
  if (action.type === "stockUpdate") {
    try {
      const payload = sanitizeStockUpdatePayload(action.payload || action);
      return {
        type: "stockUpdate",
        label: String(action.label || "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock").slice(0, 80),
        payload,
      };
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeAssistantResponse(result, source) {
  const actions = Array.isArray(result?.actions)
    ? result.actions.map(sanitizeAssistantAction).filter(Boolean).slice(0, 4)
    : [];
  return {
    ok: true,
    source,
    reply: String(result?.reply || "ยังไม่พบคำตอบที่เหมาะสม").slice(0, 3000),
    actions,
  };
}

async function callOpenAIAssistant(message, context) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: assistantSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            message,
            context,
          }),
        },
      ],
      max_output_tokens: 900,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI status ${response.status}`);
  const data = await response.json();
  const text = extractOpenAIText(data);
  return JSON.parse(text);
}

async function runAssistant(message) {
  const context = buildAssistantContext(readDashboardData(), readExpenseStore(expensesFile));
  const ruleResult = runRuleAssistant(message, context);
  if ((ruleResult.actions || []).some((action) => action?.type === "stockUpdate")) {
    return sanitizeAssistantResponse(ruleResult, "rule");
  }
  if (!process.env.OPENAI_API_KEY) return sanitizeAssistantResponse(ruleResult, "rule");
  try {
    const aiResult = await callOpenAIAssistant(message, context);
    return sanitizeAssistantResponse(aiResult, "openai");
  } catch (error) {
    const fallback = sanitizeAssistantResponse(ruleResult, "rule");
    fallback.warning = `AI fallback: ${error.message}`;
    return fallback;
  }
}

function stockUpdateResultMessage(result, publishStep) {
  const lines = (result.allocations || [])
    .map(
      (item) =>
        `- ${item.warehouseName}: ${Number(item.beforeQuantity || 0).toLocaleString("th-TH")} -> ${Number(
          item.afterQuantity || 0
        ).toLocaleString("th-TH")} \u0e2b\u0e19\u0e48\u0e27\u0e22`
    )
    .join("\n");
  const published = publishStep?.code === 0 ? "\u0e2a\u0e48\u0e07\u0e02\u0e36\u0e49\u0e19 Supabase \u0e41\u0e25\u0e49\u0e27" : "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e43\u0e19 server \u0e41\u0e25\u0e49\u0e27";
  return `\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 stock SKU ${result.sku} \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08\n${lines}\n${published} \u0e23\u0e2d\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e27\u0e47\u0e1a\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48\u0e41\u0e25\u0e49\u0e27 refresh`;
}

async function saveGithubStockUpdate(body) {
  const payload = sanitizeStockUpdatePayload(body.payload || body);
  const result = applyGithubStockUpdate(flowaccountSnapshotFile, payload);
  const buildStep = await runCommand("Build dashboard", nodePath, [path.join(projectRoot, "scripts", "build-dashboard.cjs")], projectRoot);
  const publishStep = await runPublishSupabase();
  return {
    ok: true,
    result,
    buildStep,
    publishStep,
    message: stockUpdateResultMessage(result, publishStep),
  };
}

async function callSupabaseStockAdjustment(payload) {
  const baseUrl = supabaseBaseUrl();
  const apiKey = supabaseApiKey();
  if (!baseUrl || !apiKey) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the sync server.");
  }
  const createdAt = new Date().toISOString();
  const response = await fetch(`${baseUrl}/rest/v1/rpc/adjust_website_stock`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_payload: {
        ...payload,
        createdAt,
      },
    }),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error_description || data.hint || `Supabase status ${response.status}`);
  }
  return data;
}

async function saveSupabaseStockUpdate(body) {
  const payload = sanitizeStockUpdatePayload(body.payload || body);
  if (!supabaseConfigured()) return saveGithubStockUpdate(payload);

  const supabaseResult = await callSupabaseStockAdjustment(payload);
  let mirrorResult = null;
  try {
    mirrorResult = applyGithubStockUpdate(flowaccountSnapshotFile, payload);
  } catch (error) {
    mirrorResult = { ok: false, message: `Local dashboard mirror failed: ${error.message}` };
  }
  const buildStep = await runCommand("Build dashboard", nodePath, [path.join(projectRoot, "scripts", "build-dashboard.cjs")], projectRoot);
  const publishStep = await runPublishSupabase();
  return {
    ok: true,
    storage: "supabase",
    result: supabaseResult.result || supabaseResult,
    mirrorResult,
    buildStep,
    publishStep,
    message: supabaseResult.message || stockUpdateResultMessage(mirrorResult || {}, publishStep),
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

function commandTimeoutMs(name) {
  const specific =
    /seller order payments/i.test(name)
      ? process.env.SELLER_PAYMENTS_TIMEOUT_MS
      : /shopee|lazada/i.test(name)
      ? process.env.SELLER_SYNC_TIMEOUT_MS
      : "";
  const parsed = Number(specific || process.env.SYNC_COMMAND_TIMEOUT_MS || 10 * 60 * 1000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

function runCommand(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const timeoutMs = commandTimeoutMs(name);
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr += `\n${name} timed out after ${Math.round(timeoutMs / 1000)} seconds.`;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const step = {
        name,
        code: timedOut ? 124 : code,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: summarizeOutput(stdout),
        error: summarizeOutput(stderr),
      };
      if (!timedOut && code === 0) resolve(step);
      else reject(Object.assign(new Error(timedOut ? `${name} timed out` : `${name} failed with exit code ${code}`), { step }));
    });
  });
}

async function pushStep(promise) {
  try {
    const step = await promise;
    if (step) syncState.steps.push(step);
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

async function runPublishSupabase() {
  if (!publishSupabase) {
    syncState.steps.push({
      name: "Publish Supabase app",
      code: null,
      skipped: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      output: "",
      error: "SYNC_PUBLISH_SUPABASE=0",
    });
    return null;
  }
  return runCommand("Publish Supabase app", nodePath, [path.join(projectRoot, "scripts", "publish-supabase-app.cjs")], projectRoot);
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
    const runWebsiteStockSnapshot = () =>
      runCommand("Use Website stock snapshot", nodePath, [path.join(projectRoot, "scripts", "use-website-stock-snapshot.cjs")], projectRoot);
    const runSupabaseWebsiteStock = () =>
      runCommand(
        "Sync Supabase Website Stock",
        nodePath,
        [path.join(projectRoot, "scripts", "export-supabase-website-stock.cjs")],
        projectRoot
      );
    const runWebsiteStock = () => (supabaseConfigured() ? runSupabaseWebsiteStock() : runWebsiteStockSnapshot());
    const runShopee = () =>
      runCommand("Sync Shopee Seller", nodePath, [path.join(projectRoot, "scripts", "export-shopee-products.cjs")], projectRoot);
    const runLazada = () =>
      runCommand("Sync Lazada Seller", nodePath, [path.join(projectRoot, "scripts", "export-lazada-products.cjs")], projectRoot);
    const runSellerPayments = () =>
      runCommand(
        "Sync Seller order payments",
        nodePath,
        [path.join(projectRoot, "scripts", "export-seller-order-payments.cjs")],
        projectRoot
      );

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
      await pushOptionalStep(runWebsiteStock(), errors);
      const shopeeStep = await pushWarningStep(runShopee(), warnings);
      const lazadaStep = await pushWarningStep(runLazada(), warnings);
      if (shopeeStep || lazadaStep) {
        await pushWarningStep(runSellerPayments(), warnings);
      } else {
        warnings.push("Skip Seller order payments because Shopee/Lazada sessions are not usable.");
      }
      if (!shopeeStep && !lazadaStep) {
        warnings.push("Sync ราคา Seller ไม่สำเร็จทั้ง Shopee และ Lazada ใช้ราคาล่าสุดที่มีอยู่ใน dashboard แทน");
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
      await pushStep(runWebsiteStock());
    } else if (type === "seller") {
      const shopeeStep = await pushWarningStep(runShopee(), warnings);
      const lazadaStep = await pushWarningStep(runLazada(), warnings);
      if (shopeeStep || lazadaStep) {
        await pushWarningStep(runSellerPayments(), warnings);
      }
      if (!shopeeStep && !lazadaStep) {
        throw new Error("Sync ราคา Seller ไม่สำเร็จทั้ง Shopee และ Lazada");
      }
    } else if (type === "seller-payments") {
      await pushStep(runSellerPayments());
    }

    await runBuild();
    await pushOptionalStep(runPublishSupabase(), errors);
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

function autoSyncJobDefinitions() {
  return [
    {
      key: "packhai",
      label: "Packhai",
      settings: autoSyncSettings,
      state: autoSyncState,
      configured: packhaiConfigured,
      missingReason: "PACKHAI_AUTH_TOKEN is not configured.",
    },
    {
      key: "sellerPayments",
      label: "Platform payments",
      settings: sellerPaymentsAutoSyncSettings,
      state: sellerPaymentsAutoSyncState,
      configured: sellerPaymentsConfigured,
      missingReason: "Shopee/Lazada Seller sessions are not configured.",
    },
  ];
}

function scheduleNextAutoSync(job, delayMs = job.settings.intervalMs) {
  if (!job.settings.enabled) return;
  if (job.state.timer) clearTimeout(job.state.timer);
  const safeDelayMs = Math.max(0, Number(delayMs || 0));
  job.state.nextRunAt = new Date(Date.now() + safeDelayMs).toISOString();
  job.state.timer = setTimeout(() => runAutoSync(job), safeDelayMs);
  if (typeof job.state.timer.unref === "function") job.state.timer.unref();
}

function skipAutoSync(job, reason) {
  job.state.lastSkippedAt = new Date().toISOString();
  job.state.lastSkipReason = reason;
  job.state.lastOk = null;
  console.warn(`${job.label} auto sync skipped: ${reason}`);
}

async function runAutoSync(job) {
  job.state.timer = null;
  job.state.nextRunAt = null;
  job.state.lastRunAt = new Date().toISOString();

  if (!job.settings.enabled) return;
  if (!job.configured()) {
    skipAutoSync(job, job.missingReason);
    scheduleNextAutoSync(job, job.settings.intervalMs);
    return;
  }
  if (syncState.running) {
    skipAutoSync(job, "Another sync is already running.");
    scheduleNextAutoSync(job, job.settings.intervalMs);
    return;
  }

  try {
    await runSync(job.settings.type);
    job.state.lastFinishedAt = syncState.finishedAt || new Date().toISOString();
    job.state.lastOk = Boolean(syncState.ok);
  } finally {
    scheduleNextAutoSync(job, job.settings.intervalMs);
  }
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

  if (req.method === "GET" && url.pathname === "/api/health") {
    const readiness = syncReadiness();
    sendJson(res, 200, {
      ok: true,
      service: "packhai-inventory-dashboard",
      ready: readiness.ready,
      missingConfig: readiness.missing,
      syncRunning: syncState.running,
      checkedAt: new Date().toISOString(),
    });
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
    if (!["packhai", "flowaccount", "seller", "seller-payments", "all"].includes(type)) {
      sendJson(res, 404, { ok: false, message: "Unknown sync type" });
      return;
    }
    startSync(type, res);
    return;
  }

  if (url.pathname === "/api/expenses" && req.method === "GET") {
    if (!syncAuthorized(req, res)) return;
    sendJson(res, 200, publicExpenseState({ month: url.searchParams.get("month") || "" }));
    return;
  }

  if (url.pathname === "/api/expenses" && req.method === "POST") {
    if (!syncAuthorized(req, res)) return;
    readJsonBody(req)
      .then((body) => {
        const record = appendExpense(expensesFile, body);
        sendJson(res, 201, { ...publicExpenseState({ month: record.paymentDate.slice(0, 7) }), record });
      })
      .catch((error) => sendJson(res, /required|greater|valid/i.test(error.message) ? 400 : 500, { ok: false, message: error.message }));
    return;
  }

  if (url.pathname === "/api/expenses/export.csv" && req.method === "GET") {
    if (!syncAuthorized(req, res)) return;
    const store = readExpenseStore(expensesFile);
    const csv = renderExpensesCsv(store.expenses, {
      pndType: url.searchParams.get("pndType") || "",
      month: url.searchParams.get("month") || "",
    });
    send(res, 200, `\uFEFF${csv}`, "text/csv; charset=utf-8");
    return;
  }

  const expensePdfMatch = url.pathname.match(/^\/api\/expenses\/([^/]+)\/(payment-voucher|wht-certificate)\.pdf$/);
  if (expensePdfMatch && req.method === "GET") {
    if (!syncAuthorized(req, res)) return;
    const [, id, docType] = expensePdfMatch;
    const { record } = expenseById(id);
    if (!record) {
      sendJson(res, 404, { ok: false, message: "Expense was not found." });
      return;
    }
    if (docType === "wht-certificate" && Number(record.withholdingAmount || 0) <= 0) {
      sendJson(res, 400, { ok: false, message: "This expense has no withholding tax." });
      return;
    }
    const html = docType === "payment-voucher" ? renderPaymentVoucherHtml(record) : renderWithholdingCertificateHtml(record);
    renderPdf(html)
      .then((pdf) => {
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${docType}-${record.expenseNo}.pdf"`,
          "Cache-Control": "no-store",
        });
        res.end(pdf);
      })
      .catch((error) => sendJson(res, 500, { ok: false, message: `PDF generation failed: ${error.message}` }));
    return;
  }

  const expenseCancelMatch = url.pathname.match(/^\/api\/expenses\/([^/]+)\/cancel$/);
  if (expenseCancelMatch && req.method === "POST") {
    if (!syncAuthorized(req, res)) return;
    try {
      const record = cancelExpense(expensesFile, expenseCancelMatch[1]);
      sendJson(res, 200, { ...publicExpenseState({ month: record.paymentDate.slice(0, 7) }), record });
    } catch (error) {
      sendJson(res, 404, { ok: false, message: error.message });
    }
    return;
  }

  if (url.pathname === "/api/assistant" && req.method === "POST") {
    if (!syncAuthorized(req, res)) return;
    readJsonBody(req)
      .then((body) => runAssistant(String(body.message || "")))
      .then((result) => sendJson(res, 200, result))
      .catch((error) => sendJson(res, 500, { ok: false, message: error.message }));
    return;
  }

  if ((url.pathname === "/api/github-stock/adjust" || url.pathname === "/api/supabase-stock/adjust") && req.method === "POST") {
    if (!syncAuthorized(req, res)) return;
    readJsonBody(req)
      .then(saveSupabaseStockUpdate)
      .then((result) => sendJson(res, 200, result))
      .catch((error) => sendJson(res, /needs|valid|quantity|warehouse/i.test(error.message) ? 400 : 500, { ok: false, message: error.message }));
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
  for (const job of autoSyncJobDefinitions()) {
    scheduleNextAutoSync(job, job.settings.startDelayMs);
    if (job.settings.enabled) {
      console.log(`${job.label} auto sync enabled every ${job.settings.intervalMinutes} minutes.`);
    }
  }
});
