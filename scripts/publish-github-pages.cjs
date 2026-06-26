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

function main() {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    console.log("No git repository found. Skipped GitHub Pages publish.");
    return;
  }

  const git = findGit();
  const changed = run(git, ["status", "--short", "dist"]).trim();
  if (!changed) {
    console.log("No generated dashboard changes to publish.");
    return;
  }

  run(git, ["add", "dist/index.html", "dist/inventory-valuation-data.json", "dist/packhai-inventory-valuation.csv"]);
  const commitOutput = run(git, ["commit", "-m", "Update inventory dashboard data"], true);
  if (/nothing to commit/i.test(commitOutput)) {
    console.log("No dashboard changes to commit.");
    return;
  }
  run(git, ["push"]);
  console.log("Published updated dashboard files to GitHub Pages.");
}

main();
