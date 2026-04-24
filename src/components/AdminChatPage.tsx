import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import AdminChat from "./AdminChat";

const SB_URL = window.SUPABASE_URL || "";
const SB_ANON = window.SUPABASE_ANON || "";
const sbClient = SB_URL && SB_ANON ? createClient(SB_URL, SB_ANON) : null;

export default function AdminChatPage() {
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState({});
  const [activeSession, setActiveSession] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const sentIds = useRef(new Set());
  const rtChannel = useRef(null);

  useEffect(() => {
    loadSessions();
    subscribeRealtime();
    return () => {
      if (rtChannel.current && sbClient)
        sbClient.removeChannel(rtChannel.current);
    };
  }, []);

  async function loadSessions() {
    try {
      const r = await fetch("/api/live-chat/sessions");
      const d = await r.json();
      setSessions(d.sessions || []);
    } catch (_) {}
  }

  function subscribeRealtime() {
    if (!sbClient) return;
    rtChannel.current = sbClient
      .channel("admin-live-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_chat_messages" },
        (payload) => {
          const msg = payload.new;
          if (!msg) return;
          if (msg.sender === "admin" && sentIds.current.has(String(msg.id)))
            return;
          setMessages((prev) => {
            const existing = prev[msg.session_id] || [];
            if (existing.some((m) => String(m.id) === String(msg.id)))
              return prev;
            return { ...prev, [msg.session_id]: [...existing, msg] };
          });
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.session_id === msg.session_id);
            if (idx === -1) {
              loadSessions();
              return prev;
            }
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_text: msg.text,
              unread_count:
                msg.sender === "user"
                  ? (updated[idx].unread_count || 0) + 1
                  : updated[idx].unread_count,
            };
            return updated;
          });
        },
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.sender === "user") {
          setTypingUsers((prev) => ({
            ...prev,
            [payload.sessionId]: payload.typing,
          }));
          if (payload.typing) {
            setTimeout(
              () =>
                setTypingUsers((prev) => ({
                  ...prev,
                  [payload.sessionId]: false,
                })),
              3000,
            );
          }
        }
      })
      .subscribe();
  }

  async function handleSelectSession(sessionId) {
    setActiveSession(sessionId);
    setSessions((prev) =>
      prev.map((s) =>
        s.session_id === sessionId ? { ...s, unread_count: 0 } : s,
      ),
    );
    if (!messages[sessionId]) {
      try {
        const r = await fetch(
          `/api/live-chat?sessionId=${encodeURIComponent(sessionId)}`,
        );
        const d = await r.json();
        setMessages((prev) => ({ ...prev, [sessionId]: d.messages || [] }));
      } catch (_) {}
    }
    await markRead(sessionId);
  }

  async function markRead(sessionId) {
    try {
      await fetch("/api/live-chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reader: "admin" }),
      });
      setMessages((prev) => ({
        ...prev,
        [sessionId]: (prev[sessionId] || []).map((m) =>
          m.sender === "user" && !m.read_at
            ? { ...m, read_at: new Date().toISOString() }
            : m,
        ),
      }));
    } catch (_) {}
  }

  async function handleSendMessage({
    text,
    file,
    sessionId,
    replyTo,
    replyPreview,
  }) {
    if (!sessionId) return;
    const tempId = "tmp-" + Date.now();

    if (file) {
      if (!sbClient) return;
      const ext = file.name.split(".").pop() || "bin";
      const path = `chat/admin-${Date.now()}.${ext}`;
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type === "application/pdf"
          ? "pdf"
          : file.type.startsWith("audio/")
            ? "audio"
            : "file";
      try {
        await sbClient.storage
          .from("chat-files")
          .upload(path, file, { cacheControl: "3600" });
        const { data: pub } = sbClient.storage
          .from("chat-files")
          .getPublicUrl(path);
        const fakeMsg = {
          id: tempId,
          sender: "admin",
          name: "Admin",
          text: "",
          timestamp: new Date().toISOString(),
          file_url: pub.publicUrl,
          file_type: type,
          file_name: file.name,
          file_size: file.size,
          reply_to_id: replyTo || null,
          reply_preview: replyPreview || null,
          reactions: {},
        };
        setMessages((prev) => ({
          ...prev,
          [sessionId]: [...(prev[sessionId] || []), fakeMsg],
        }));
        sentIds.current.add(tempId);
        const res = await fetch("/api/live-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            sender: "admin",
            name: "Admin",
            text: "",
            timestamp: fakeMsg.timestamp,
            fileUrl: pub.publicUrl,
            fileType: type,
            fileName: file.name,
            fileSize: file.size,
          }),
        });
        const data = await res.json();
        if (data.id) {
          sentIds.current.add(String(data.id));
          setMessages((prev) => ({
            ...prev,
            [sessionId]: (prev[sessionId] || []).map((m) =>
              String(m.id) === tempId ? { ...m, id: data.id } : m,
            ),
          }));
        }
      } catch (_) {}
      return;
    }

    if (!text) return;
    const fakeMsg = {
      id: tempId,
      sender: "admin",
      name: "Admin",
      text,
      timestamp: new Date().toISOString(),
      reply_to_id: replyTo || null,
      reply_preview: replyPreview || null,
      reactions: {},
      delivered_at: new Date().toISOString(),
    };
    setMessages((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] || []), fakeMsg],
    }));
    sentIds.current.add(tempId);

    try {
      const res = await fetch("/api/live-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          sender: "admin",
          name: "Admin",
          text,
          timestamp: fakeMsg.timestamp,
          replyToId: replyTo || null,
          replyPreview: replyPreview || null,
        }),
      });
      const data = await res.json();
      if (data.id) {
        sentIds.current.add(String(data.id));
        setMessages((prev) => ({
          ...prev,
          [sessionId]: (prev[sessionId] || []).map((m) =>
            String(m.id) === tempId ? { ...m, id: data.id } : m,
          ),
        }));
      }
    } catch (_) {}
  }

  const handleReact = useCallback(
    async (msgId, emoji) => {
      if (!activeSession) return;
      setMessages((prev) => ({
        ...prev,
        [activeSession]: (prev[activeSession] || []).map((m) => {
          if (String(m.id) !== String(msgId)) return m;
          const reactions = { ...(m.reactions || {}) };
          const key = "admin";
          if (reactions[key] === emoji) delete reactions[key];
          else reactions[key] = emoji;
          return { ...m, reactions };
        }),
      }));
      if (!sbClient) return;
      const msg = (messages[activeSession] || []).find(
        (m) => String(m.id) === String(msgId),
      );
      if (!msg) return;
      const reactions = { ...(msg.reactions || {}) };
      const key = "admin";
      if (reactions[key] === emoji) delete reactions[key];
      else reactions[key] = emoji;
      await sbClient
        .from("live_chat_messages")
        .update({ reactions })
        .eq("id", msgId);
    },
    [activeSession, messages, sbClient],
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <AdminChat
        sessions={sessions}
        messages={messages}
        activeSession={activeSession}
        onSelectSession={handleSelectSession}
        onSendMessage={handleSendMessage}
        onReact={handleReact}
        typingUsers={typingUsers}
        currentUser="admin"
        sbClient={sbClient}
      />
    </div>
  );
}
