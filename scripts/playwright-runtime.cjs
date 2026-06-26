const fs = require("fs");
const { createRequire } = require("module");

function loadPlaywright() {
  const localCandidates = [
    "C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/node_modules/",
    "C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/",
  ];

  for (const candidate of localCandidates) {
    try {
      return createRequire(candidate)("playwright-core");
    } catch {}
  }

  try {
    return require("playwright");
  } catch {}

  return require("playwright-core");
}

function existingChromePath() {
  const candidates = [
    process.env.CHROME_EXE,
    "C:/Users/ASUS/AppData/Local/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function chromiumOptions(extra = {}) {
  const executablePath = existingChromePath();
  return executablePath ? { ...extra, executablePath } : extra;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

module.exports = {
  ...loadPlaywright(),
  boolEnv,
  chromiumOptions,
  existingChromePath,
};
