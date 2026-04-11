// functions/api/admin/clients.js
import { getSupabase } from "../_shared/supabase-client.js";
const sb = getSupabase(env);
const { data: rows, error } = await sb.from("bookings").select("*").eq("id", id);
if (error) return jsonRes({ error: error.message }, 500);

export async function onRequestGet(context) {
  var env = context.env;
  if (!env.DATABASE_URL) { return j({ error: "DATABASE_URL not set" }, 500); }
  try {
    var sql  = neon(env.DATABASE_URL);
    var rows = await sql`SELECT * FROM clients ORDER BY created_at DESC`;
    return j({ clients: rows });
  } catch (err) {
    return j({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function j(data, status) {
  if (!status) { status = 200; }
  return new Response(JSON.stringify(data), { status: status, headers: cors() });
}
function cors() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
}