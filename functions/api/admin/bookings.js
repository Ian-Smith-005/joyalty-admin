// functions/api/admin/bookings.js
// GET all, PUT update, DELETE — admin CRUD
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
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// GET /api/admin/bookings — full list with joins
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return json({ error: "SUPABASE_URL not configured" }, 500);
  const sb = getSB(env);

  const { data, error } = await sb
    .from("bookings")
    .select(`
      id, booking_ref, status, event_date, event_time,
      event_location, event_description, total_price, deposit_amount,
      base_price, package_price, extra_price, created_at, updated_at,
      clients   ( name, email, phone ),
      services  ( name ),
      packages  ( name ),
      extra_services ( name ),
      receipts  ( receipt_ref, deposit_paid, balance_due, payment_ref )
    `)
    .not("status", "eq", "pending_payment")
    .order("created_at", { ascending: false });

  // Also include pending_payment bookings created within the last 24h
  const { data: pending } = await sb
    .from("bookings")
    .select(`
      id, booking_ref, status, event_date, event_time,
      event_location, event_description, total_price, deposit_amount,
      base_price, package_price, extra_price, created_at, updated_at,
      clients   ( name, email, phone ),
      services  ( name ),
      packages  ( name ),
      extra_services ( name ),
      receipts  ( receipt_ref, deposit_paid, balance_due, payment_ref )
    `)
    .eq("status", "pending_payment")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString());

  if (error) return json({ error: error.message }, 500);

  const all = [...(data || []), ...(pending || [])].map(b => ({
    id:                b.id,
    booking_ref:       b.booking_ref,
    status:            b.status,
    event_date:        b.event_date,
    event_time:        b.event_time,
    event_location:    b.event_location,
    event_description: b.event_description,
    total_price:       b.total_price,
    deposit_amount:    b.deposit_amount,
    created_at:        b.created_at,
    client_name:       b.clients?.name,
    client_email:      b.clients?.email,
    client_phone:      b.clients?.phone,
    service_name:      b.services?.name,
    package_name:      b.packages?.name,
    extra_name:        b.extra_services?.name,
    receipt_ref:       b.receipts?.receipt_ref,
    deposit_paid:      b.receipts?.deposit_paid,
    balance_due:       b.receipts?.balance_due,
    payment_ref:       b.receipts?.payment_ref,
  }));

  // Sort by created_at desc
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return json({ bookings: all });
}

// PUT /api/admin/bookings/:id — update status / details
export async function onRequestPut(context) {
  const { request, env } = context;
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) return json({ error: "Invalid booking ID" }, 400);
  if (!env.SUPABASE_URL) return json({ error: "SUPABASE_URL not configured" }, 500);

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: "Invalid JSON" }, 400); }

  const sb = getSB(env);
  const updates = {};
  if (body.status)           updates.status            = body.status;
  if (body.eventDate)        updates.event_date         = body.eventDate;
  if (body.eventLocation)    updates.event_location     = body.eventLocation;
  if (body.eventDescription) updates.event_description  = body.eventDescription;
  updates.updated_at = new Date().toISOString();

  const { error } = await sb.from("bookings").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// DELETE /api/admin/bookings/:id
export async function onRequestDelete(context) {
  const { request, env } = context;
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) return json({ error: "Invalid booking ID" }, 400);
  if (!env.SUPABASE_URL) return json({ error: "SUPABASE_URL not configured" }, 500);

  const sb = getSB(env);
  const { error } = await sb.from("bookings").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}