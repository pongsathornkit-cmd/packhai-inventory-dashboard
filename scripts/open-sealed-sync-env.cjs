const fs = require("fs");
const path = require("path");

const { readSealedFile } = require("./sealed-env-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const defaultInput = path.join(projectRoot, ".github", "sync-secrets", "cloud-sync.env.enc");
const defaultOutput = path.join(projectRoot, ".tmp", "github-actions-sync.env");

function parseArgs(argv) {
  const args = {
    input: defaultInput,
    output: defaultOutput,
    passphrase: process.env.PACKHAI_SYNC_ENV_PASSPHRASE || "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--input") args.input = path.resolve(argv[++i] || defaultInput);
    else if (item === "--output") args.output = path.resolve(argv[++i] || defaultOutput);
    else if (item === "--passphrase") args.passphrase = argv[++i] || "";
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.passphrase) throw new Error("PACKHAI_SYNC_ENV_PASSPHRASE is required.");
  const plainText = readSealedFile(args.input, args.passphrase);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, plainText, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: args.output,
        bytes: Buffer.byteLength(plainText, "utf8"),
      },
      null,
      2
    )
  );
}

main();
