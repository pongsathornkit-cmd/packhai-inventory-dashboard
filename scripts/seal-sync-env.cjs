const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { formatEnvFile, parseEnvFile, writeSealedFile } = require("./sealed-env-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const defaultInput = path.join(projectRoot, ".tmp", "cloud-sync.env");
const defaultOutput = path.join(projectRoot, ".github", "sync-secrets", "cloud-sync.env.enc");
const excludedKeys = new Set(["GITHUB_TOKEN", "GH_TOKEN", "PUBLIC_SYNC_API_BASE"]);

function parseArgs(argv) {
  const args = {
    input: defaultInput,
    output: defaultOutput,
    passphrase: process.env.PACKHAI_SYNC_ENV_PASSPHRASE || "",
    generatePassphrase: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--input") args.input = path.resolve(argv[++i] || defaultInput);
    else if (item === "--output") args.output = path.resolve(argv[++i] || defaultOutput);
    else if (item === "--passphrase") args.passphrase = argv[++i] || "";
    else if (item === "--generate-passphrase") args.generatePassphrase = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = args.passphrase || (args.generatePassphrase ? crypto.randomBytes(32).toString("base64url") : "");
  if (!passphrase) throw new Error("Set PACKHAI_SYNC_ENV_PASSPHRASE or pass --generate-passphrase.");
  const inputValues = parseEnvFile(fs.readFileSync(args.input, "utf8"));
  const sealedValues = {};
  for (const [key, value] of Object.entries(inputValues)) {
    if (excludedKeys.has(key)) continue;
    if (!String(value || "")) continue;
    sealedValues[key] = value;
  }
  writeSealedFile(args.output, formatEnvFile(sealedValues), passphrase);
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: args.output,
        keyCount: Object.keys(sealedValues).length,
        excludedKeys: [...excludedKeys],
        passphraseGenerated: args.generatePassphrase && !args.passphrase,
        githubSecretName: "PACKHAI_SYNC_ENV_PASSPHRASE",
        passphrase: args.generatePassphrase && !args.passphrase ? passphrase : undefined,
      },
      null,
      2
    )
  );
}

main();
