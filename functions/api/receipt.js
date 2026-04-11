// functions/api/receipt.js
// GET /api/receipt?bookingId=X
// Called by services-booking.js every 3s to check if deposit_paid > 0


import { getSupabase } from "../_shared/supabase-client.js";
const sb = getSupabase(env);
const { data: rows, error } = await sb.from("bookings").select("*").eq("id", id);
if (error) return jsonRes({ error: error.message }, 500);


export async function onRequestGet(context) {
  var request = context.request;
  var env     = context.env;

  var url       = new URL(request.url);
  var bookingId = url.searchParams.get("bookingId");
  var ref       = url.searchParams.get("ref");

  if (!bookingId && !ref) {
    return jsonRes({ error: "Provide bookingId or ref" }, 400);
  }

  if (!env.DATABASE_URL) {
    return jsonRes({ error: "DATABASE_URL not configured" }, 500);
  }

  try {
    var sql = neon(env.DATABASE_URL);
    var rows;
    if (bookingId) {
      rows = await sql`SELECT * FROM receipts WHERE booking_id = ${bookingId}`;
    } else {
      rows = await sql`SELECT * FROM receipts WHERE receipt_ref = ${ref}`;
    }

    var receipt = rows && rows[0];
    if (!receipt) {
      return jsonRes({ error: "Receipt not found" }, 404);
    }

    return jsonRes({ success: true, receipt: receipt });

  } catch (err) {
    console.error("[receipt]", err.message);
    return jsonRes({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function jsonRes(data, status) {
  if (!status) { status = 200; }
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}