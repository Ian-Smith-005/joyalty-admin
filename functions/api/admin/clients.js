// functions/api/admin/clients.js
// ✅ Self-contained — no _shared imports

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getSB(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return json({ error: "SUPABASE_URL not configured" }, 500);
  const sb = getSB(env);
  const { data, error } = await sb
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ clients: data });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}