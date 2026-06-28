function normalizePublicSyncApiBase(value, options = {}) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }

  if (url.protocol !== "https:") return "";
  if (options.source !== "env" && /\.trycloudflare\.com$/i.test(url.hostname)) return "";
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function selectPublicSyncApiBase(options = {}) {
  const explicit = normalizePublicSyncApiBase(options.publicSyncApiBase, { source: "env" });
  if (explicit) return explicit;

  const renderExternal = normalizePublicSyncApiBase(options.renderExternalUrl, { source: "env" });
  if (renderExternal) return renderExternal;

  return normalizePublicSyncApiBase(options.localFileSyncApiBase, { source: "local-file" });
}

module.exports = {
  normalizePublicSyncApiBase,
  selectPublicSyncApiBase,
};
