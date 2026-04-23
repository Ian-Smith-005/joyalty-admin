import { useState, useEffect, useRef, useCallback } from "react";
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  ConversationList,
  Conversation,
  ConversationHeader,
  Avatar,
  TypingIndicator,
  MessageSeparator,
  Sidebar,
} from "@chatscope/chat-ui-kit-react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";

const GOLD = "#d4a84b";
const BG = "#0a0810";
const SURF = "rgba(22,18,36,.95)";
const SURF2 = "rgba(30,24,46,.97)";
const BORDER = "rgba(212,168,75,.13)";

const css = `
  :root {
    --cs-conversation-bg: ${SURF};
    --cs-message-bg: rgba(38,30,58,.95);
    --cs-message-outgoing-bg: linear-gradient(135deg,#2a1d08,#3a2808);
    --cs-primary-color: ${GOLD};
  }
  .cs-main-container { background: ${BG} !important; border: none !important; height: 100%; }
  .cs-sidebar { background: ${SURF2} !important; border-right: 1px solid ${BORDER} !important; }
  .cs-conversation-list { background: transparent !important; }
  .cs-conversation { background: transparent !important; border-bottom: 1px solid ${BORDER} !important; transition: background .15s; }
  .cs-conversation:hover, .cs-conversation--active { background: rgba(212,168,75,.1) !important; }
  .cs-conversation__name { color: #f0ece4 !important; font-weight: 700; font-size: .88rem; }
  .cs-conversation__info  { color: rgba(240,236,228,.45) !important; font-size: .75rem; }
  .cs-conversation__unread-dot { background: ${GOLD} !important; }
  .cs-chat-container { background: ${BG} !important; }
  .cs-conversation-header { background: ${SURF2} !important; border-bottom: 1px solid ${BORDER} !important; padding: 10px 16px !important; }
  .cs-conversation-header__content .cs-conversation-header__user-name { color: #f0ece4 !important; font-weight: 700; font-size: .95rem; }
  .cs-conversation-header__content .cs-conversation-header__info { color: rgba(240,236,228,.45) !important; font-size: .75rem; }
  .cs-message-list { background: ${BG} !important; padding: 12px 16px !important; }
  .cs-message-list::-webkit-scrollbar { width: 4px; }
  .cs-message-list::-webkit-scrollbar-thumb { background: rgba(212,168,75,.2); border-radius: 4px; }
  .cs-message__content-wrapper { max-width: 72%; }
  .cs-message--incoming .cs-message__content { background: rgba(38,30,58,.95) !important; color: #f0ece4 !important; border-radius: 4px 14px 14px 14px !important; border: 1px solid rgba(255,255,255,.07) !important; font-size: .88rem; line-height: 1.55; padding: 9px 13px !important; }
  .cs-message--outgoing .cs-message__content { background: linear-gradient(135deg,#2a1d08,#3a2808) !important; color: #f2e4c4 !important; border-radius: 14px 4px 14px 14px !important; border: 1px solid rgba(212,168,75,.2) !important; font-size: .88rem; line-height: 1.55; padding: 9px 13px !important; }
  .cs-message-input { background: ${SURF2} !important; border-top: 1px solid ${BORDER} !important; padding: 10px 12px !important; }
  .cs-message-input__content-editor-wrapper { background: rgba(38,30,58,.9) !important; border: 1px solid ${BORDER} !important; border-radius: 22px !important; padding: 8px 14px !important; transition: border-color .2s; }
  .cs-message-input__content-editor-wrapper:focus-within { border-color: ${GOLD} !important; }
  .cs-message-input__content-editor { color: #f0ece4 !important; font-size: .88rem !important; min-height: 20px !important; max-height: 100px !important; overflow-y: auto !important; }
  .cs-message-input__content-editor[data-placeholder]:empty::before { color: rgba(240,236,228,.35) !important; }
  .cs-button { color: ${GOLD} !important; background: none !important; border: none !important; transition: opacity .2s !important; }
  .cs-button:hover { opacity: .75 !important; }
  .cs-button--send { background: linear-gradient(135deg,#b8860b,${GOLD}) !important; color: #0a0810 !important; border-radius: 50% !important; width: 36px !important; height: 36px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  .cs-typing-indicator { background: transparent !important; color: rgba(240,236,228,.45) !important; font-size: .75rem !important; padding: 6px 16px !important; }
  .cs-typing-indicator__dot { background: ${GOLD} !important; }
  .cs-message-separator { color: rgba(240,236,228,.25) !important; font-size: .7rem !important; }
  .cs-message-separator::before, .cs-message-separator::after { background: rgba(255,255,255,.07) !important; }
  .cs-avatar > img, .cs-avatar__fallback { border-radius: 50% !important; }
`;

function TickIcon({ status }) {
  if (status === "read")
    return (
      <span style={{ color: "#53bdeb", fontSize: ".68rem", marginLeft: 3 }}>
        ✓✓
      </span>
    );
  if (status === "delivered")
    return (
      <span
        style={{
          color: "rgba(240,236,228,.35)",
          fontSize: ".68rem",
          marginLeft: 3,
        }}
      >
        ✓✓
      </span>
    );
  return (
    <span
      style={{
        color: "rgba(240,236,228,.35)",
        fontSize: ".68rem",
        marginLeft: 3,
      }}
    >
      ✓
    </span>
  );
}

function ReactionBar({ reactions, onReact, msgId }) {
  const counts = {};
  Object.values(reactions || {}).forEach((e) => {
    counts[e] = (counts[e] || 0) + 1;
  });
  if (!Object.keys(counts).length) return null;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
      {Object.entries(counts).map(([emoji, count]) => (
        <button
          key={emoji}
          onClick={() => onReact(msgId, emoji)}
          style={{
            background: "rgba(212,168,75,.12)",
            border: "1px solid rgba(212,168,75,.2)",
            borderRadius: 12,
            padding: "1px 7px",
            fontSize: ".78rem",
            cursor: "pointer",
            color: "#f0ece4",
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          {emoji}{" "}
          <span style={{ fontSize: ".68rem", color: "rgba(240,236,228,.5)" }}>
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}

function EmojiPicker({ onSelect, onClose }) {
  const emojis = [
    "👍",
    "❤️",
    "😂",
    "😮",
    "😢",
    "🙏",
    "🔥",
    "✅",
    "👏",
    "🎉",
    "😍",
    "💯",
  ];
  return (
    <div
      style={{
        position: "absolute",
        bottom: 58,
        right: 56,
        background: SURF2,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: 10,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        width: 200,
        zIndex: 100,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
      }}
    >
      {emojis.map((e) => (
        <button
          key={e}
          onClick={() => {
            onSelect(e);
            onClose();
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "1.3rem",
            borderRadius: 8,
            padding: "2px 4px",
            transition: "background .15s",
          }}
          onMouseEnter={(ev) =>
            (ev.target.style.background = "rgba(212,168,75,.1)")
          }
          onMouseLeave={(ev) => (ev.target.style.background = "none")}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function MediaViewer({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.93)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 860,
          width: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "rgba(240,236,228,.7)", fontSize: ".88rem" }}>
            {msg.file_name}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <a
              href={msg.file_url}
              download
              target="_blank"
              rel="noopener"
              style={{
                color: GOLD,
                fontSize: ".82rem",
                textDecoration: "none",
              }}
            >
              ⬇ Download
            </a>
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,.12)",
                border: "none",
                color: "#fff",
                borderRadius: "50%",
                width: 32,
                height: 32,
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              ✕
            </button>
          </div>
        </div>
        {msg.file_type === "image" && (
          <img
            src={msg.file_url}
            alt={msg.file_name}
            style={{
              maxWidth: "100%",
              maxHeight: "80vh",
              borderRadius: 12,
              objectFit: "contain",
            }}
          />
        )}
        {msg.file_type === "pdf" && (
          <iframe
            src={msg.file_url}
            title={msg.file_name}
            style={{
              width: "100%",
              height: "80vh",
              border: "none",
              borderRadius: 12,
              background: "#fff",
            }}
          />
        )}
      </div>
    </div>
  );
}

function AudioPlayer({ src }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audio = useRef(null);

  useEffect(() => {
    audio.current = new Audio(src);
    audio.current.addEventListener("loadedmetadata", () =>
      setDuration(audio.current.duration),
    );
    audio.current.addEventListener("timeupdate", () =>
      setProgress(
        (audio.current.currentTime / audio.current.duration) * 100 || 0,
      ),
    );
    audio.current.addEventListener("ended", () => setPlaying(false));
    return () => {
      audio.current.pause();
    };
  }, [src]);

  const toggle = () => {
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.play();
      setPlaying(true);
    }
  };
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    return m + ":" + (Math.floor(s % 60) + "").padStart(2, "0");
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: "rgba(255,255,255,.06)",
        borderRadius: 22,
        padding: "7px 12px",
        minWidth: 180,
      }}
    >
      <button
        onClick={toggle}
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: `linear-gradient(135deg,#b8860b,${GOLD})`,
          color: "#0a0810",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: ".75rem",
          flexShrink: 0,
        }}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "rgba(255,255,255,.12)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: progress + "%",
            background: GOLD,
            borderRadius: 2,
            transition: "width .1s linear",
          }}
        />
      </div>
      <span
        style={{
          fontSize: ".66rem",
          color: "rgba(240,236,228,.4)",
          flexShrink: 0,
        }}
      >
        {fmt(duration)}
      </span>
    </div>
  );
}

function QuoteBar({ msg, onClear }) {
  if (!msg) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "rgba(212,168,75,.08)",
        borderLeft: `3px solid ${GOLD}`,
        padding: "7px 12px",
        gap: 8,
        borderTop: `1px solid rgba(212,168,75,.15)`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: ".7rem",
            color: GOLD,
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          {msg.sender === "admin" ? "You" : msg.name || "Client"}
        </div>
        <div
          style={{
            fontSize: ".78rem",
            color: "rgba(240,236,228,.5)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {msg.text || "📎 " + (msg.file_name || "file")}
        </div>
      </div>
      <button
        onClick={onClear}
        style={{
          background: "none",
          border: "none",
          color: "rgba(240,236,228,.35)",
          cursor: "pointer",
          fontSize: ".88rem",
          padding: "2px 5px",
        }}
      >
        ✕
      </button>
    </div>
  );
}

function MessageBubble({ msg, onReact, onReply, onMediaClick, isOwn }) {
  const [showActions, setShowActions] = useState(false);
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString(
    "en-KE",
    { hour: "2-digit", minute: "2-digit" },
  );

  const renderContent = () => {
    if (msg.file_type === "image")
      return (
        <img
          src={msg.file_url}
          alt={msg.file_name}
          onClick={() => onMediaClick(msg)}
          style={{
            maxWidth: 220,
            maxHeight: 200,
            borderRadius: 10,
            cursor: "zoom-in",
            display: "block",
            objectFit: "cover",
          }}
        />
      );
    if (msg.file_type === "audio" || msg.file_type === "voice")
      return <AudioPlayer src={msg.file_url} />;
    if (msg.file_type === "pdf")
      return (
        <div
          onClick={() => onMediaClick(msg)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "9px 12px",
            background: "rgba(255,255,255,.06)",
            border: "1px solid rgba(239,68,68,.2)",
            borderRadius: 10,
            cursor: "pointer",
            maxWidth: 240,
          }}
        >
          <span style={{ fontSize: "1.4rem" }}>📄</span>
          <span
            style={{
              fontSize: ".82rem",
              color: "#f0ece4",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {msg.file_name}
          </span>
          <span style={{ fontSize: ".72rem", color: "rgba(240,236,228,.4)" }}>
            ↗
          </span>
        </div>
      );
    if (msg.text)
      return (
        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {msg.text}
        </span>
      );
    return null;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: 6,
        position: "relative",
        cursor: "default",
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {msg.reply_preview && (
        <div
          style={{
            background: "rgba(212,168,75,.08)",
            borderLeft: `3px solid ${GOLD}`,
            borderRadius: "4px 4px 0 0",
            padding: "4px 10px",
            fontSize: ".73rem",
            color: GOLD,
            marginBottom: 2,
            maxWidth: 260,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          ↩ {msg.reply_preview}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          flexDirection: isOwn ? "row-reverse" : "row",
          maxWidth: "72%",
        }}
      >
        {!isOwn && (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "rgba(124,110,240,.6)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: ".75rem",
              fontWeight: 700,
              flexShrink: 0,
              marginBottom: 4,
            }}
          >
            {(msg.name || "?")[0].toUpperCase()}
          </div>
        )}

        <div>
          {!isOwn && (
            <div
              style={{
                fontSize: ".68rem",
                color: GOLD,
                fontWeight: 700,
                marginBottom: 3,
                paddingLeft: 2,
              }}
            >
              {msg.name || "Client"}
            </div>
          )}
          <div
            style={{
              background: isOwn
                ? "linear-gradient(135deg,#2a1d08,#3a2808)"
                : "rgba(38,30,58,.95)",
              border: `1px solid ${isOwn ? "rgba(212,168,75,.2)" : "rgba(255,255,255,.07)"}`,
              borderRadius: isOwn ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
              padding: "9px 13px",
              color: isOwn ? "#f2e4c4" : "#f0ece4",
              fontSize: ".88rem",
              lineHeight: 1.55,
              boxShadow: "0 2px 8px rgba(0,0,0,.3)",
              transition: "box-shadow .15s",
            }}
          >
            {renderContent()}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 3,
                marginTop: 4,
              }}
            >
              <span
                style={{ fontSize: ".64rem", color: "rgba(240,236,228,.3)" }}
              >
                {time}
              </span>
              {isOwn && (
                <TickIcon
                  status={
                    msg.read_at
                      ? "read"
                      : msg.delivered_at
                        ? "delivered"
                        : "sent"
                  }
                />
              )}
            </div>
          </div>
          <ReactionBar
            reactions={msg.reactions}
            onReact={onReact}
            msgId={msg.id}
          />
        </div>
      </div>

      {showActions && (
        <div
          style={{
            position: "absolute",
            [isOwn ? "left" : "right"]: 38,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: 3,
            background: SURF2,
            border: `1px solid ${BORDER}`,
            borderRadius: 22,
            padding: "3px 6px",
            zIndex: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,.4)",
          }}
        >
          {["👍", "❤️", "😂", "🔥"].map((e) => (
            <button
              key={e}
              onClick={() => onReact(msg.id, e)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1rem",
                borderRadius: 8,
                padding: "1px 3px",
                transition: "background .15s",
              }}
              onMouseEnter={(ev) =>
                (ev.target.style.background = "rgba(212,168,75,.1)")
              }
              onMouseLeave={(ev) => (ev.target.style.background = "none")}
            >
              {e}
            </button>
          ))}
          <button
            onClick={() => onReply(msg)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(240,236,228,.45)",
              fontSize: ".82rem",
              padding: "1px 5px",
              borderRadius: 8,
            }}
          >
            ↩
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminChat({
  sessions = [],
  messages = {},
  activeSession,
  onSelectSession,
  onSendMessage,
  onReact,
  typingUsers = {},
  currentUser = "admin",
  sbClient,
}) {
  const [inputValue, setInputValue] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [mediaViewer, setMediaViewer] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef(null);
  const fileInput = useRef(null);
  const msgListRef = useRef(null);

  const activeMessages = messages[activeSession] || [];
  const activeSessionData = sessions.find(
    (s) => s.session_id === activeSession,
  );

  useEffect(() => {
    setTimeout(() => {
      const el = document.querySelector(".cs-message-list");
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, [activeMessages.length]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() && !replyTo) return;
    onSendMessage({
      text: inputValue.trim(),
      sessionId: activeSession,
      replyTo: replyTo?.id || null,
      replyPreview: replyTo
        ? (replyTo.text || replyTo.file_name || "").substring(0, 80)
        : null,
    });
    setInputValue("");
    setReplyTo(null);
    setIsTyping(false);
    clearTimeout(typingTimer.current);
  }, [inputValue, replyTo, activeSession, onSendMessage]);

  const handleTyping = (val) => {
    setInputValue(val);
    if (!isTyping) setIsTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setIsTyping(false), 2000);
  };

  const handleAttach = () => fileInput.current?.click();
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onSendMessage({ file, sessionId: activeSession });
    e.target.value = "";
  };

  const userTyping = activeSession && typingUsers[activeSession];
  const sessionName =
    activeSessionData?.display_name || (activeSession || "").split("-")[0];
  const isOnline = activeSessionData?.online;

  return (
    <>
      <style>{css}</style>
      <style>{`
        .joy-chat-root { height: 100%; font-family: 'Quicksand', sans-serif; }
        .joy-attach-btn, .joy-emoji-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(240,236,228,.4); font-size: 1rem; padding: 6px 8px;
          border-radius: 8px; transition: color .15s, background .15s; flex-shrink: 0;
        }
        .joy-attach-btn:hover, .joy-emoji-btn:hover {
          color: ${GOLD}; background: rgba(212,168,75,.08);
        }
        .joy-input-row { display: flex; align-items: flex-end; gap: 6px; width: 100%; position: relative; }
        .joy-online { width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:5px;box-shadow:0 0 0 2px rgba(34,197,94,.2); }
      `}</style>

      <div className="joy-chat-root">
        <MainContainer
          style={{
            background: BG,
            border: "none",
            borderRadius: 12,
            overflow: "hidden",
            height: "100%",
          }}
        >
          <Sidebar position="left" style={{ minWidth: 260, maxWidth: 280 }}>
            <div
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  fontSize: ".68rem",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "rgba(240,236,228,.35)",
                  marginBottom: 8,
                }}
              >
                Conversations
              </div>
            </div>
            <ConversationList>
              {sessions.map((s) => (
                <Conversation
                  key={s.session_id}
                  name={s.display_name || s.session_id.split("-")[0]}
                  info={
                    (messages[s.session_id] || []).slice(-1)[0]?.text ||
                    "No messages yet"
                  }
                  active={s.session_id === activeSession}
                  unreadCnt={s.unread_count || 0}
                  onClick={() => onSelectSession(s.session_id)}
                >
                  <Avatar
                    name={s.display_name || "?"}
                    style={{
                      background: "rgba(124,110,240,.6)",
                      color: "#fff",
                    }}
                  />
                </Conversation>
              ))}
              {sessions.length === 0 && (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    color: "rgba(240,236,228,.25)",
                    fontSize: ".82rem",
                  }}
                >
                  No live sessions yet
                </div>
              )}
            </ConversationList>
          </Sidebar>

          <ChatContainer style={{ background: BG }}>
            <ConversationHeader>
              <Avatar
                name={sessionName}
                style={{
                  background: activeSession
                    ? "rgba(124,110,240,.6)"
                    : "rgba(255,255,255,.1)",
                  color: "#fff",
                }}
              />
              <ConversationHeader.Content
                userName={
                  <span>
                    {activeSession && isOnline && (
                      <span className="joy-online" />
                    )}
                    {sessionName || "Select a conversation"}
                  </span>
                }
                info={
                  activeSession
                    ? isOnline
                      ? "Online"
                      : "Live chat"
                    : "Choose a session from the left"
                }
              />
            </ConversationHeader>

            <MessageList
              ref={msgListRef}
              typingIndicator={
                userTyping ? (
                  <TypingIndicator content={`${sessionName} is typing`} />
                ) : null
              }
              style={{ background: BG }}
            >
              {activeMessages.length === 0 && activeSession && (
                <MessageSeparator content="Start of conversation" />
              )}

              {activeMessages.map((msg, i) => {
                const isOwn = msg.sender === "admin";
                const prevMsg = activeMessages[i - 1];
                const showSep =
                  prevMsg &&
                  new Date(msg.timestamp).toDateString() !==
                    new Date(prevMsg.timestamp).toDateString();

                return (
                  <div key={msg.id}>
                    {showSep && (
                      <MessageSeparator
                        content={new Date(msg.timestamp).toLocaleDateString(
                          "en-KE",
                          { dateStyle: "long" },
                        )}
                      />
                    )}
                    <Message
                      model={{ direction: isOwn ? "outgoing" : "incoming" }}
                    >
                      <Message.CustomContent>
                        <MessageBubble
                          msg={msg}
                          isOwn={isOwn}
                          onReact={onReact}
                          onReply={setReplyTo}
                          onMediaClick={setMediaViewer}
                        />
                      </Message.CustomContent>
                    </Message>
                  </div>
                );
              })}
            </MessageList>

            <div as="MessageInput" style={{ position: "relative" }}>
              <QuoteBar msg={replyTo} onClear={() => setReplyTo(null)} />
              {showEmoji && (
                <EmojiPicker
                  onSelect={(e) => setInputValue((v) => v + e)}
                  onClose={() => setShowEmoji(false)}
                />
              )}
              <div
                style={{
                  background: SURF2,
                  borderTop: `1px solid ${BORDER}`,
                  padding: "10px 12px",
                }}
              >
                <div className="joy-input-row">
                  <button
                    className="joy-emoji-btn"
                    onClick={() => setShowEmoji((v) => !v)}
                    title="Emoji"
                  >
                    😊
                  </button>
                  <button
                    className="joy-attach-btn"
                    onClick={handleAttach}
                    title="Attach"
                  >
                    📎
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*,.pdf,audio/*"
                    style={{ display: "none" }}
                    onChange={handleFile}
                  />
                  <MessageInput
                    placeholder="Type a message…"
                    value={inputValue}
                    onChange={handleTyping}
                    onSend={handleSend}
                    attachButton={false}
                    style={{ flex: 1 }}
                    disabled={!activeSession}
                  />
                </div>
              </div>
            </div>
          </ChatContainer>
        </MainContainer>
      </div>

      {mediaViewer && (
        <MediaViewer msg={mediaViewer} onClose={() => setMediaViewer(null)} />
      )}
    </>
  );
}
