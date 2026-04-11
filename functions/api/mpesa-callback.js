// functions/api/mpesa-callback.js
// Safaricom posts here after the user acts on the STK prompt.
// SANDBOX: ANY callback = confirmed (cancel 1032 treated as success).
// PRODUCTION: change confirmed line as marked below.
// Self-contained — no relative imports (Cloudflare Pages limitation).

import { getSupabase } from "../_shared/supabase-client.js";
const sb = getSupabase(env);
const { data: rows, error } = await sb.from("bookings").select("*").eq("id", id);
if (error) return jsonRes({ error: error.message }, 500);

export async function onRequestPost(context) {
  var request = context.request;
  var env     = context.env;

  var body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("[callback] parse error");
    return okResponse();
  }

  var cb = body && body.Body && body.Body.stkCallback;
  if (!cb) { return okResponse(); }

  var checkoutId = cb.CheckoutRequestID;
  var resultCode = cb.ResultCode;

  // SANDBOX: confirm on any resultCode (0 = paid, 1032 = cancelled)
  // PRODUCTION: change next line to → var confirmed = (resultCode === 0);
  var isSandbox = !env.MPESA_SHORTCODE
    || env.MPESA_SHORTCODE.indexOf("#") === 0
    || env.MPESA_SHORTCODE === "174379";
  var confirmed = isSandbox ? true : (resultCode === 0);

  console.log("[callback] id=" + checkoutId + " code=" + resultCode + " sandbox=" + isSandbox + " confirmed=" + confirmed);

  if (!env.DATABASE_URL) {
    console.error("[callback] DATABASE_URL not set");
    return okResponse();
  }

  var sql = neon(env.DATABASE_URL);

  if (confirmed) {
    var items     = (cb.CallbackMetadata && cb.CallbackMetadata.Item) ? cb.CallbackMetadata.Item : [];
    var mpesaRef  = getMeta(items, "MpesaReceiptNumber") || ("SBX-" + checkoutId.slice(-8).toUpperCase());
    var paidAmt   = getMeta(items, "Amount") || null;

    try {
      // 1. Mark payment completed
      await sql`
        UPDATE payments
        SET status = ${"completed"}, mpesa_receipt = ${mpesaRef}, completed_at = NOW()
        WHERE mpesa_checkout_id = ${checkoutId}
      `;

      // 2. Get booking_id
      var payRows = await sql`
        SELECT booking_id FROM payments WHERE mpesa_checkout_id = ${checkoutId}
      `;
      if (!payRows || !payRows[0]) {
        console.error("[callback] no payment row for", checkoutId);
        return okResponse();
      }
      var bid = payRows[0].booking_id;

      // 3. Get deposit amount
      var bkRows = await sql`SELECT deposit_amount, total_price FROM bookings WHERE id = ${bid}`;
      var depositPaid = paidAmt ? Number(paidAmt) : (bkRows[0] ? Number(bkRows[0].deposit_amount) : 0);

      // 4. Confirm booking
      await sql`UPDATE bookings SET status = ${"confirmed"}, updated_at = NOW() WHERE id = ${bid}`;

      // 5. Update receipt — frontend polls for deposit_paid > 0
      await sql`
        UPDATE receipts
        SET
          deposit_paid = ${depositPaid},
          balance_due  = total_price - ${depositPaid},
          payment_ref  = ${mpesaRef},
          issued_at    = NOW()
        WHERE booking_id = ${bid}
      `;

      console.log("[callback] booking " + bid + " confirmed — " + mpesaRef);

      // 6. Email receipt (non-blocking)
      if (env.RESEND_API_KEY) {
        var rptRows = await sql`SELECT * FROM receipts WHERE booking_id = ${bid}`;
        if (rptRows && rptRows[0]) {
          sendEmails(env, rptRows[0]).catch(function(e) {
            console.error("[callback] email error:", e.message);
          });
        }
      }

    } catch (dbErr) {
      console.error("[callback] DB error:", dbErr.message);
    }

  } else {
    try {
      await sql`UPDATE payments SET status = ${"failed"} WHERE mpesa_checkout_id = ${checkoutId}`;
    } catch (e) {
      console.error("[callback] failed-update error:", e.message);
    }
  }

  return okResponse();
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

function okResponse() {
  return new Response(
    JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function getMeta(items, name) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].Name === name) { return items[i].Value; }
  }
  return null;
}

async function sendEmails(env, r) {
  var adminEmail = env.ADMIN_EMAIL || "joyaltyphotography254@gmail.com";
  var fromAddr   = env.FROM_EMAIL  || "onboarding@resend.dev";

  function fmt(n) { return "KSh " + Number(n || 0).toLocaleString(); }
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var issued = r.issued_at
    ? new Date(r.issued_at).toLocaleDateString("en-KE", { dateStyle: "long" })
    : new Date().toLocaleDateString("en-KE", { dateStyle: "long" });

  var tbl = "<table style='width:100%;border-collapse:collapse;font-size:13px;line-height:1.85'>"
    + "<tr style='background:#f3f4f6'><td colspan='2' style='padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280'>Client</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280;width:130px'>Name</td><td>" + esc(r.client_name) + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Email</td><td>" + esc(r.client_email) + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Phone</td><td>" + esc(r.client_phone) + "</td></tr>"
    + "<tr style='background:#f3f4f6'><td colspan='2' style='padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280'>Booking</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Service</td><td>" + esc(r.service_name) + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Package</td><td>" + esc(r.package_name || "Standard") + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Extras</td><td>" + esc(r.extra_name || "None") + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Date</td><td>" + esc(r.event_date || "TBD") + "</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Location</td><td>" + esc(r.location || "TBD") + "</td></tr>"
    + "<tr style='background:#f3f4f6'><td colspan='2' style='padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280'>Payment</td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Total</td><td><strong>" + fmt(r.total_price) + "</strong></td></tr>"
    + "<tr><td style='padding:5px 12px;color:#16a34a'>Deposit Paid</td><td><strong style='color:#16a34a'>" + fmt(r.deposit_paid) + "</strong></td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>Balance Due</td><td><strong>" + fmt(r.balance_due) + "</strong></td></tr>"
    + "<tr><td style='padding:5px 12px;color:#6b7280'>M-Pesa Ref</td><td style='font-family:monospace'>" + esc(r.payment_ref || "—") + "</td></tr>"
    + "</table>";

  var clientHtml = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'>"
    + "<div style='background:#1a1a2e;padding:22px 30px;border-radius:8px 8px 0 0;text-align:center'>"
    + "<img src='https://joyaltyphotography.netlify.app/images/templatemo-logo.png' height='42' alt='Joyalty'>"
    + "<h2 style='color:#fff;margin:10px 0 4px'>Booking Confirmed ✅</h2>"
    + "<p style='color:rgba(255,255,255,.6);margin:0;font-size:.85rem'>" + esc(r.receipt_ref) + " · " + issued + "</p>"
    + "</div>"
    + "<div style='border:1px solid #e5e7eb;border-top:none;padding:24px 30px;border-radius:0 0 8px 8px'>"
    + "<p style='font-size:.9rem;line-height:1.7;color:#374151;margin-bottom:16px'>Hi " + esc((r.client_name || "").split(" ")[0]) + ", your booking with <strong>Joyalty Photography</strong> is confirmed.</p>"
    + tbl
    + "<div style='margin:16px 0;padding:12px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:.85rem;color:#92400e'>Balance of <strong>" + fmt(r.balance_due) + "</strong> is due on or before the event date.</div>"
    + "<p style='font-size:.75rem;color:#9ca3af;text-align:center;margin:0'>Joyalty Photography · Shanzu, Mombasa · joyaltyphotography254@gmail.com</p>"
    + "</div></div>";

  var adminHtml = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'>"
    + "<div style='background:#1a1a2e;padding:22px 30px;border-radius:8px 8px 0 0'>"
    + "<h2 style='color:#fff;margin:0'>💰 New Payment — " + esc(r.receipt_ref) + "</h2>"
    + "<p style='color:rgba(255,255,255,.6);margin:5px 0 0;font-size:.82rem'>" + issued + "</p>"
    + "</div>"
    + "<div style='border:1px solid #e5e7eb;border-top:none;padding:24px 30px;border-radius:0 0 8px 8px'>"
    + tbl + "</div></div>";

  var sends = [];
  if (r.client_email) {
    sends.push(resendEmail(env.RESEND_API_KEY, {
      from:    "Joyalty Photography <" + fromAddr + ">",
      to:      [r.client_email],
      subject: "Your booking is confirmed — " + r.receipt_ref,
      html:    clientHtml
    }));
  }
  sends.push(resendEmail(env.RESEND_API_KEY, {
    from:    fromAddr,
    to:      [adminEmail],
    subject: "💰 New payment: " + r.receipt_ref + " — " + r.client_name,
    html:    adminHtml
  }));

  return Promise.allSettled(sends);
}

async function resendEmail(apiKey, opts) {
  var res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({
      from:    opts.from,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html
    })
  });
  if (!res.ok) {
    var txt = await res.text();
    throw new Error("Resend error: " + txt);
  }
  return res.json();
}