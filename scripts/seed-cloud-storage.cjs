const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDataDir = path.join(projectRoot, "data");
const targetDataDir = process.env.PACKHAI_DATA_DIR
  ? path.resolve(process.env.PACKHAI_DATA_DIR)
  : sourceDataDir;

function copyMissing(source, target) {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyMissing(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function main() {
  if (path.resolve(sourceDataDir) === path.resolve(targetDataDir)) {
    console.log("Cloud storage seed skipped: using repository data directory.");
    return;
  }
  copyMissing(sourceDataDir, targetDataDir);
  console.log(`Cloud storage seed checked: ${targetDataDir}`);
}

main();
