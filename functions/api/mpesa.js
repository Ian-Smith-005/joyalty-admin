// functions/api/mpesa.js
// ✅ Uses bare npm specifier — works with Cloudflare Pages + esbuild
import { createClient } from "@supabase/supabase-js";

function sb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}
function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
function pad(n) { return n < 10 ? "0" + n : String(n); }

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (_) { return j({ error: "Invalid JSON body" }, 400); }

  const { phone, amount, bookingId, bookingRef } = body;
  if (!phone || !amount) return j({ error: "phone and amount are required" }, 400);

  const fmt = String(phone).trim().replace(/^\+/, "").replace(/^0/, "254");
  if (!/^254[17]\d{8}$/.test(fmt))
    return j({ error: "Invalid phone. Use 07XXXXXXXX or +2547XXXXXXXX" }, 400);

  // ── SANDBOX (default) ─────────────────────────────────────
  let stkUrl  = "https://sandbox.safaricom.co.ke";
  let stkCode = "174379";
  let stkPass = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
  const conKey = env.MPESA_CONSUMER_KEY;
  const conSec = env.MPESA_CONSUMER_SECRET;

  /* ── PRODUCTION — uncomment + set env vars in Cloudflare ───
  stkUrl  = "https://api.safaricom.co.ke";
  stkCode = env.MPESA_SHORTCODE;
  stkPass = env.MPESA_PASSKEY;
  ──────────────────────────────────────────────────────────── */

  if (!conKey || !conSec)
    return j({ error: "MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be set in Cloudflare env vars" }, 500);

  // 1. OAuth token
  let tokenData;
  try {
    const b64 = btoa(conKey + ":" + conSec);
    const r = await fetch(stkUrl + "/oauth/v1/generate?grant_type=client_credentials", {
      headers: { Authorization: "Basic " + b64 }
    });
    tokenData = await r.json();
  } catch (e) { return j({ error: "OAuth request failed: " + e.message }, 502); }

  if (!tokenData?.access_token)
    return j({ error: "M-Pesa OAuth failed. Check credentials.", detail: tokenData }, 502);

  // 2. Timestamp + password
  const now = new Date();
  const ts  = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) +
              pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const pwd = btoa(stkCode + stkPass + ts);

  // 3. STK push
  const callbackUrl = "https://joyaltyphotography.pages.dev/api/mpesa-callback";
  const stkAmt = Math.round(Number(amount));
  let stkData;
  try {
    const r = await fetch(stkUrl + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: stkCode, Password: pwd, Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: stkAmt, PartyA: fmt, PartyB: stkCode, PhoneNumber: fmt,
        CallBackURL: callbackUrl,
        AccountReference: (bookingRef || "JOYALTY").substring(0, 12),
        TransactionDesc: "Joyalty Deposit".substring(0, 13),
      }),
    });
    stkData = await r.json();
  } catch (e) { return j({ error: "STK push failed: " + e.message }, 502); }

  if (!stkData || stkData.ResponseCode !== "0")
    return j({
      error: "STK push rejected: " + (stkData?.ResponseDescription || stkData?.errorMessage || "Unknown"),
      detail: stkData,
    }, 502);

  // 4. Save pending payment in Supabase (non-fatal if DB not configured)
  if (bookingId) {
    const db = sb(env);
    if (db) {
      const { error: dbErr } = await db.from("payments").insert({
        booking_id: bookingId, payment_method: "mpesa", amount: stkAmt,
        status: "pending", mpesa_checkout_id: stkData.CheckoutRequestID, mpesa_phone: fmt,
      });
      if (dbErr) console.error("[mpesa] DB insert failed:", dbErr.message);
    }
  }

  return j({
    success: true,
    checkoutRequestId: stkData.CheckoutRequestID,
    merchantRequestId: stkData.MerchantRequestID,
    message: "STK push sent — check your phone",
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }});
}