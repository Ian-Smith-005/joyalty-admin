// functions/api/admin/clients.js
// ✅ Uses bare npm specifier — works with Cloudflare Pages + esbuild
import { createClient } from "@supabase/supabase-js";

function sb(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}
function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);
  const db = sb(env);
  const { data, error } = await db.from("clients")
    .select("*").order("created_at", { ascending: false });
  if (error) return j({ error: error.message }, 500);
  return j({ clients: data });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}