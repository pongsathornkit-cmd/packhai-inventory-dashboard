const fs = require("fs");
const path = require("path");
const { buildInventorySeedSql } = require("./supabase-stock-core.cjs");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.PACKHAI_DATA_DIR ? path.resolve(process.env.PACKHAI_DATA_DIR) : path.join(projectRoot, "data");
const defaultSnapshotFile = path.join(dataDir, "flowaccount_stock_selected_warehouses.json");

function parseArgs(argv) {
  const args = {
    snapshot: defaultSnapshotFile,
    print: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--snapshot") args.snapshot = path.resolve(argv[++index] || "");
    else if (item === "--print") args.print = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(fs.readFileSync(args.snapshot, "utf8").replace(/^\uFEFF/, ""));
  const sql = buildInventorySeedSql(snapshot);
  if (args.print) {
    process.stdout.write(sql);
    return;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        snapshot: args.snapshot,
        rows: Array.isArray(snapshot.rows) ? snapshot.rows.length : 0,
        transactions: Array.isArray(snapshot.stockTransactions) ? snapshot.stockTransactions.length : 0,
      },
      null,
      2
    )
  );
}

main();
