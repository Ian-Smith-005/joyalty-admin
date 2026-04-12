// functions/api/admin/stats.js
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

  const [total, confirmed, pending, revenue] = await Promise.all([
    db.from("bookings").select("id", { count: "exact", head: true }),
    db.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    db.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending_payment"),
    db.from("receipts").select("deposit_paid"),
  ]);

  const totalRevenue = (revenue.data || []).reduce((s, r) => s + Number(r.deposit_paid || 0), 0);

  return j({
    totalBookings:     total.count     ?? 0,
    confirmedBookings: confirmed.count ?? 0,
    pendingBookings:   pending.count   ?? 0,
    totalRevenue,
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}