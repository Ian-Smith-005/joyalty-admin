// functions/api/bookings.js
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

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ error: "SUPABASE_URL not set" }, 500);

  let body;
  try { body = await request.json(); } catch (_) { return j({ error: "Invalid JSON" }, 400); }

  const {
    clientName, clientEmail, clientPhone, serviceType,
    servicePackage = "Standard", extraServices = "None",
    eventDate = null, eventTime = null, eventLocation = null,
    guestCount = null, eventDescription = null, mpesaPhone,
  } = body;

  if (!clientName || !clientEmail || !clientPhone || !serviceType)
    return j({ error: "Missing required fields: clientName, clientEmail, clientPhone, serviceType" }, 400);

  const db = sb(env);

  const { data: svcs, error: sErr } = await db.from("services").select("*").eq("name", serviceType).limit(1);
  if (sErr || !svcs?.length) return j({ error: "Unknown service: " + serviceType }, 400);
  const service = svcs[0];

  const { data: pkgs } = await db.from("packages").select("*").eq("name", servicePackage).limit(1);
  const pkg = pkgs?.[0];
  const modifier = pkg ? parseFloat(pkg.price_modifier) : 1.0;

  const { data: exts } = await db.from("extra_services").select("*").eq("name", extraServices).limit(1);
  const extra = exts?.[0];
  const extraPrice = extra ? Number(extra.price) : 0;

  const basePrice  = Number(service.base_price);
  const pkgPrice   = Math.round(basePrice * modifier);
  const totalPrice = pkgPrice + extraPrice;
  const depositAmt = Math.round(totalPrice * 0.30);

  const { data: cl, error: clErr } = await db
    .from("clients")
    .upsert({ name: clientName, email: clientEmail, phone: clientPhone }, { onConflict: "email" })
    .select("id").single();
  if (clErr) return j({ error: clErr.message }, 500);

  const year = new Date().getFullYear();
  const { count } = await db.from("bookings").select("id", { count: "exact", head: true });
  const bookingRef = `JOY-${year}-${String((count || 0) + 1).padStart(4, "0")}`;

  const { data: bk, error: bkErr } = await db.from("bookings").insert({
    booking_ref: bookingRef, client_id: cl.id,
    service_id: service.id, package_id: pkg?.id ?? null, extra_service_id: extra?.id ?? null,
    event_date: eventDate, event_time: eventTime, event_location: eventLocation,
    guest_count: guestCount ? Number(guestCount) : null, event_description: eventDescription,
    base_price: basePrice, package_price: pkgPrice, extra_price: extraPrice,
    total_price: totalPrice, deposit_amount: depositAmt,
    status: "pending_payment", payment_method: "mpesa",
  }).select("id").single();
  if (bkErr) return j({ error: bkErr.message }, 500);

  const { count: rc } = await db.from("receipts").select("id", { count: "exact", head: true });
  const receiptRef = `RCP-${year}-${String((rc || 0) + 1).padStart(4, "0")}`;

  await db.from("receipts").insert({
    booking_id: bk.id, receipt_ref: receiptRef, booking_ref: bookingRef,
    client_name: clientName, client_email: clientEmail, client_phone: clientPhone,
    service_name: service.name, package_name: servicePackage, extra_name: extraServices,
    event_date: eventDate, event_time: eventTime, location: eventLocation,
    base_price: basePrice, extra_price: extraPrice, total_price: totalPrice,
    deposit_paid: 0, balance_due: totalPrice, payment_ref: null,
  });

  return j({
    success: true, bookingRef, receiptRef, bookingId: bk.id, clientName,
    service: service.name, package: servicePackage, extra: extraServices,
    totalPrice, depositAmount: depositAmt, balanceDue: totalPrice,
    paymentRequired: true, mpesaPhone: mpesaPhone || clientPhone,
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}