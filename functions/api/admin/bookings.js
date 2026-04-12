// functions/api/admin/bookings.js
// GET (list), PUT (update), DELETE — admin CRUD
// ✅ Uses bare npm specifier — works with Cloudflare Pages + esbuild
import { createClient } from "@supabase/supabase-js";

function sb(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}
function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: {
      "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);
  const db = sb(env);

  const { data, error } = await db.from("bookings")
    .select(`
      id, booking_ref, status, event_date, event_time, event_location,
      event_description, total_price, deposit_amount, created_at,
      clients        ( name, email, phone ),
      services       ( name ),
      packages       ( name ),
      extra_services ( name ),
      receipts       ( receipt_ref, deposit_paid, balance_due, payment_ref )
    `)
    .order("created_at", { ascending: false });

  if (error) return j({ error: error.message }, 500);

  const bookings = (data || []).map(b => ({
    id: b.id, booking_ref: b.booking_ref, status: b.status,
    event_date: b.event_date, event_time: b.event_time,
    event_location: b.event_location, event_description: b.event_description,
    total_price: b.total_price, deposit_amount: b.deposit_amount, created_at: b.created_at,
    client_name:  b.clients?.name,  client_email: b.clients?.email, client_phone: b.clients?.phone,
    service_name: b.services?.name, package_name: b.packages?.name,
    extra_name:   b.extra_services?.name,
    receipt_ref:  b.receipts?.receipt_ref, deposit_paid: b.receipts?.deposit_paid,
    balance_due:  b.receipts?.balance_due,  payment_ref:  b.receipts?.payment_ref,
  }));

  return j({ bookings });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) return j({ error: "Invalid booking ID" }, 400);

  let body;
  try { body = await request.json(); } catch (_) { return j({ error: "Invalid JSON" }, 400); }

  const updates = { updated_at: new Date().toISOString() };
  if (body.status)           updates.status            = body.status;
  if (body.eventDate)        updates.event_date         = body.eventDate;
  if (body.eventLocation)    updates.event_location     = body.eventLocation;
  if (body.eventDescription) updates.event_description  = body.eventDescription;

  const db = sb(env);
  const { error } = await db.from("bookings").update(updates).eq("id", id);
  if (error) return j({ error: error.message }, 500);
  return j({ success: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (!id || isNaN(id)) return j({ error: "Invalid booking ID" }, 400);

  const db = sb(env);
  const { error } = await db.from("bookings").delete().eq("id", id);
  if (error) return j({ error: error.message }, 500);
  return j({ success: true });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}