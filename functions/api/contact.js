// functions/api/contact.js
// Handles contact form submissions and admin email composition.
// Sends to admin + auto-reply to client via Resend.

export async function onRequestPost(context) {
  var request = context.request;
  var env     = context.env;

  if (!env.RESEND_API_KEY) {
    return jsonRes({ error: "RESEND_API_KEY not configured in Cloudflare env vars" }, 500);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonRes({ error: "Invalid request body" }, 400);
  }

  var name    = body.name    || "";
  var email   = body.email   || "";
  var phone   = body.phone   || "";
  var subject = body.subject || "General inquiry";
  var message = body.message || "";

  if (!name || !email || !message) {
    return jsonRes({ error: "name, email and message are required" }, 400);
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return jsonRes({ error: "Invalid email address" }, 400);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var adminEmail = env.ADMIN_EMAIL || "joyaltyphotography254@gmail.com";
  var fromAddr   = env.FROM_EMAIL  || "onboarding@resend.dev";

  var adminHtml = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'>"
    + "<div style='background:#1a1a2e;padding:22px 30px;border-radius:8px 8px 0 0'>"
    + "<h2 style='color:#fff;margin:0'>📷 New Contact Form Submission</h2>"
    + "</div>"
    + "<div style='border:1px solid #e5e7eb;border-top:none;padding:24px 30px;border-radius:0 0 8px 8px'>"
    + "<table style='width:100%;font-size:.9rem;line-height:1.8'>"
    + "<tr><td style='color:#6b7280;width:100px'>Name</td><td><strong>" + esc(name) + "</strong></td></tr>"
    + "<tr><td style='color:#6b7280'>Email</td><td><a href='mailto:" + esc(email) + "'>" + esc(email) + "</a></td></tr>"
    + "<tr><td style='color:#6b7280'>Phone</td><td>" + esc(phone || "Not provided") + "</td></tr>"
    + "<tr><td style='color:#6b7280'>Subject</td><td>" + esc(subject) + "</td></tr>"
    + "</table>"
    + "<hr style='margin:16px 0;border:none;border-top:1px solid #e5e7eb'>"
    + "<p style='color:#6b7280;font-size:.8rem;margin-bottom:6px'>MESSAGE</p>"
    + "<div style='background:#f9fafb;padding:14px;border-radius:6px;font-size:.9rem;line-height:1.7;white-space:pre-wrap'>" + esc(message) + "</div>"
    + "<div style='margin-top:18px'>"
    + "<a href='mailto:" + esc(email) + "?subject=Re: " + esc(subject) + "' style='background:#1a1a2e;color:#fff;padding:10px 20px;border-radius:50px;text-decoration:none;font-size:.85rem;font-weight:700'>Reply to " + esc(name) + "</a>"
    + "</div>"
    + "</div></div>";

  var clientHtml = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto'>"
    + "<div style='background:#1a1a2e;padding:22px 30px;border-radius:8px 8px 0 0;text-align:center'>"
    + "<img src='https://joyaltyphotography.netlify.app/images/templatemo-logo.png' height='40' alt='Joyalty'>"
    + "<h2 style='color:#fff;margin:10px 0 4px'>Thank you, " + esc(name.split(" ")[0]) + "!</h2>"
    + "<p style='color:rgba(255,255,255,.6);margin:0;font-size:.88rem'>We received your message</p>"
    + "</div>"
    + "<div style='border:1px solid #e5e7eb;border-top:none;padding:24px 30px;border-radius:0 0 8px 8px'>"
    + "<p style='font-size:.92rem;line-height:1.75;color:#374151'>Hi " + esc(name.split(" ")[0]) + ", thank you for reaching out to <strong>Joyalty Photography</strong>. We have received your message and will get back to you within <strong>24 hours</strong> (Mon–Sat, 9AM–7PM).</p>"
    + "<div style='background:#f9fafb;padding:14px;border-radius:6px;margin:16px 0;border-left:3px solid #4f46e5;font-size:.88rem;white-space:pre-wrap'>" + esc(message) + "</div>"
    + "<p style='font-size:.75rem;color:#9ca3af;text-align:center;margin:0'>Joyalty Photography · Shanzu, Mombasa · joyaltyphotography254@gmail.com</p>"
    + "</div></div>";

  try {
    var p1 = sendViaResend(env.RESEND_API_KEY, {
      from:     fromAddr,
      to:       [adminEmail],
      subject:  "📷 New enquiry from " + name + (subject ? " — " + subject : ""),
      html:     adminHtml,
      replyTo:  email
    });

    var p2 = sendViaResend(env.RESEND_API_KEY, {
      from:    "Joyalty Photography <" + fromAddr + ">",
      to:      [email],
      subject: "We received your message — Joyalty Photography",
      html:    clientHtml
    });

    await Promise.all([p1, p2]);
    return jsonRes({ success: true, message: "Message sent successfully" });

  } catch (err) {
    console.error("[contact]", err.message);
    return jsonRes({ error: "Failed to send email. Please try again or email us directly." }, 500);
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

async function sendViaResend(apiKey, opts) {
  var res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({
      from:     opts.from,
      to:       opts.to,
      subject:  opts.subject,
      html:     opts.html,
      reply_to: opts.replyTo
    })
  });
  if (!res.ok) {
    var txt = await res.text();
    throw new Error(txt);
  }
  return res.json();
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