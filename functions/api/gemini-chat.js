// functions/api/gemini-chat.js
export async function onRequestPost(context) {
  const { request, env } = context;

  /*── Guard: API key must exist ──────────────────────────────
  if (!env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not set in Cloudflare Pages environment variables" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  */
if (!env.GEMINI_API_KEY) {
  return new Response(
    JSON.stringify({ error: "GEMINI_API_KEY is missing from env" }),
    { status: 200, headers: corsHeaders() } // 200 so you can read it easily
  );
}
  try {
    const { messages } = await request.json();

    // ── Sanitize conversation for Gemini ──────────────────────
    // Rules:
    //   1. Must start with role "user"
    //   2. Roles must strictly alternate user → model → user → model
    //   3. Strip any leading "model" messages
    const sanitized = [];
    let lastRole = null;

    for (const msg of messages) {
      const role = msg.role === "user" ? "user" : "model";

      // Skip leading model messages
      if (sanitized.length === 0 && role === "model") continue;

      // Skip consecutive duplicate roles (merge by keeping last)
      if (role === lastRole) {
        sanitized[sanitized.length - 1] = msg;
        continue;
      }

      sanitized.push({ role, parts: msg.parts });
      lastRole = role;
    }

    // If sanitization left nothing, send a fallback user message
    if (sanitized.length === 0) {
      sanitized.push({ role: "user", parts: [{ text: "Hello" }] });
    }

    // ── Call Gemini ────────────────────────────────────────────
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: `You are Joy, the friendly AI assistant for Joyalty Photography Studio based in Nairobi, Kenya.
You are warm, professional, and concise — never robotic.

SERVICES & PRICING:
- Wedding Photography: from KSh 35,000 (full day coverage, edited gallery)
- Portrait Sessions: from KSh 8,000 (studio or outdoor, 1–2 hours)
- Commercial Shoots: from KSh 20,000 (products, brands, corporate)
- Event Coverage: from KSh 15,000 (conferences, parties, graduations)

BOOKING:
- When a client wants to book, respond warmly then end with exactly: [START_BOOKING]
- This triggers the booking system automatically

CONTACT:
- Email: info@joyalty.com
- Phone: +254 XXX XXX
- Location: Nairobi, Kenya

RULES:
- Never invent services or prices not listed above
- Keep replies under 3 sentences unless the client asks for detail
- Always be encouraging and positive about their event or project
- If asked something outside photography, gently redirect`
            }]
          },
          contents: sanitized,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300,
          }
        })
      }
    );

    // ── Parse Gemini response ──────────────────────────────────
    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: data?.error?.message || "Gemini API error", detail: data }),
        { status: 502, headers: corsHeaders() }
      );
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I'm here to help! Feel free to ask about our services or booking.";

    return new Response(JSON.stringify({ reply }), { headers: corsHeaders() });

  } catch (err) {
    console.error("Function error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}