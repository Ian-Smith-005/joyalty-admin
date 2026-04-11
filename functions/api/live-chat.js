// functions/api/live-chat.js
// POST: user sends a message
// GET:  poll for admin replies by sessionId

import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  var request = context.request;
  var env     = context.env;

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonRes({ error: "Invalid body" }, 400);
  }

  var sessionId = body.sessionId;
  var sender    = body.sender;
  var name      = body.name      || null;
  var text      = body.text;
  var timestamp = body.timestamp || new Date().toISOString();

  if (!sessionId || !sender || !text) {
    return jsonRes({ error: "sessionId, sender and text are required" }, 400);
  }

  if (!env.DATABASE_URL) {
    return jsonRes({ success: true, warning: "No database — message not persisted" });
  }

  try {
    var sql = neon(env.DATABASE_URL);
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
    await sql`
      INSERT INTO live_chat_messages (session_id, sender, name, text, timestamp)
      VALUES (${sessionId}, ${sender}, ${name}, ${text}, ${timestamp})
    `;
    return jsonRes({ success: true });
  } catch (err) {
    console.error("[live-chat POST]", err.message);
    return jsonRes({ error: err.message }, 500);
  }
}

export async function onRequestGet(context) {
  var request = context.request;
  var env     = context.env;

  var url       = new URL(request.url);
  var sessionId = url.searchParams.get("sessionId");

  if (!sessionId) { return jsonRes({ error: "sessionId required" }, 400); }
  if (!env.DATABASE_URL) { return jsonRes({ messages: [] }); }

  try {
    var sql = neon(env.DATABASE_URL);
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
    var rows = await sql`
      SELECT id, session_id, sender, name, text, timestamp
      FROM live_chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY timestamp ASC
      LIMIT 200
    `;
    return jsonRes({ messages: rows });
  } catch (err) {
    console.error("[live-chat GET]", err.message);
    return jsonRes({ messages: [], error: err.message });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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