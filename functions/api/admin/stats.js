// functions/api/admin/stats.js
import { neon } from "@neondatabase/serverless";

export async function onRequestGet(context) {
  var env = context.env;
  if (!env.DATABASE_URL) { return jsonRes({ error: "DATABASE_URL not set" }, 500); }

  try {
    var sql  = neon(env.DATABASE_URL);
    var rows = await sql`
      SELECT
        COUNT(*)                                              AS total_bookings,
        COUNT(*) FILTER (WHERE b.status = 'confirmed')       AS confirmed_bookings,
        COUNT(*) FILTER (WHERE b.status = 'pending_payment') AS pending_bookings,
        COALESCE(SUM(r.deposit_paid), 0)                     AS total_revenue
      FROM bookings b
      LEFT JOIN receipts r ON r.booking_id = b.id
    `;
    var s = rows[0];
    return jsonRes({
      totalBookings:     Number(s.total_bookings),
      confirmedBookings: Number(s.confirmed_bookings),
      pendingBookings:   Number(s.pending_bookings),
      totalRevenue:      Number(s.total_revenue)
    });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function jsonRes(data, status) {
  if (!status) { status = 200; }
  return new Response(JSON.stringify(data), { status: status, headers: cors() });
}
function cors() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
}