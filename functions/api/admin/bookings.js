// functions/api/admin/bookings.js
import { neon } from "@neondatabase/serverless";

export async function onRequestGet(context) {
  var env = context.env;
  if (!env.DATABASE_URL) { return j({ error: "DATABASE_URL not set" }, 500); }
  try {
    var sql  = neon(env.DATABASE_URL);
    var rows = await sql`
      SELECT b.id, b.booking_ref, b.status, b.event_date, b.event_time,
             b.event_location, b.total_price, b.deposit_amount, b.created_at,
             c.name  AS client_name,
             c.email AS client_email,
             c.phone AS client_phone,
             s.name  AS service_name,
             p.name  AS package_name,
             e.name  AS extra_name,
             r.receipt_ref, r.deposit_paid, r.balance_due, r.payment_ref
      FROM bookings b
      LEFT JOIN clients      c ON c.id = b.client_id
      LEFT JOIN services     s ON s.id = b.service_id
      LEFT JOIN packages     p ON p.id = b.package_id
      LEFT JOIN extra_services e ON e.id = b.extra_service_id
      LEFT JOIN receipts     r ON r.booking_id = b.id
      WHERE NOT (b.status = 'pending_payment' AND b.created_at < NOW() - INTERVAL '24 hours')
      ORDER BY b.created_at DESC
    `;
    return j({ bookings: rows });
  } catch (err) {
    return j({ error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  var request = context.request;
  var env     = context.env;
  var id      = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) { return j({ error: "Invalid booking ID" }, 400); }
  if (!env.DATABASE_URL) { return j({ error: "DATABASE_URL not set" }, 500); }
  var body;
  try { body = await request.json(); } catch(e) { return j({ error: "Invalid JSON" }, 400); }
  try {
    var sql = neon(env.DATABASE_URL);
    await sql`
      UPDATE bookings
      SET
        status            = COALESCE(${body.status || null},           status),
        event_date        = COALESCE(${body.eventDate || null},        event_date),
        event_location    = COALESCE(${body.eventLocation || null},    event_location),
        event_description = COALESCE(${body.eventDescription || null}, event_description),
        updated_at        = NOW()
      WHERE id = ${id}
    `;
    return j({ success: true });
  } catch (err) { return j({ error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  var request = context.request;
  var env     = context.env;
  var id      = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) { return j({ error: "Invalid booking ID" }, 400); }
  if (!env.DATABASE_URL) { return j({ error: "DATABASE_URL not set" }, 500); }
  try {
    var sql  = neon(env.DATABASE_URL);
    // CASCADE deletes payments + receipts (requires schema-update.sql to be run)
    var rows = await sql`DELETE FROM bookings WHERE id = ${id} RETURNING id`;
    if (!rows || !rows.length) { return j({ error: "Booking not found" }, 404); }
    return j({ success: true });
  } catch (err) { return j({ error: err.message }, 500); }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function j(data, status) {
  if (!status) { status = 200; }
  return new Response(JSON.stringify(data), { status: status, headers: cors() });
}
function cors() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}