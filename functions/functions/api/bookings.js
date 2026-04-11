// functions/api/bookings.js
// Creates booking + receipt skeleton. Status = pending_payment.
// Confirmed only after STK callback fires.

import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  var request = context.request;
  var env     = context.env;

  if (!env.DATABASE_URL) {
    return jsonRes({ error: "DATABASE_URL not configured" }, 500);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonRes({ error: "Invalid JSON body" }, 400);
  }

  var clientName       = body.clientName;
  var clientEmail      = body.clientEmail;
  var clientPhone      = body.clientPhone;
  var serviceType      = body.serviceType;
  var servicePackage   = body.servicePackage   || "Standard";
  var extraServices    = body.extraServices    || "None";
  var eventDate        = body.eventDate        || null;
  var eventTime        = body.eventTime        || null;
  var eventLocation    = body.eventLocation    || null;
  var guestCount       = body.guestCount       ? Number(body.guestCount) : null;
  var eventDescription = body.eventDescription || null;
  var mpesaPhone       = body.mpesaPhone       || clientPhone;

  if (!clientName || !clientEmail || !clientPhone || !serviceType) {
    return jsonRes({ error: "Missing required fields: clientName, clientEmail, clientPhone, serviceType" }, 400);
  }

  var sql = neon(env.DATABASE_URL);

  try {
    // Look up service
    var serviceRows = await sql`SELECT * FROM services WHERE name = ${serviceType} LIMIT 1`;
    var service = serviceRows[0];
    if (!service) {
      return jsonRes({ error: "Unknown service: " + serviceType }, 400);
    }

    // Look up package
    var pkgRows = await sql`SELECT * FROM packages WHERE name = ${servicePackage} LIMIT 1`;
    var pkg      = pkgRows[0];
    var modifier = pkg ? parseFloat(pkg.price_modifier) : 1.0;

    // Look up extra
    var extraRows = await sql`SELECT * FROM extra_services WHERE name = ${extraServices} LIMIT 1`;
    var extra     = extraRows[0];

    // Pricing
    var basePrice    = service.base_price;
    var pkgPrice     = Math.round(basePrice * modifier);
    var extraPrice   = extra ? extra.price : 0;
    var totalPrice   = pkgPrice + extraPrice;
    var depositAmt   = Math.round(totalPrice * 0.30);

    // Upsert client
    var clientRows = await sql`
      INSERT INTO clients (name, email, phone)
      VALUES (${clientName}, ${clientEmail}, ${clientPhone})
      ON CONFLICT (email)
      DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
      RETURNING id
    `;
    var client = clientRows[0];

    // Booking ref — MAX(id)+1 is safe against deletions
    var year   = new Date().getFullYear();
    var mxRows = await sql`SELECT COALESCE(MAX(id), 0) AS m FROM bookings`;
    var nextN  = Number(mxRows[0].m) + 1;
    var bookingRef = "JOY-" + year + "-" + String(nextN).padStart(4, "0");

    // Create booking
    var bookingRows = await sql`
      INSERT INTO bookings (
        booking_ref, client_id, service_id, package_id, extra_service_id,
        event_date, event_time, event_location, guest_count, event_description,
        base_price, package_price, extra_price, total_price, deposit_amount,
        status, payment_method
      ) VALUES (
        ${bookingRef}, ${client.id}, ${service.id},
        ${pkg ? pkg.id : null}, ${extra ? extra.id : null},
        ${eventDate}, ${eventTime}, ${eventLocation},
        ${guestCount}, ${eventDescription},
        ${basePrice}, ${pkgPrice}, ${extraPrice}, ${totalPrice}, ${depositAmt},
        ${"pending_payment"}, ${"mpesa"}
      )
      RETURNING id
    `;
    var booking = bookingRows[0];

    // Receipt ref
    var mrRows = await sql`SELECT COALESCE(MAX(id), 0) AS m FROM receipts`;
    var rcpN   = Number(mrRows[0].m) + 1;
    var receiptRef = "RCP-" + year + "-" + String(rcpN).padStart(4, "0");

    // Create receipt skeleton
    await sql`
      INSERT INTO receipts (
        booking_id, receipt_ref,
        client_name, client_email, client_phone,
        service_name, package_name, extra_name,
        event_date, event_time, location,
        base_price, extra_price, total_price,
        deposit_paid, balance_due, payment_ref
      ) VALUES (
        ${booking.id}, ${receiptRef},
        ${clientName}, ${clientEmail}, ${clientPhone},
        ${service.name}, ${servicePackage}, ${extraServices},
        ${eventDate}, ${eventTime}, ${eventLocation},
        ${basePrice}, ${extraPrice}, ${totalPrice},
        ${0}, ${totalPrice}, ${null}
      )
    `;

    return jsonRes({
      success:         true,
      bookingRef:      bookingRef,
      receiptRef:      receiptRef,
      bookingId:       booking.id,
      clientName:      clientName,
      service:         service.name,
      package:         servicePackage,
      extra:           extraServices,
      totalPrice:      totalPrice,
      depositAmount:   depositAmt,
      balanceDue:      totalPrice,
      paymentRequired: true,
      mpesaPhone:      mpesaPhone
    });

  } catch (err) {
    console.error("[bookings]", err.message);
    return jsonRes({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
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