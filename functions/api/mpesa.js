// functions/api/mpesa.js
// Real M-Pesa STK Push handler.
// NOTE: The repo had bookings.js copied here by mistake — this is the real file.
// Cloudflare requires: all imports at top, every await inside async, no duplicate exports.

import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  const { request, env } = context;

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  var phone      = body.phone;
  var amount     = body.amount;
  var bookingId  = body.bookingId;
  var bookingRef = body.bookingRef;

  if (!phone || !amount) {
    return jsonResponse({ error: "phone and amount are required" }, 400);
  }

  // Normalise → 2547XXXXXXXX
  var fmt = String(phone).trim().replace(/^\+/, "").replace(/^0/, "254");
  if (!/^2547\d{8}$|^2541\d{8}$/.test(fmt)) {
    return jsonResponse({ error: "Invalid phone. Use 07XXXXXXXX or +2547XXXXXXXX" }, 400);
  }

  // Sandbox credentials — Safaricom official public test values
  // PRODUCTION: swap these three lines with env vars when going live
  var stkUrl  = "https://sandbox.safaricom.co.ke";
  var stkCode = "174379";
  var stkPass = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
  var conKey  = env.MPESA_CONSUMER_KEY;
  var conSec  = env.MPESA_CONSUMER_SECRET;

  /* PRODUCTION block — uncomment and set env vars in Cloudflare dashboard:
  var stkUrl  = "https://api.safaricom.co.ke";
  var stkCode = env.MPESA_SHORTCODE;
  var stkPass = env.MPESA_PASSKEY;
  var conKey  = env.MPESA_CONSUMER_KEY;
  var conSec  = env.MPESA_CONSUMER_SECRET;
  */

  if (!conKey || !conSec) {
    return jsonResponse({ error: "MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be set in Cloudflare env vars" }, 500);
  }

  // 1. Get OAuth token
  var tokenRes;
  var tokenData;
  try {
    var b64 = btoa(conKey + ":" + conSec);
    tokenRes  = await fetch(stkUrl + "/oauth/v1/generate?grant_type=client_credentials", {
      headers: { "Authorization": "Basic " + b64 }
    });
    tokenData = await tokenRes.json();
  } catch (e) {
    return jsonResponse({ error: "OAuth request failed: " + e.message }, 502);
  }

  if (!tokenData || !tokenData.access_token) {
    return jsonResponse({ error: "M-Pesa OAuth failed. Check CONSUMER_KEY and CONSUMER_SECRET.", detail: tokenData }, 502);
  }

  var token = tokenData.access_token;

  // 2. Build timestamp and password
  var now = new Date();
  var ts  = now.getFullYear().toString()
    + pad(now.getMonth() + 1)
    + pad(now.getDate())
    + pad(now.getHours())
    + pad(now.getMinutes())
    + pad(now.getSeconds());
  var pwd = btoa(stkCode + stkPass + ts);

  // 3. Send STK push
  var callbackUrl = "https://joyaltyphotography.pages.dev/api/mpesa-callback";
  var acctRef     = (bookingRef || "JOYALTY").substring(0, 12);
  var txDesc      = "Joyalty Deposit".substring(0, 13);
  var stkAmt      = Math.round(Number(amount));

  var stkRes;
  var stkData;
  try {
    stkRes = await fetch(stkUrl + "/mpesa/stkpush/v1/processrequest", {
      method:  "POST",
      headers: {
        "Authorization":  "Bearer " + token,
        "Content-Type":   "application/json"
      },
      body: JSON.stringify({
        BusinessShortCode: stkCode,
        Password:          pwd,
        Timestamp:         ts,
        TransactionType:   "CustomerPayBillOnline",
        Amount:            stkAmt,
        PartyA:            fmt,
        PartyB:            stkCode,
        PhoneNumber:       fmt,
        CallBackURL:       callbackUrl,
        AccountReference:  acctRef,
        TransactionDesc:   txDesc
      })
    });
    stkData = await stkRes.json();
  } catch (e) {
    return jsonResponse({ error: "STK push request failed: " + e.message }, 502);
  }

  if (!stkData || stkData.ResponseCode !== "0") {
    return jsonResponse({
      error:   "STK push rejected: " + (stkData ? (stkData.ResponseDescription || stkData.errorMessage || "Unknown") : "No response"),
      detail:  stkData
    }, 502);
  }

  // 4. Save pending payment row in DB
  if (bookingId && env.DATABASE_URL) {
    try {
      var sql = neon(env.DATABASE_URL);
      await sql`
        INSERT INTO payments (booking_id, payment_method, amount, status, mpesa_checkout_id, mpesa_phone)
        VALUES (${bookingId}, ${"mpesa"}, ${stkAmt}, ${"pending"}, ${stkData.CheckoutRequestID}, ${fmt})
        ON CONFLICT DO NOTHING
      `;
    } catch (dbErr) {
      // Non-fatal — STK already sent
      console.error("[mpesa] DB save failed:", dbErr.message);
    }
  }

  return jsonResponse({
    success:           true,
    checkoutRequestId: stkData.CheckoutRequestID,
    merchantRequestId: stkData.MerchantRequestID,
    message:           "STK push sent — check your phone"
  });
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

function jsonResponse(data, status) {
  if (!status) { status = 200; }
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}