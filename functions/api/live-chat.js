// functions/api/live-chat.js
// ✅ Self-contained — no _shared imports

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getSB(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// POST — insert a message
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: "Invalid body" }, 400); }

  const { sessionId, sender, name = null, text, timestamp } = body;
  if (!sessionId || !sender || !text)
    return json({ error: "sessionId, sender and text are required" }, 400);

  if (!env.SUPABASE_URL) return json({ success: true, warning: "No DB" });

  const sb = getSB(env);
  const { data, error } = await sb.from("live_chat_messages")
    .insert({
      session_id: sessionId, sender, name, text,
      timestamp: timestamp || new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return json({ error: error.message }, 500);

  // Mark user messages as read when admin replies
  if (sender === "admin") {
    await sb.from("live_chat_messages")
      .update({ read: true })
      .eq("session_id", sessionId)
      .eq("sender", "user");
  }

  return json({ success: true, id: data.id });
}

// GET — fetch messages for a session
export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return json({ error: "sessionId required" }, 400);
  if (!env.SUPABASE_URL) return json({ messages: [] });

  const sb = getSB(env);
  const { data, error } = await sb.from("live_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true })
    .limit(200);

  if (error) return json({ messages: [], error: error.message });
  return json({ messages: data });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}