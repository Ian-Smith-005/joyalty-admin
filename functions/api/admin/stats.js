// functions/api/admin/stats.js
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

  const [totalRes, confirmedRes, pendingRes, revenueRes] = await Promise.all([
    sb.from("bookings").select("id", { count: "exact", head: true }),
    sb.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    sb.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending_payment"),
    sb.from("receipts").select("deposit_paid"),
  ]);

  const totalRevenue = (revenueRes.data || [])
    .reduce((sum, r) => sum + Number(r.deposit_paid || 0), 0);

  return json({
    totalBookings:     totalRes.count     ?? 0,
    confirmedBookings: confirmedRes.count ?? 0,
    pendingBookings:   pendingRes.count   ?? 0,
    totalRevenue,
  });
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