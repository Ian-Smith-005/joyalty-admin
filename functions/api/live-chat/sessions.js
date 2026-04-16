// functions/api/live-chat/sessions.js
// GET — all unique sessions for admin contact list
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

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SUPABASE_URL) return j({ sessions: [] });

  const db = sb(env);

  // Fetch all messages ordered newest-first, group in JS
  const { data: rows, error } = await db
    .from("live_chat_messages")
    .select("session_id, name, text, timestamp, sender, read")
    .order("timestamp", { ascending: false })
    .limit(1000);

  if (error) return j({ sessions: [], error: error.message });

  // Build one entry per session_id
  const map = {};
  for (const row of rows || []) {
    if (!map[row.session_id]) {
      map[row.session_id] = {
        session_id: row.session_id,
        name: row.name || row.session_id.split("-")[0],
        last_text: row.text,
        last_at: row.timestamp,
        unread: 0,
      };
    }
    if (row.sender === "user" && !row.read) {
      map[row.session_id].unread++;
    }
  }

  // Sort by most recent first
  const sessions = Object.values(map).sort(
    (a, b) => new Date(b.last_at) - new Date(a.last_at),
  );

  return j({ sessions });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
