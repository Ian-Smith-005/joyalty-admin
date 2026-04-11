// functions/api/bookings.js  — Supabase version
import { getSupabase, jsonRes } from "../_shared/supabase-client.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonRes({ error: "Invalid JSON" }, 400); }

  const {
    clientName, clientEmail, clientPhone, serviceType,
    servicePackage = "Standard", extraServices = "None",
    eventDate = null, eventTime = null, eventLocation = null,
    guestCount = null, eventDescription = null, mpesaPhone,
  } = body;

  if (!clientName || !clientEmail || !clientPhone || !serviceType)
    return jsonRes({ error: "Missing required fields" }, 400);

  const sb = getSupabase(env);

  // ── Look up service ──────────────────────────────────────
  const { data: svcRows, error: svcErr } = await sb
    .from("services").select("*").eq("name", serviceType).limit(1);
  if (svcErr || !svcRows?.length)
    return jsonRes({ error: "Unknown service: " + serviceType }, 400);
  const service = svcRows[0];

  // ── Look up package ──────────────────────────────────────
  const { data: pkgRows } = await sb
    .from("packages").select("*").eq("name", servicePackage).limit(1);
  const pkg      = pkgRows?.[0];
  const modifier = pkg ? parseFloat(pkg.price_modifier) : 1.0;

  // ── Look up extra ────────────────────────────────────────
  const { data: extRows } = await sb
    .from("extra_services").select("*").eq("name", extraServices).limit(1);
  const extra     = extRows?.[0];
  const extraPrice = extra ? extra.price : 0;

  // ── Pricing ──────────────────────────────────────────────
  const basePrice   = service.base_price;
  const pkgPrice    = Math.round(basePrice * modifier);
  const totalPrice  = pkgPrice + extraPrice;
  const depositAmt  = Math.round(totalPrice * 0.30);

  // ── Upsert client ────────────────────────────────────────
  const { data: clientRows, error: clientErr } = await sb
    .from("clients")
    .upsert({ name: clientName, email: clientEmail, phone: clientPhone }, { onConflict: "email" })
    .select("id").single();
  if (clientErr) return jsonRes({ error: clientErr.message }, 500);

  // ── Booking ref ──────────────────────────────────────────
  const year = new Date().getFullYear();
  const { count } = await sb.from("bookings").select("id", { count:"exact", head:true });
  const nextN    = (count || 0) + 1;
  const bookingRef = `JOY-${year}-${String(nextN).padStart(4,"0")}`;

  // ── Create booking ────────────────────────────────────────
  const { data: bkRow, error: bkErr } = await sb.from("bookings").insert({
    booking_ref: bookingRef,
    client_id:   clientRows.id,
    service_id:  service.id,
    package_id:  pkg?.id  || null,
    extra_service_id: extra?.id || null,
    event_date:   eventDate, event_time: eventTime,
    event_location: eventLocation, guest_count: guestCount,
    event_description: eventDescription,
    base_price: basePrice, package_price: pkgPrice,
    extra_price: extraPrice, total_price: totalPrice,
    deposit_amount: depositAmt,
    status: "pending_payment", payment_method: "mpesa",
  }).select("id").single();
  if (bkErr) return jsonRes({ error: bkErr.message }, 500);

  // ── Receipt skeleton ──────────────────────────────────────
  const { count: rCount } = await sb.from("receipts").select("id", { count:"exact", head:true });
  const receiptRef = `RCP-${year}-${String((rCount||0)+1).padStart(4,"0")}`;

  await sb.from("receipts").insert({
    booking_id: bkRow.id, receipt_ref: receiptRef, booking_ref: bookingRef,
    client_name: clientName, client_email: clientEmail, client_phone: clientPhone,
    service_name: service.name, package_name: servicePackage, extra_name: extraServices,
    event_date: eventDate, event_time: eventTime, location: eventLocation,
    base_price: basePrice, extra_price: extraPrice, total_price: totalPrice,
    deposit_paid: 0, balance_due: totalPrice, payment_ref: null,
  });

  return jsonRes({
    success: true, bookingRef, receiptRef, bookingId: bkRow.id,
    clientName, service: service.name, package: servicePackage, extra: extraServices,
    totalPrice, depositAmount: depositAmt, balanceDue: totalPrice,
    paymentRequired: true, mpesaPhone: mpesaPhone || clientPhone,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}