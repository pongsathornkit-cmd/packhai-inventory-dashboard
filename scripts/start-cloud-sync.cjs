const path = require("path");
const { spawnSync } = require("child_process");

const { loadCloudEnv } = require("./cloud-env-loader.cjs");
const { materializeStorageStateEnv } = require("./materialize-auth-state-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const nodePath = process.execPath;

function runScript(scriptName) {
  const result = spawnSync(nodePath, [path.join(projectRoot, "scripts", scriptName)], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const loaded = loadCloudEnv();
  const authStates = materializeStorageStateEnv();
  if (loaded.length) {
    const summary = loaded
      .map((item) => `${item.file} (${item.keys.length} keys)`)
      .join(", ");
    console.log(`Loaded cloud env file(s): ${summary}`);
  }
  if (authStates.length) {
    const summary = authStates
      .map((item) => `${item.kind} (${item.bytes} bytes)`)
      .join(", ");
    console.log(`Materialized seller auth state file(s): ${summary}`);
  }

  runScript("seed-cloud-storage.cjs");
  runScript("build-dashboard.cjs");
  runScript("serve-dashboard.cjs");
}

main();
