const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://fabfhzcsppniuwtdwvfg.supabase.co";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYmZoemNzcHBuaXV3dGR3dmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Njk3NjQsImV4cCI6MjA5ODI0NTc2NH0.2w3Wr8Bov2Jc-1PQw1KyVa99_B9jMFez8YXonZx8WGk";

const fallbackHtml = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Packhai Inventory Dashboard</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 32px">
    <h1>Packhai Inventory Dashboard</h1>
    <p>Dashboard shell has not been seeded to Supabase yet.</p>
  </body>
</html>`;

function response(body: string, status = 200, contentType = "text/html; charset=utf-8") {
  return new Response(new Blob([body], { type: contentType }), {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

Deno.serve(async () => {
  try {
    const url = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/app_snapshots?key=eq.index_html&select=payload`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return response(fallbackHtml, 200);
    const rows = await res.json();
    const html = rows?.[0]?.payload?.html || fallbackHtml;
    return response(String(html));
  } catch (error) {
    return response(`${fallbackHtml}\n<!-- ${String(error).replaceAll("--", "")} -->`, 200);
  }
});
