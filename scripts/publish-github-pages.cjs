const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

function findGit() {
  const candidates = [
    process.env.GIT_PATH,
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { cwd: projectRoot, encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("Git executable was not found.");
}

function run(git, args, allowFailure = false) {
  const result = spawnSync(git, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed\n${output}`);
  }
  return output;
}

function configureGithubPush(git) {
  run(git, ["config", "user.name", process.env.GIT_AUTHOR_NAME || "packhai-sync-bot"], true);
  run(git, ["config", "user.email", process.env.GIT_AUTHOR_EMAIL || "packhai-sync-bot@users.noreply.github.com"], true);

  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (!token) return;

  const remote = run(git, ["remote", "get-url", "origin"], true).trim();
  if (!/^https:\/\/github\.com\//i.test(remote) || remote.includes("@github.com")) return;

  const authedRemote = remote.replace(/^https:\/\/github\.com\//i, `https://x-access-token:${token}@github.com/`);
  run(git, ["remote", "set-url", "origin", authedRemote]);
}

function currentBranch(git) {
  return (
    process.env.GITHUB_REF_NAME ||
    run(git, ["branch", "--show-current"], true).trim() ||
    "main"
  );
}

function pushWithRetry(git) {
  const firstPush = run(git, ["push"], true);
  if (!/failed|rejected|error/i.test(firstPush)) return;

  const branch = currentBranch(git);
  run(git, ["fetch", "origin", branch]);
  const rebase = run(git, ["rebase", `origin/${branch}`], true);
  if (/CONFLICT|could not apply|error:/i.test(rebase)) {
    run(git, ["rebase", "--abort"], true);
    throw new Error(`git rebase origin/${branch} failed\n${rebase}`);
  }
  run(git, ["push"]);
}

function main() {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    console.log("No git repository found. Skipped GitHub Pages publish.");
    return;
  }

  const git = findGit();
  configureGithubPush(git);
  const publishPaths = [
    "dist/index.html",
    "dist/inventory-valuation-data.json",
    "dist/stock-movements.json",
    "dist/sync-status.json",
    "dist/packhai-inventory-valuation.csv",
    "data/packhai_stock.json",
    "data/flowaccount_stock_selected_warehouses.json",
    "data/seller_compare/seller_order_payments.json",
  ];
  const changed = run(git, ["status", "--short", ...publishPaths]).trim();
  if (!changed) {
    console.log("No generated dashboard changes to publish.");
    return;
  }

  run(git, ["add", ...publishPaths]);
  const commitOutput = run(git, ["commit", "-m", "Update inventory dashboard data"], true);
  if (/nothing to commit/i.test(commitOutput)) {
    console.log("No dashboard changes to commit.");
    return;
  }
  pushWithRetry(git);
  console.log("Published updated dashboard files to GitHub Pages.");
}

main();
