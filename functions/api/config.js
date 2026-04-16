// functions/api/config.js
// Exposes ONLY the safe public env vars to the browser.
// NEVER expose SUPABASE_SERVICE_KEY here — only the anon key.
// Called by admin/index.html on page load.

export async function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      supabaseUrl: env.SUPABASE_URL || "",
      supabaseAnon: env.SUPABASE_ANON_KEY || "",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // Cache for 5 min — these don't change often
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
