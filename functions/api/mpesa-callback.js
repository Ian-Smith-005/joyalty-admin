// functions/api/mpesa-callback.js
// Safaricom posts here after the user acts on the STK prompt.
// ✅ Self-contained — Supabase, no _shared imports, no neon

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getSB(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

function okResponse() {
  return new Response(
    JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function getMeta(items, name) {
  for (const item of items || []) {
    if (item.Name === name) return item.Value;
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch (_) { return okResponse(); }

  const cb = body?.Body?.stkCallback;
  if (!cb) return okResponse();

  const checkoutId = cb.CheckoutRequestID;
  const resultCode = cb.ResultCode;

  // SANDBOX: confirm on any callback. PRODUCTION: only resultCode === 0
  const isSandbox = !env.MPESA_SHORTCODE || env.MPESA_SHORTCODE === "174379";
  const confirmed = isSandbox ? true : resultCode === 0;

  console.log(`[callback] id=${checkoutId} code=${resultCode} sandbox=${isSandbox} confirmed=${confirmed}`);

  if (!env.SUPABASE_URL) {
    console.error("[callback] SUPABASE_URL not set");
    return okResponse();
  }

  const sb = getSB(env);

  if (!confirmed) {
    await sb.from("payments").update({ status: "failed" }).eq("mpesa_checkout_id", checkoutId);
    return okResponse();
  }

  const items    = cb.CallbackMetadata?.Item || [];
  const mpesaRef = getMeta(items, "MpesaReceiptNumber") || `SBX-${checkoutId.slice(-8).toUpperCase()}`;
  const paidAmt  = getMeta(items, "Amount");

  // 1. Mark payment completed
  await sb.from("payments").update({
    status:        "completed",
    mpesa_receipt: mpesaRef,
    completed_at:  new Date().toISOString(),
  }).eq("mpesa_checkout_id", checkoutId);

  // 2. Get booking_id
  const { data: pay } = await sb.from("payments")
    .select("booking_id").eq("mpesa_checkout_id", checkoutId).single();
  if (!pay?.booking_id) return okResponse();
  const bid = pay.booking_id;

  // 3. Get deposit amount from booking
  const { data: bk } = await sb.from("bookings")
    .select("deposit_amount, total_price").eq("id", bid).single();
  const depositPaid = paidAmt ? Number(paidAmt) : Number(bk?.deposit_amount || 0);

  // 4. Confirm booking
  await sb.from("bookings").update({
    status:     "confirmed",
    updated_at: new Date().toISOString(),
  }).eq("id", bid);

  // 5. Update receipt
  await sb.from("receipts").update({
    deposit_paid: depositPaid,
    balance_due:  Number(bk?.total_price || 0) - depositPaid,
    payment_ref:  mpesaRef,
    issued_at:    new Date().toISOString(),
  }).eq("booking_id", bid);

  // 6. Send receipt emails (non-blocking)
  if (env.RESEND_API_KEY) {
    const { data: receipt } = await sb.from("receipts")
      .select("*").eq("booking_id", bid).single();
    if (receipt) {
      sendReceiptEmails(env, receipt).catch(e =>
        console.error("[callback] email error:", e.message)
      );
    }
  }

  return okResponse();
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

// ── Email helpers ─────────────────────────────────────────────
async function sendReceiptEmails(env, r) {
  const adminEmail = env.ADMIN_EMAIL || "joyaltyphotography254@gmail.com";
  const from       = env.FROM_EMAIL  || "onboarding@resend.dev";
  const fmt        = n => `KSh ${Number(n || 0).toLocaleString()}`;
  const esc        = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const issued     = r.issued_at
    ? new Date(r.issued_at).toLocaleDateString("en-KE", { dateStyle: "long" })
    : new Date().toLocaleDateString("en-KE", { dateStyle: "long" });

  const tbl = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.85;color:#3d2e1a">
      <tr><td style="padding:7px 16px;color:#7a6040;width:140px">Name</td><td style="padding:7px 16px;font-weight:600">${esc(r.client_name)}</td></tr>
      <tr style="background:#fdf9f2"><td style="padding:7px 16px;color:#7a6040">Service</td><td style="padding:7px 16px">${esc(r.service_name)}</td></tr>
      <tr><td style="padding:7px 16px;color:#7a6040">Package</td><td style="padding:7px 16px">${esc(r.package_name || "Standard")}</td></tr>
      <tr style="background:#fdf9f2"><td style="padding:7px 16px;color:#7a6040">Date</td><td style="padding:7px 16px">${esc(r.event_date || "TBD")}</td></tr>
      <tr><td style="padding:7px 16px;color:#7a6040">Total</td><td style="padding:7px 16px;font-weight:700">${fmt(r.total_price)}</td></tr>
      <tr style="background:#f0fdf4"><td style="padding:7px 16px;color:#15803d">Deposit Paid</td><td style="padding:7px 16px;font-weight:700;color:#15803d">${fmt(r.deposit_paid)}</td></tr>
      <tr><td style="padding:7px 16px;color:#7a6040">Balance Due</td><td style="padding:7px 16px;font-weight:700">${fmt(r.balance_due)}</td></tr>
      <tr style="background:#fdf9f2"><td style="padding:7px 16px;color:#7a6040">M-Pesa Ref</td><td style="padding:7px 16px;font-family:monospace">${esc(r.payment_ref || "—")}</td></tr>
    </table>`;

  const clientHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#1a0e00;padding:28px 32px;border-radius:8px 8px 0 0;text-align:center">
      <h2 style="color:#d4a84b;margin:0;font-weight:400">Booking Confirmed ✦</h2>
      <p style="color:rgba(255,255,255,.5);margin:8px 0 0;font-size:12px">${esc(r.receipt_ref)} · ${issued}</p>
    </div>
    <div style="border:1px solid #e8d9b5;border-top:none;padding:24px 32px;border-radius:0 0 8px 8px;background:#fff">
      <p style="font-size:14px;color:#3d2e1a;line-height:1.7;margin:0 0 16px">Hi ${esc((r.client_name||"").split(" ")[0])}, your booking with <strong>Joyalty Photography</strong> is confirmed.</p>
      ${tbl}
      <div style="margin:16px 0;padding:12px 16px;background:#fffbeb;border-left:3px solid #d97706;border-radius:4px;font-size:13px;color:#92400e">
        Balance of <strong>${fmt(r.balance_due)}</strong> due on or before event date.
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center">Joyalty Photography · Shanzu, Mombasa, Kenya</p>
    </div>
  </div>`;

  const adminHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#1a0e00;padding:24px 32px;border-radius:8px 8px 0 0">
      <h2 style="color:#d4a84b;margin:0;font-weight:400">💰 New Payment — ${esc(r.receipt_ref)}</h2>
      <p style="color:rgba(255,255,255,.5);margin:6px 0 0;font-size:12px">${issued}</p>
    </div>
    <div style="border:1px solid #e8d9b5;border-top:none;padding:24px 32px;border-radius:0 0 8px 8px;background:#fff">
      ${tbl}
    </div>
  </div>`;

  const sends = [];
  if (r.client_email) {
    sends.push(resendEmail(env.RESEND_API_KEY, {
      from: `Joyalty Photography <${from}>`,
      to:   [r.client_email],
      subject: `Your booking is confirmed — ${r.receipt_ref}`,
      html: clientHtml,
    }));
  }
  sends.push(resendEmail(env.RESEND_API_KEY, {
    from,
    to:      [adminEmail],
    subject: `💰 New payment: ${r.receipt_ref} — ${r.client_name}`,
    html:    adminHtml,
  }));

  return Promise.allSettled(sends);
}

async function resendEmail(apiKey, opts) {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from: opts.from, to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}