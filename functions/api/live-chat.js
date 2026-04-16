// functions/api/live-chat.js
// POST: insert message (returns id for dedup)
// GET:  fetch messages for a session
// ✅ Uses bare npm specifier — works with Cloudflare Pages + esbuild
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

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL)
    return j({ success: true, warning: "No DB configured" });

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return j({ error: "Invalid body" }, 400);
  }

  const { sessionId, sender, name = null, text, timestamp } = body;
  if (!sessionId || !sender || !text)
    return j({ error: "sessionId, sender and text are required" }, 400);

  const db = sb(env);
  const { data, error } = await db
    .from("live_chat_messages")
    .insert({
      session_id: sessionId,
      sender,
      name,
      text,
      timestamp: timestamp || new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return j({ error: error.message }, 500);

  if (sender === "admin") {
    await db
      .from("live_chat_messages")
      .update({ read: true })
      .eq("session_id", sessionId)
      .eq("sender", "user");
  }

  return j({ success: true, id: data.id });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL) return j({ messages: [] });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return j({ error: "sessionId required" }, 400);

  const db = sb(env);
  const { data, error } = await db
    .from("live_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true })
    .limit(200);

  if (error) return j({ messages: [], error: error.message });
  return j({ messages: data });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
