// functions/api/mpesa.js
// M-Pesa STK Push handler.
// ✅ Self-contained — no _shared imports (Cloudflare Pages Functions limitation).
//    Supabase imported directly from ESM CDN.
//
// SANDBOX:    Uses Safaricom public test credentials. No real money moves.
// PRODUCTION: Uncomment the PRODUCTION block and set env vars in Cloudflare dashboard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Supabase helper ───────────────────────────────────────────
function getSB(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ── JSON response helper ──────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── Zero-pad helper ───────────────────────────────────────────
function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

// ════════════════════════════════════════════════════════════
export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Parse body ────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: "Invalid JSON body" }, 400); }

  const { phone, amount, bookingId, bookingRef } = body;

  if (!phone || !amount)
    return json({ error: "phone and amount are required" }, 400);

  // ── Normalise phone → 2547XXXXXXXX or 2541XXXXXXXX ────────
  const fmt = String(phone).trim().replace(/^\+/, "").replace(/^0/, "254");
  if (!/^254[17]\d{8}$/.test(fmt))
    return json({ error: "Invalid phone. Use 07XXXXXXXX or +2547XXXXXXXX" }, 400);

  // ── Credentials ───────────────────────────────────────────
  // SANDBOX (active by default — uses Safaricom public test values)
  let stkUrl  = "https://sandbox.safaricom.co.ke";
  let stkCode = "174379";
  let stkPass = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
  let conKey  = env.MPESA_CONSUMER_KEY;
  let conSec  = env.MPESA_CONSUMER_SECRET;

  /* ── PRODUCTION — uncomment when going live ─────────────────
     Also set these in Cloudflare Dashboard → Pages → Settings → Env vars:
       MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET
  stkUrl  = "https://api.safaricom.co.ke";
  stkCode = env.MPESA_SHORTCODE;
  stkPass = env.MPESA_PASSKEY;
  conKey  = env.MPESA_CONSUMER_KEY;
  conSec  = env.MPESA_CONSUMER_SECRET;
  ─────────────────────────────────────────────────────────── */

  if (!conKey || !conSec)
    return json({
      error: "MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be set in Cloudflare env vars",
    }, 500);

  // ── Step 1: Get OAuth token ───────────────────────────────
  let tokenData;
  try {
    const b64 = btoa(conKey + ":" + conSec);
    const tokenRes = await fetch(
      stkUrl + "/oauth/v1/generate?grant_type=client_credentials",
      { headers: { Authorization: "Basic " + b64 } }
    );
    tokenData = await tokenRes.json();
  } catch (e) {
    return json({ error: "OAuth request failed: " + e.message }, 502);
  }

  if (!tokenData?.access_token)
    return json({
      error:  "M-Pesa OAuth failed. Check CONSUMER_KEY and CONSUMER_SECRET.",
      detail: tokenData,
    }, 502);

  const token = tokenData.access_token;

  // ── Step 2: Build timestamp + password ───────────────────
  const now = new Date();
  const ts  =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  const pwd = btoa(stkCode + stkPass + ts);

  // ── Step 3: Send STK push ────────────────────────────────
  // Callback URL — update domain when using a custom domain
  const callbackUrl = "https://joyaltyphotography.pages.dev/api/mpesa-callback";
  const acctRef     = (bookingRef || "JOYALTY").substring(0, 12);
  const txDesc      = "Joyalty Deposit".substring(0, 13);
  const stkAmt      = Math.round(Number(amount));

  let stkData;
  try {
    const stkRes = await fetch(stkUrl + "/mpesa/stkpush/v1/processrequest", {
      method:  "POST",
      headers: {
        Authorization:  "Bearer " + token,
        "Content-Type": "application/json",
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
        TransactionDesc:   txDesc,
      }),
    });
    stkData = await stkRes.json();
  } catch (e) {
    return json({ error: "STK push request failed: " + e.message }, 502);
  }

  if (!stkData || stkData.ResponseCode !== "0")
    return json({
      error: "STK push rejected: " + (
        stkData?.ResponseDescription ||
        stkData?.errorMessage ||
        "Unknown error"
      ),
      detail: stkData,
    }, 502);

  // ── Step 4: Save pending payment row in Supabase ─────────
  if (bookingId) {
    const sb = getSB(env);
    if (sb) {
      const { error: dbErr } = await sb.from("payments").insert({
        booking_id:        bookingId,
        payment_method:    "mpesa",
        amount:            stkAmt,
        status:            "pending",
        mpesa_checkout_id: stkData.CheckoutRequestID,
        mpesa_phone:       fmt,
      });
      if (dbErr) {
        // Non-fatal — STK already sent, log and continue
        console.error("[mpesa] DB insert failed:", dbErr.message);
      }
    }
  }

  return json({
    success:           true,
    checkoutRequestId: stkData.CheckoutRequestID,
    merchantRequestId: stkData.MerchantRequestID,
    message:           "STK push sent — check your phone",
  });
}

// ── CORS preflight ────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}