// functions/api/live-chat.js — Supabase version
// POST: insert a message, returns { success, id }
// GET:  fetch messages for a session
import { getSupabase, jsonRes } from "../_shared/supabase-client.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonRes({ error: "Invalid body" }, 400); }

  const { sessionId, sender, name = null, text, timestamp } = body;
  if (!sessionId || !sender || !text)
    return jsonRes({ error: "sessionId, sender and text are required" }, 400);

  const sb = getSupabase(env);
  const { data, error } = await sb.from("live_chat_messages")
    .insert({ session_id: sessionId, sender, name, text,
               timestamp: timestamp || new Date().toISOString() })
    .select("id").single();

  if (error) return jsonRes({ error: error.message }, 500);

  // Mark all admin messages as read when admin replies
  if (sender === "admin") {
    await sb.from("live_chat_messages")
      .update({ read: true })
      .eq("session_id", sessionId).eq("sender", "user");
  }

  return jsonRes({ success: true, id: data.id });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return jsonRes({ error: "sessionId required" }, 400);

  const sb = getSupabase(env);
  const { data, error } = await sb.from("live_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true })
    .limit(200);

  if (error) return jsonRes({ messages: [], error: error.message });
  return jsonRes({ messages: data });
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