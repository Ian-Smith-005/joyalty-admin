// functions/api/chat-username.js
// POST { username? } — reserve a unique username for a live chat session
// If username is provided, check it's not taken.
// If not provided, auto-generate one like "user_a3k9"
import { createClient } from "@supabase/supabase-js";

function sb(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}
function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function generateUsername() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no confusable chars
  let suffix = "";
  for (let i = 0; i < 4; i++)
    suffix += chars[Math.floor(Math.random() * chars.length)];
  return "user_" + suffix;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ error: "DB not configured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return j({ error: "Invalid body" }, 400);
  }

  const { username: requested } = body;
  const db = sb(env);

  if (requested) {
    // Validate format
    const clean = requested.trim().toLowerCase().replace(/\s+/g, "_");
    if (!/^[a-z0-9_]{3,20}$/.test(clean))
      return j(
        {
          error:
            "Username must be 3-20 lowercase letters, numbers or underscores.",
        },
        400,
      );

    // Check availability
    const { data: existing } = await db
      .from("chat_users")
      .select("id")
      .eq("username", clean)
      .single();
    if (existing)
      return j(
        {
          available: false,
          error: "That username is already taken. Try another.",
        },
        409,
      );

    // Reserve with a placeholder session_id — session generated client-side
    const sessionId = clean + "-" + Date.now();
    const { error } = await db
      .from("chat_users")
      .insert({ username: clean, session_id: sessionId });
    if (error) return j({ error: error.message }, 500);
    return j({ available: true, username: clean, sessionId });
  }

  // Auto-generate — try up to 10 times to avoid collisions
  for (let i = 0; i < 10; i++) {
    const auto = generateUsername();
    const sessionId = auto + "-" + Date.now();
    const { error } = await db
      .from("chat_users")
      .insert({ username: auto, session_id: sessionId });
    if (!error) return j({ username: auto, sessionId, generated: true });
  }

  return j(
    { error: "Could not generate unique username. Please try again." },
    500,
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
