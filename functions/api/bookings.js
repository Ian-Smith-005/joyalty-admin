// functions/api/bookings.js
// ✅ Self-contained — no _shared imports (Cloudflare Pages Functions limitation)
// Supabase is imported directly from the CDN ESM bundle

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getSB(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required");
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
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: "Invalid JSON body" }, 400); }

  const {
    clientName, clientEmail, clientPhone, serviceType,
    servicePackage = "Standard", extraServices = "None",
    eventDate = null, eventTime = null, eventLocation = null,
    guestCount = null, eventDescription = null, mpesaPhone,
  } = body;

  if (!clientName || !clientEmail || !clientPhone || !serviceType)
    return json({ error: "Missing required fields: clientName, clientEmail, clientPhone, serviceType" }, 400);

  const sb = getSB(env);

  // ── Look up service ──────────────────────────────────────
  const { data: svcs, error: svcErr } = await sb
    .from("services").select("*").eq("name", serviceType).limit(1);
  if (svcErr || !svcs?.length)
    return json({ error: "Unknown service: " + serviceType }, 400);
  const service = svcs[0];

  // ── Look up package ──────────────────────────────────────
  const { data: pkgs } = await sb
    .from("packages").select("*").eq("name", servicePackage).limit(1);
  const pkg      = pkgs?.[0];
  const modifier = pkg ? parseFloat(pkg.price_modifier) : 1.0;

  // ── Look up extra ────────────────────────────────────────
  const { data: exts } = await sb
    .from("extra_services").select("*").eq("name", extraServices).limit(1);
  const extra      = exts?.[0];
  const extraPrice = extra ? Number(extra.price) : 0;

  // ── Pricing ──────────────────────────────────────────────
  const basePrice  = Number(service.base_price);
  const pkgPrice   = Math.round(basePrice * modifier);
  const totalPrice = pkgPrice + extraPrice;
  const depositAmt = Math.round(totalPrice * 0.30);

  // ── Upsert client ────────────────────────────────────────
  const { data: cl, error: clErr } = await sb
    .from("clients")
    .upsert({ name: clientName, email: clientEmail, phone: clientPhone }, { onConflict: "email" })
    .select("id")
    .single();
  if (clErr) return json({ error: clErr.message }, 500);

  // ── Booking ref ──────────────────────────────────────────
  const year = new Date().getFullYear();
  const { count } = await sb.from("bookings").select("id", { count: "exact", head: true });
  const bookingRef = `JOY-${year}-${String((count || 0) + 1).padStart(4, "0")}`;

  // ── Insert booking ────────────────────────────────────────
  const { data: bk, error: bkErr } = await sb.from("bookings").insert({
    booking_ref: bookingRef,
    client_id:   cl.id,
    service_id:  service.id,
    package_id:  pkg?.id  ?? null,
    extra_service_id: extra?.id ?? null,
    event_date: eventDate, event_time: eventTime,
    event_location: eventLocation, guest_count: guestCount ? Number(guestCount) : null,
    event_description: eventDescription,
    base_price: basePrice, package_price: pkgPrice,
    extra_price: extraPrice, total_price: totalPrice,
    deposit_amount: depositAmt,
    status: "pending_payment", payment_method: "mpesa",
  }).select("id").single();
  if (bkErr) return json({ error: bkErr.message }, 500);

  // ── Receipt skeleton ──────────────────────────────────────
  const { count: rCount } = await sb.from("receipts").select("id", { count: "exact", head: true });
  const receiptRef = `RCP-${year}-${String((rCount || 0) + 1).padStart(4, "0")}`;

  const { error: rcpErr } = await sb.from("receipts").insert({
    booking_id: bk.id, receipt_ref: receiptRef, booking_ref: bookingRef,
    client_name: clientName, client_email: clientEmail, client_phone: clientPhone,
    service_name: service.name, package_name: servicePackage, extra_name: extraServices,
    event_date: eventDate, event_time: eventTime, location: eventLocation,
    base_price: basePrice, extra_price: extraPrice, total_price: totalPrice,
    deposit_paid: 0, balance_due: totalPrice, payment_ref: null,
  });
  if (rcpErr) console.error("[bookings] receipt insert:", rcpErr.message);

  return json({
    success: true, bookingRef, receiptRef,
    bookingId: bk.id, clientName,
    service: service.name, package: servicePackage, extra: extraServices,
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