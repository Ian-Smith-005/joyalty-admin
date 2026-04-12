// functions/api/live-chat/sessions.js
// GET — all unique sessions for admin contact list
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

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return json({ sessions: [] });

  const sb = getSB(env);

  // One row per session: latest message + unread count
  const { data, error } = await sb.rpc("get_live_chat_sessions");

  if (error) {
    // Fallback: manual query if RPC not yet created
    const { data: rows, error: qErr } = await sb
      .from("live_chat_messages")
      .select("session_id, name, text, timestamp, sender, read")
      .order("timestamp", { ascending: false });

    if (qErr) return json({ sessions: [], error: qErr.message });

    // Group by session_id in JS
    const map = {};
    for (const row of rows || []) {
      if (!map[row.session_id]) {
        map[row.session_id] = {
          session_id: row.session_id,
          name:       row.name || row.session_id.split("-")[0],
          last_text:  row.text,
          last_at:    row.timestamp,
          unread:     0,
        };
      }
      if (row.sender === "user" && !row.read) {
        map[row.session_id].unread++;
      }
    }

    return json({ sessions: Object.values(map) });
  }

  return json({ sessions: data || [] });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}