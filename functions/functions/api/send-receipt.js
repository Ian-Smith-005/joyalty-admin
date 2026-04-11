// functions/api/send-receipt.js
// Called after payment is confirmed.
// Emails a beautifully styled receipt to the client AND admin via Resend.

export async function sendReceiptEmails(env, receipt) {
  if (!env.RESEND_API_KEY) {
    console.warn("[send-receipt] RESEND_API_KEY not set — skipping email");
    return;
  }

  const adminEmail  = env.ADMIN_EMAIL  || "joyaltyphotography254@gmail.com";
  const fromAddress = env.FROM_EMAIL   || "onboarding@resend.dev";

  const {
    receipt_ref, booking_ref,
    client_name, client_email, client_phone,
    service_name, package_name, extra_name,
    event_date, event_time, location,
    total_price, deposit_paid, balance_due,
    payment_ref,
    issued_at,
  } = receipt;

  const issuedFormatted = issued_at
    ? new Date(issued_at).toLocaleDateString("en-KE", { dateStyle: "long" })
    : new Date().toLocaleDateString("en-KE", { dateStyle: "long" });

  const fmt = (n) => `KSh ${Number(n || 0).toLocaleString()}`;

  // ── Shared inline receipt table ────────────────────────────
  const receiptTable = `
<table width="100%" cellpadding="0" cellspacing="0" border="0"
  style="border-collapse:collapse;font-family:Georgia,serif;font-size:13px;line-height:1.9;color:#3d2e1a">

  <!-- CLIENT SECTION -->
  <tr>
    <td colspan="2"
      style="padding:8px 16px;background:#f9f4ea;border-top:1px solid #e8d9b5;border-bottom:1px solid #e8d9b5;
             font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9a7a3a">
      Client
    </td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040;width:140px">Name</td>
    <td style="padding:7px 16px;font-weight:600">${esc(client_name || "")}</td>
  </tr>
  <tr style="background:#fdf9f2">
    <td style="padding:7px 16px;color:#7a6040">Email</td>
    <td style="padding:7px 16px">${esc(client_email || "")}</td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Phone</td>
    <td style="padding:7px 16px">${esc(client_phone || "")}</td>
  </tr>

  <!-- BOOKING SECTION -->
  <tr>
    <td colspan="2"
      style="padding:8px 16px;background:#f9f4ea;border-top:1px solid #e8d9b5;border-bottom:1px solid #e8d9b5;
             font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9a7a3a">
      Booking Details
    </td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Service</td>
    <td style="padding:7px 16px;font-weight:600">${esc(service_name || "")}</td>
  </tr>
  <tr style="background:#fdf9f2">
    <td style="padding:7px 16px;color:#7a6040">Package</td>
    <td style="padding:7px 16px">${esc(package_name || "Standard")}</td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Extras</td>
    <td style="padding:7px 16px">${esc(extra_name || "None")}</td>
  </tr>
  <tr style="background:#fdf9f2">
    <td style="padding:7px 16px;color:#7a6040">Date</td>
    <td style="padding:7px 16px">${esc(event_date || "TBD")}</td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Time</td>
    <td style="padding:7px 16px">${esc(event_time || "TBD")}</td>
  </tr>
  <tr style="background:#fdf9f2">
    <td style="padding:7px 16px;color:#7a6040">Location</td>
    <td style="padding:7px 16px">${esc(location || "TBD")}</td>
  </tr>

  <!-- PAYMENT SECTION -->
  <tr>
    <td colspan="2"
      style="padding:8px 16px;background:#f9f4ea;border-top:1px solid #e8d9b5;border-bottom:1px solid #e8d9b5;
             font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9a7a3a">
      Payment
    </td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Total Price</td>
    <td style="padding:7px 16px;font-weight:700">${fmt(total_price)}</td>
  </tr>
  <tr style="background:#f0fdf4">
    <td style="padding:7px 16px;color:#15803d">Deposit Paid</td>
    <td style="padding:7px 16px;font-weight:700;color:#15803d">${fmt(deposit_paid)}</td>
  </tr>
  <tr>
    <td style="padding:7px 16px;color:#7a6040">Balance Due</td>
    <td style="padding:7px 16px;font-weight:700">${fmt(balance_due)}</td>
  </tr>
  <tr style="background:#fdf9f2">
    <td style="padding:7px 16px;color:#7a6040">M-Pesa Ref</td>
    <td style="padding:7px 16px;font-family:monospace;font-size:12px;letter-spacing:.06em">${esc(payment_ref || "—")}</td>
  </tr>
</table>`;

  // ── CLIENT RECEIPT EMAIL ───────────────────────────────────
  const clientHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr>
    <td style="
      background: linear-gradient(160deg, #1a0e00 0%, #2d1a00 50%, #1a0e00 100%);
      padding: 36px 40px 28px;
      border-radius: 12px 12px 0 0;
      text-align: center;
      position: relative;
    ">
      <!-- Gold decorative line -->
      <div style="width:48px;height:2px;background:linear-gradient(90deg,transparent,#d4a84b,transparent);margin:0 auto 20px"></div>

      <img src="https://joyaltyphotography.netlify.app/images/templatemo-logo.png"
           height="48" alt="Joyalty Photography"
           style="margin-bottom:16px;opacity:.95">

      <h1 style="
        color:#d4a84b;
        font-family:Georgia,serif;
        font-size:22px;
        font-weight:400;
        letter-spacing:.06em;
        margin:0 0 6px;
      ">Booking Confirmed ✦</h1>

      <p style="color:rgba(255,255,255,.5);font-size:12px;margin:0;letter-spacing:.08em;text-transform:uppercase">
        Your session is secured
      </p>

      <!-- Receipt ref badge -->
      <div style="
        display:inline-block;
        margin-top:18px;
        background:rgba(212,168,75,.12);
        border:1px solid rgba(212,168,75,.3);
        border-radius:99px;
        padding:5px 18px;
        font-size:11px;
        color:#d4a84b;
        letter-spacing:.1em;
        font-family:monospace;
      ">${esc(receipt_ref || "")} &nbsp;·&nbsp; ${issuedFormatted}</div>

      <div style="width:48px;height:2px;background:linear-gradient(90deg,transparent,#d4a84b,transparent);margin:22px auto 0"></div>
    </td>
  </tr>

  <!-- INTRO MESSAGE -->
  <tr>
    <td style="background:#fff;padding:28px 40px 20px;border-left:1px solid #e8d9b5;border-right:1px solid #e8d9b5">
      <p style="font-size:15px;line-height:1.75;color:#3d2e1a;margin:0">
        Dear <strong>${esc((client_name || "").split(" ")[0])}</strong>,
      </p>
      <p style="font-size:14px;line-height:1.8;color:#5a4a30;margin:12px 0 0">
        Thank you for choosing <strong style="color:#3d2e1a">Joyalty Photography</strong>.
        Your deposit has been received and your booking is now confirmed.
        Here is your official receipt — please keep it for your records.
      </p>
    </td>
  </tr>

  <!-- RECEIPT TABLE -->
  <tr>
    <td style="background:#fff;padding:0 40px 8px;border-left:1px solid #e8d9b5;border-right:1px solid #e8d9b5">
      <!-- Gold divider -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,#d4a84b 30%,#d4a84b 70%,transparent);margin-bottom:16px"></div>
      ${receiptTable}
    </td>
  </tr>

  <!-- BALANCE REMINDER -->
  <tr>
    <td style="background:#fff;padding:20px 40px;border-left:1px solid #e8d9b5;border-right:1px solid #e8d9b5">
      <div style="
        background:#fffbeb;
        border:1px solid #fde68a;
        border-left:4px solid #d97706;
        border-radius:8px;
        padding:14px 18px;
      ">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.7">
          <strong>Reminder:</strong> A balance of <strong>${fmt(balance_due)}</strong>
          remains due on or before the event date.
          You may pay via M-Pesa or contact us to arrange.
        </p>
      </div>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="
      background:linear-gradient(160deg,#1a0e00,#2d1a00);
      padding:28px 40px;
      border-radius:0 0 12px 12px;
      text-align:center;
    ">
      <div style="width:32px;height:1px;background:rgba(212,168,75,.4);margin:0 auto 16px"></div>
      <p style="margin:0 0 6px;font-size:12px;color:rgba(255,255,255,.5);letter-spacing:.08em;text-transform:uppercase">
        Joyalty Photography
      </p>
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,.3)">
        Shanzu, Mombasa, Kenya &nbsp;·&nbsp; joyaltyphotography254@gmail.com &nbsp;·&nbsp; +254 XXX XXX
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  // ── ADMIN NOTIFICATION EMAIL ───────────────────────────────
  const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr>
    <td style="
      background:linear-gradient(160deg,#1a0e00,#2d1a00);
      padding:28px 36px 24px;
      border-radius:12px 12px 0 0;
    ">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="
          width:44px;height:44px;border-radius:10px;
          background:rgba(212,168,75,.15);border:1px solid rgba(212,168,75,.3);
          display:inline-flex;align-items:center;justify-content:center;
          font-size:20px;vertical-align:middle;margin-right:12px
        ">💰</div>
        <span>
          <div style="color:#d4a84b;font-size:17px;font-weight:400;letter-spacing:.03em">
            New Payment Received
          </div>
          <div style="color:rgba(255,255,255,.45);font-size:11px;margin-top:3px;letter-spacing:.06em;text-transform:uppercase">
            ${esc(receipt_ref || "")} &nbsp;·&nbsp; ${issuedFormatted}
          </div>
        </span>
      </div>
    </td>
  </tr>

  <!-- TABLE -->
  <tr>
    <td style="background:#fff;padding:24px 36px;border-left:1px solid #e8d9b5;border-right:1px solid #e8d9b5">
      ${receiptTable}
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="background:#fff;padding:0 36px 24px;border-left:1px solid #e8d9b5;border-right:1px solid #e8d9b5">
      <a href="mailto:${esc(client_email || "")}?subject=Your Joyalty Booking ${esc(booking_ref || "")}"
         style="
           display:inline-block;
           background:linear-gradient(135deg,#b8860b,#d4a84b);
           color:#1a0e00;
           padding:11px 26px;
           border-radius:8px;
           text-decoration:none;
           font-size:13px;
           font-weight:700;
           letter-spacing:.04em;
         ">
        Email Client →
      </a>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="
      background:linear-gradient(160deg,#1a0e00,#2d1a00);
      padding:20px 36px;
      border-radius:0 0 12px 12px;
      text-align:center;
    ">
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,.3)">
        Joyalty Photography Admin · Shanzu, Mombasa
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  // ── Send both ──────────────────────────────────────────────
  const sends = [];

  if (client_email) {
    sends.push(sendEmail(env.RESEND_API_KEY, {
      from:    `Joyalty Photography <${fromAddress}>`,
      to:      [client_email],
      subject: `Your booking is confirmed — ${receipt_ref}`,
      html:    clientHtml,
    }).catch(e => console.error("[send-receipt] client email failed:", e.message)));
  }

  sends.push(sendEmail(env.RESEND_API_KEY, {
    from:    fromAddress,
    to:      [adminEmail],
    subject: `💰 New booking payment: ${receipt_ref} — ${client_name}`,
    html:    adminHtml,
  }).catch(e => console.error("[send-receipt] admin email failed:", e.message)));

  await Promise.all(sends);
}

// ── Helpers ────────────────────────────────────────────────────
async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data));
  return data;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}