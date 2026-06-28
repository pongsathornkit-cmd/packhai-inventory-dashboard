const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const stateKinds = ["SHOPEE", "LAZADA", "FLOWACCOUNT"];

function authStateDir(env = process.env) {
  return env.PACKHAI_AUTH_STATE_DIR
    ? path.resolve(env.PACKHAI_AUTH_STATE_DIR)
    : path.join(projectRoot, "storage-states");
}

function decodeState(kind, env) {
  const jsonKey = `${kind}_STORAGE_STATE_JSON`;
  const b64Key = `${kind}_STORAGE_STATE_B64`;
  const json = String(env[jsonKey] || "").trim();
  if (json) return json;
  const b64 = String(env[b64Key] || "").trim();
  if (!b64) return "";
  return Buffer.from(b64, "base64").toString("utf8");
}

function materializeStorageStateEnv(env = process.env, outputDir = authStateDir(env)) {
  const written = [];
  fs.mkdirSync(outputDir, { recursive: true });

  for (const kind of stateKinds) {
    const fileKey = `${kind}_STORAGE_STATE_FILE`;
    const jsonKey = `${kind}_STORAGE_STATE_JSON`;
    const b64Key = `${kind}_STORAGE_STATE_B64`;
    const stateText = decodeState(kind, env);
    if (!stateText) continue;

    const parsed = JSON.parse(stateText);
    const file = path.join(outputDir, `${kind.toLowerCase()}.json`);
    fs.writeFileSync(file, JSON.stringify(parsed), "utf8");
    env[fileKey] = file;
    delete env[jsonKey];
    delete env[b64Key];
    written.push({ kind: kind.toLowerCase(), file, bytes: Buffer.byteLength(stateText, "utf8") });
  }

  return written;
}

if (require.main === module) {
  const written = materializeStorageStateEnv();
  console.log(
    JSON.stringify(
      {
        ok: true,
        written: written.map((item) => ({ kind: item.kind, file: item.file, bytes: item.bytes })),
      },
      null,
      2
    )
  );
}

module.exports = {
  authStateDir,
  materializeStorageStateEnv,
};
