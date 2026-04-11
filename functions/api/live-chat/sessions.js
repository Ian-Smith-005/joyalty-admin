// functions/api/live-chat/sessions.js
// GET — returns all unique sessions for the admin contact list
// Cloudflare Pages function — no Express, plain Response

import { getSupabase } from "../_shared/supabase-client.js";
const sb = getSupabase(env);
const { data: rows, error } = await sb.from("bookings").select("*").eq("id", id);
if (error) return jsonRes({ error: error.message }, 500);


export async function onRequestGet(context) {
  var env = context.env;

  if (!env.DATABASE_URL) {
    return jsonRes({ sessions: [] });
  }

  try {
    var sql  = neon(env.DATABASE_URL);

    // Auto-create table if it doesn't exist yet
    await sql`
      CREATE TABLE IF NOT EXISTS live_chat_messages (
        id         SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender     TEXT NOT NULL,
        name       TEXT,
        text       TEXT NOT NULL,
        timestamp  TIMESTAMPTZ DEFAULT NOW(),
        read       BOOLEAN DEFAULT false
      )
    `;

    // Get one row per session: latest message text + unread count
    var rows = await sql`
      SELECT
        session_id,
        MAX(name)  FILTER (WHERE sender = 'user') AS name,
        (ARRAY_AGG(text ORDER BY timestamp DESC))[1] AS last_text,
        MAX(timestamp)                                AS last_at,
        COUNT(*) FILTER (WHERE sender = 'user' AND read = false) AS unread
      FROM live_chat_messages
      GROUP BY session_id
      ORDER BY MAX(timestamp) DESC
      LIMIT 100
    `;

    var sessions = rows.map(function(r) {
      return {
        session_id: r.session_id,
        name:       r.name || r.session_id.split("-")[0],
        last_text:  r.last_text || "",
        last_at:    r.last_at,
        unread:     Number(r.unread || 0),
      };
    });

    return jsonRes({ sessions: sessions });

  } catch (err) {
    console.error("[live-chat/sessions]", err.message);
    return jsonRes({ sessions: [], error: err.message });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
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