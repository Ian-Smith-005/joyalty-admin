// functions/api/receipt.js
// GET /api/receipt?bookingId=X  — polled every 3s by services-booking.js
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
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);

  const url       = new URL(request.url);
  const bookingId = url.searchParams.get("bookingId");
  const ref       = url.searchParams.get("ref");
  if (!bookingId && !ref) return j({ error: "Provide bookingId or ref" }, 400);

  const db = sb(env);
  let q = db.from("receipts").select("*");
  q = bookingId ? q.eq("booking_id", bookingId) : q.eq("receipt_ref", ref);
  const { data, error } = await q.single();

  if (error || !data) return j({ error: "Receipt not found" }, 404);
  return j({ success: true, receipt: data });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}