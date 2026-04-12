// functions/api/receipt.js
// GET /api/receipt?bookingId=X — polled every 3s by services-booking.js
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
  const { request, env } = context;
  if (!env.SUPABASE_URL) return json({ error: "SUPABASE_URL not configured" }, 500);

  const url       = new URL(request.url);
  const bookingId = url.searchParams.get("bookingId");
  const ref       = url.searchParams.get("ref");
  if (!bookingId && !ref) return json({ error: "Provide bookingId or ref" }, 400);

  const sb = getSB(env);
  let query = sb.from("receipts").select("*");
  if (bookingId) query = query.eq("booking_id", bookingId);
  else           query = query.eq("receipt_ref", ref);

  const { data, error } = await query.single();
  if (error || !data) return json({ error: "Receipt not found" }, 404);
  return json({ success: true, receipt: data });
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