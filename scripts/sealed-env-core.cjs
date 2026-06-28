const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const algorithm = "aes-256-gcm";
const kdf = "scrypt";
const keyLength = 32;

function parseEnvFile(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

function formatEnvFile(values) {
  return (
    Object.entries(values)
      .filter(([, value]) => String(value || ""))
      .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, "")}`)
      .join("\n") + "\n"
  );
}

function deriveKey(passphrase, salt) {
  if (!passphrase) throw new Error("A passphrase is required.");
  return crypto.scryptSync(String(passphrase), salt, keyLength);
}

function sealText(plainText, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm,
    kdf,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function openText(payload, passphrase) {
  if (!payload || payload.version !== 1) throw new Error("Unsupported sealed env payload.");
  if (payload.algorithm !== algorithm || payload.kdf !== kdf) throw new Error("Unsupported sealed env algorithm.");
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function readSealedFile(file, passphrase) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  return openText(payload, passphrase);
}

function writeSealedFile(file, plainText, passphrase) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sealText(plainText, passphrase), null, 2) + "\n", "utf8");
}

module.exports = {
  formatEnvFile,
  openText,
  parseEnvFile,
  readSealedFile,
  sealText,
  writeSealedFile,
};
