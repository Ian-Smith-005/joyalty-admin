/* ================================================================
   JOYALTY ADMIN — admin-wa.js
   WhatsApp-style chat logic for the admin panel.
   Plain vanilla JS, no framework, no bundler required.
   Load AFTER admin.js in admin/index.html:
     <script src="assets/admin-wa.js"></script>
================================================================ */

/* ── State ──────────────────────────────────────────────────── */
let waMode = "bot";
let waSessions = [];
let waMessages = {};
let waActive = null;
let waSentIds = new Set();
let waReplyTo = null;
let waRtCh = null;
let waPresenceCh = null;
let waTypingTimer = null;
let waIsTyping = false;
let waMediaRecorder = null;
let waAudioChunks = [];
let waAudioPlayers = {};
let waOnlineUsers = {};
let waReactions = {}; // msgId → { adminKey: emoji, … }

const WA_EMOJIS = [
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
  "🎊",
  "✨",
  "🤩",
  "😊",
];

/* ── Init (called when chat tab opens) ─────────────────────── */
function waInit() {
  waRenderModeUI();
  if (waMode === "bot") waStartBot();
  else waLoadSessions();
  waSubscribeRealtime();
}

/* ── Mode toggle ────────────────────────────────────────────── */
function waSetMode(mode) {
  waMode = mode;
  waRenderModeUI();
  waMsgs().innerHTML = "";
  waActive = null;
  document.getElementById("waEmptyState").style.display = "flex";
  if (mode === "bot") {
    waStartBot();
    waShowSidebar();
  } else {
    waLoadSessions();
    waShowSidebar();
  }
}

function waRenderModeUI() {
  document
    .getElementById("pillBot")
    ?.classList.toggle("active", waMode === "bot");
  document
    .getElementById("pillLive")
    ?.classList.toggle("active", waMode === "live");
}

/* ── Bot mode ───────────────────────────────────────────────── */
function waStartBot() {
  const list = document.getElementById("waSessionList");
  list.innerHTML = `
    <div class="wa-session-item active" onclick="waSelectBot()">
      <div class="wa-sess-ava" style="background:linear-gradient(135deg,#6c3aed,#9d4edd)">
        <i class="fa-solid fa-robot" style="font-size:.9rem"></i>
      </div>
      <div class="wa-sess-info">
        <div class="wa-sess-name">Joy — AI Assistant</div>
        <div class="wa-sess-prev">Live dashboard context</div>
      </div>
    </div>`;
  waSelectBot();
}

function waSelectBot() {
  waActive = "joy";
  document.getElementById("waHdAva").textContent = "🤖";
  document.getElementById("waHdAva").style.background =
    "linear-gradient(135deg,#6c3aed,#9d4edd)";
  document.getElementById("waHdName").textContent = "Joy — AI Assistant";
  document.getElementById("waHdSubTxt").textContent = "Gemini · live context";
  document.getElementById("waOnlineDot").style.display = "none";
  document.getElementById("waEmptyState").style.display = "none";
  waMsgs().innerHTML = "";
  if (!waMessages["joy"] || !waMessages["joy"].length) {
    waAppendBubble({
      id: "bot-0",
      sender: "bot",
      name: "Joy",
      text: "Hi Admin 👋 I have your live bookings, clients and revenue. Ask me anything.",
      timestamp: new Date().toISOString(),
    });
  } else {
    waMessages["joy"].forEach(waRenderBubble);
  }
  waShowMain();
}

/* ── Live sessions ──────────────────────────────────────────── */
async function waLoadSessions() {
  try {
    const d = await waApi("/api/live-chat/sessions");
    waSessions = d.sessions || [];
    waRenderSessionList();
  } catch (_) {}
}

function waRenderSessionList() {
  const list = document.getElementById("waSessionList");
  if (!waSessions.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:rgba(240,236,228,.25);font-size:.82rem">No live sessions yet</div>`;
    return;
  }
  list.innerHTML = waSessions
    .map((s) => {
      const name = s.display_name || s.session_id.split("-")[0];
      const isOn = !!waOnlineUsers[s.session_id];
      const isActive = s.session_id === waActive;
      return `<div class="wa-session-item${isActive ? " active" : ""}" data-sid="${waEsc(s.session_id)}" onclick="waSelectSession('${waEsc(s.session_id)}','${waEsc(name)}')">
      <div class="wa-sess-ava">
        ${name[0].toUpperCase()}
        <span class="wa-sess-online" style="display:${isOn ? "block" : "none"}"></span>
      </div>
      <div class="wa-sess-info">
        <div class="wa-sess-name">${waEsc(name)}</div>
        <div class="wa-sess-prev">${waEsc((s.last_text || "").substring(0, 36))}</div>
      </div>
      ${s.unread_count > 0 ? `<span class="wa-sess-badge">${s.unread_count}</span>` : ""}
    </div>`;
    })
    .join("");
}

async function waSelectSession(sid, name) {
  waActive = sid;
  document
    .querySelectorAll(".wa-session-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelector(`.wa-session-item[data-sid="${sid}"]`)
    ?.classList.add("active");

  document.getElementById("waHdAva").textContent = (name ||
    "?")[0].toUpperCase();
  document.getElementById("waHdAva").style.background =
    "linear-gradient(135deg,#4c3aad,#7c6ef0)";
  document.getElementById("waHdName").textContent = name || sid.split("-")[0];

  const isOn = !!waOnlineUsers[sid];
  document.getElementById("waOnlineDot").style.display = isOn ? "" : "none";
  document.getElementById("waHdSubTxt").textContent = isOn
    ? "Online"
    : "Live chat";
  document.getElementById("waEmptyState").style.display = "none";

  waMsgs().innerHTML = "";
  if (!waMessages[sid]) {
    try {
      const d = await waApi(
        `/api/live-chat?sessionId=${encodeURIComponent(sid)}`,
      );
      waMessages[sid] = d.messages || [];
    } catch (_) {
      waMessages[sid] = [];
    }
  }
  waMessages[sid].forEach(waRenderBubble);
  waMsgs().scrollTop = waMsgs().scrollHeight;
  await waMarkRead(sid);
  waSessions = waSessions.map((s) =>
    s.session_id === sid ? { ...s, unread_count: 0 } : s,
  );
  waRenderSessionList();
  waShowMain();
}

async function waMarkRead(sid) {
  try {
    await waApi("/api/live-chat", {
      method: "PATCH",
      body: JSON.stringify({ sessionId: sid, reader: "admin" }),
    });
    if (waMessages[sid]) {
      waMessages[sid] = waMessages[sid].map((m) =>
        m.sender === "user" && !m.read_at
          ? { ...m, read_at: new Date().toISOString() }
          : m,
      );
    }
  } catch (_) {}
}

/* ── Supabase Realtime ──────────────────────────────────────── */
function waSubscribeRealtime() {
  if (!sbClient) return;
  if (waRtCh) sbClient.removeChannel(waRtCh);

  waRtCh = sbClient
    .channel("wa-admin-chat")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "live_chat_messages" },
      (payload) => {
        const msg = payload.new;
        if (!msg) return;
        if (msg.sender === "admin" && waSentIds.has(String(msg.id))) return;

        if (!waMessages[msg.session_id]) waMessages[msg.session_id] = [];
        const exists = waMessages[msg.session_id].some(
          (m) => String(m.id) === String(msg.id),
        );
        if (!exists) waMessages[msg.session_id].push(msg);

        if (msg.session_id === waActive) {
          waRenderBubble(msg);
          waMarkRead(msg.session_id);
        } else {
          waLoadSessions();
          if (typeof triggerNotification === "function") {
            triggerNotification(
              "New message from " + (msg.name || "a client"),
              msg.text,
              msg.session_id,
            );
          }
          if (typeof playSound === "function") playSound("receive");
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "live_chat_messages" },
      (payload) => {
        const msg = payload.new;
        if (!msg || !waMessages[msg.session_id]) return;
        waMessages[msg.session_id] = waMessages[msg.session_id].map((m) =>
          String(m.id) === String(msg.id) ? { ...m, ...msg } : m,
        );
        // Update tick icons live
        const el = document.querySelector(
          `[data-msg-id="${msg.id}"] .wa-ticks`,
        );
        if (el) {
          if (msg.read_at) {
            el.className = "wa-ticks blue";
            el.title = "Read";
          } else if (msg.delivered_at) {
            el.className = "wa-ticks grey";
            el.title = "Delivered";
          }
        }
      },
    )
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.sender === "user" && payload.sessionId === waActive) {
        waShowTyping(payload.typing);
      }
    })
    .subscribe();

  // Presence
  if (waPresenceCh) sbClient.removeChannel(waPresenceCh);
  waPresenceCh = sbClient
    .channel("user-presence-admin")
    .on("presence", { event: "sync" }, () => {
      const state = waPresenceCh.presenceState();
      waOnlineUsers = {};
      Object.keys(state).forEach((key) => {
        const entries = state[key];
        entries.forEach((entry) => {
          if (entry.user) waOnlineUsers[entry.user] = true;
        });
      });
      waRenderSessionList();
      if (waActive && waActive !== "joy") {
        const isOn = !!waOnlineUsers[waActive];
        document.getElementById("waOnlineDot").style.display = isOn
          ? ""
          : "none";
        document.getElementById("waHdSubTxt").textContent = isOn
          ? "Online"
          : "Live chat";
      }
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await waPresenceCh.track({
          user: "admin",
          role: "admin",
          online_at: new Date().toISOString(),
        });
      }
    });
}

/* ── Render a bubble ────────────────────────────────────────── */
function waRenderBubble(msg) {
  const container = waMsgs();
  if (container.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const isOut = msg.sender === "admin";
  const isBot = msg.sender === "bot";
  const name = msg.name || (isOut ? "Admin" : "Client");
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString(
    "en-KE",
    { hour: "2-digit", minute: "2-digit" },
  );
  const rx = msg.reactions || waReactions[msg.id] || {};

  // Date separator
  const prev = container.lastElementChild;
  if (prev && prev.dataset.ts) {
    const prevDate = new Date(prev.dataset.ts).toDateString();
    const thisDate = new Date(msg.timestamp || Date.now()).toDateString();
    if (prevDate !== thisDate) {
      const sep = document.createElement("div");
      sep.className = "wa-date-sep";
      sep.textContent = new Date(
        msg.timestamp || Date.now(),
      ).toLocaleDateString("en-KE", { dateStyle: "long" });
      container.appendChild(sep);
    }
  }

  const row = document.createElement("div");
  row.className = `wa-msg-row ${isOut ? "out" : "in"}`;
  row.dataset.msgId = msg.id;
  row.dataset.ts = msg.timestamp || new Date().toISOString();

  // Sender name (only for incoming from live)
  let senderNameHtml = "";
  if (!isOut && !isBot && waMode === "live") {
    senderNameHtml = `<div class="wa-msg-sender-name">${waEsc(name)}</div>`;
  }

  // Quote
  let quoteHtml = "";
  if (msg.reply_preview) {
    quoteHtml = `<div class="wa-quote" onclick="waScrollToMsg(${msg.reply_to_id})">
      <i class="fa-solid fa-reply"></i>${waEsc(msg.reply_preview.substring(0, 60))}${msg.reply_preview.length > 60 ? "…" : ""}
    </div>`;
  }

  // Content
  const contentHtml = waRenderMsgContent(msg);

  // Ticks
  let ticksHtml = "";
  if (isOut) {
    const cls = msg.read_at ? "blue" : "grey";
    const icon = msg.read_at
      ? "fa-check-double"
      : msg.delivered_at
        ? "fa-check-double"
        : "fa-check";
    const title = msg.read_at
      ? "Read"
      : msg.delivered_at
        ? "Delivered"
        : "Sent";
    ticksHtml = `<span class="wa-ticks ${cls}" title="${title}"><i class="fa-solid ${icon}"></i></span>`;
  }

  // Reactions
  const rxHtml = waRenderReactions(rx, msg.id);

  row.innerHTML = `
    ${senderNameHtml}
    <div class="wa-bubble-wrap">
      ${!isOut ? `<div class="wa-bubble-ava">${name[0].toUpperCase()}</div>` : ""}
      <div class="wa-bubble" style="position:relative">
        ${quoteHtml}
        ${contentHtml}
        <div class="wa-msg-meta">
          <span class="wa-msg-time">${time}</span>
          ${ticksHtml}
        </div>
        ${rxHtml}
      </div>
    </div>`;

  // Hover: reaction + reply bar
  const bubble = row.querySelector(".wa-bubble");
  let reactBarEl = null;
  bubble.addEventListener("mouseenter", () => {
    if (reactBarEl) return;
    reactBarEl = document.createElement("div");
    reactBarEl.className = "wa-react-bar";
    const quickEmojis = ["👍", "❤️", "😂", "🔥", "😮"];
    reactBarEl.innerHTML =
      quickEmojis
        .map(
          (e) =>
            `<button class="wa-react-btn" onclick="waAddReaction(${msg.id},'${e}')">${e}</button>`,
        )
        .join("") +
      `<button class="wa-reply-btn" onclick="waSetReply(${JSON.stringify(msg).replace(/"/g, "&quot;")})" title="Reply">↩</button>`;
    bubble.appendChild(reactBarEl);
  });
  bubble.addEventListener("mouseleave", () => {
    reactBarEl?.remove();
    reactBarEl = null;
  });

  // Long-press for mobile
  let lp;
  bubble.addEventListener(
    "touchstart",
    () => {
      lp = setTimeout(() => waSetReply(msg), 600);
    },
    { passive: true },
  );
  bubble.addEventListener("touchend", () => clearTimeout(lp));

  container.appendChild(row);

  // Animate
  row.style.opacity = "0";
  row.style.transform = "translateY(8px) scale(.97)";
  requestAnimationFrame(() => {
    row.style.transition =
      "opacity .2s ease, transform .2s cubic-bezier(.34,1.2,.64,1)";
    row.style.opacity = "1";
    row.style.transform = "none";
  });

  container.scrollTop = container.scrollHeight;
}

function waRenderMsgContent(msg) {
  if (msg.file_url) {
    const ft = msg.file_type || "";
    const fn = waEsc(msg.file_name || "file");
    const url = waEsc(msg.file_url);
    if (ft === "image")
      return `<img src="${url}" class="wa-img-bubble" alt="${fn}" onclick="waOpenLightbox('${url}')" loading="lazy">`;
    if (ft === "audio" || ft === "voice")
      return `<div class="wa-audio">
        <button class="wa-audio-btn" onclick="waToggleAudio(this,'${url}')">▶</button>
        <div class="wa-audio-track"><div class="wa-audio-prog"></div></div>
        <span class="wa-audio-dur">0:00</span>
      </div>`;
    if (ft === "pdf")
      return `<div class="wa-file-bubble pdf" onclick="waOpenPdf('${url}','${fn}')">
        <span style="font-size:1.4rem">📄</span>
        <span class="wa-file-name">${fn}</span>
        <span style="font-size:.72rem;opacity:.5">↗</span>
      </div>`;
    return `<a href="${url}" target="_blank" rel="noopener" class="wa-file-bubble">
      📎 <span class="wa-file-name">${fn}</span>
    </a>`;
  }
  return `<span style="white-space:pre-wrap;word-break:break-word">${waEsc(msg.text)}</span>`;
}

function waRenderReactions(rx, msgId) {
  if (!rx || !Object.keys(rx).length)
    return `<div class="wa-reactions" data-rxid="${msgId}"></div>`;
  const counts = {};
  Object.values(rx).forEach((e) => {
    counts[e] = (counts[e] || 0) + 1;
  });
  const pills = Object.entries(counts)
    .map(
      ([emoji, count]) =>
        `<button class="wa-reaction-pill" onclick="waAddReaction(${msgId},'${emoji}')">${emoji}<span class="wa-reaction-count">${count > 1 ? count : ""}</span></button>`,
    )
    .join("");
  return `<div class="wa-reactions" data-rxid="${msgId}">${pills}</div>`;
}

/* ── Reactions ──────────────────────────────────────────────── */
async function waAddReaction(msgId, emoji) {
  if (!sbClient || !waActive) return;
  const sid = waActive;
  if (!waMessages[sid]) return;

  // Toggle locally
  const msgIdx = waMessages[sid].findIndex(
    (m) => String(m.id) === String(msgId),
  );
  if (msgIdx === -1) return;
  const msg = { ...waMessages[sid][msgIdx] };
  const rx = { ...(msg.reactions || {}) };
  const key = "admin";
  if (rx[key] === emoji) delete rx[key];
  else rx[key] = emoji;
  msg.reactions = rx;
  waMessages[sid][msgIdx] = msg;

  // Update DOM
  const rxEl = document.querySelector(`.wa-reactions[data-rxid="${msgId}"]`);
  if (rxEl) rxEl.outerHTML = waRenderReactions(rx, msgId);

  // Persist to Supabase
  try {
    await sbClient
      .from("live_chat_messages")
      .update({ reactions: rx })
      .eq("id", msgId);
  } catch (_) {}
}

/* ── Reply ──────────────────────────────────────────────────── */
function waSetReply(msg) {
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch (_) {
      return;
    }
  }
  waReplyTo = {
    id: msg.id,
    text: (msg.text || msg.file_name || "📎 file").substring(0, 80),
  };
  const bar = document.getElementById("waReplyBar");
  document.getElementById("waReplyText").textContent = waReplyTo.text;
  bar.style.display = "flex";
  document.getElementById("waInput").focus();
}
function waClearReply() {
  waReplyTo = null;
  document.getElementById("waReplyBar").style.display = "none";
}
function waScrollToMsg(id) {
  const el = document.querySelector(`[data-msg-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "background .2s";
    el.style.background = "rgba(212,168,75,.15)";
    setTimeout(() => {
      el.style.background = "";
    }, 1200);
  }
}

/* ── Typing indicator ────────────────────────────────────────── */
function waShowTyping(show) {
  const bar = document.getElementById("waTypingBar");
  bar.style.display = show ? "flex" : "none";
  if (show) {
    const name = document.getElementById("waHdName").textContent;
    document.getElementById("waTypingLabel").textContent = name + " is typing";
  }
}

function waBroadcastTyping(t) {
  if (!waRtCh || waActive === "joy") return;
  if (!waIsTyping && t) {
    waIsTyping = true;
    waSendTyping(true);
  }
  clearTimeout(waTypingTimer);
  waTypingTimer = setTimeout(() => {
    waIsTyping = false;
    waSendTyping(false);
  }, 2000);
}
function waSendTyping(t) {
  if (!waRtCh) return;
  waRtCh
    .send({
      type: "broadcast",
      event: "typing",
      payload: { sender: "admin", sessionId: waActive, typing: t },
    })
    .catch(() => {});
}

/* ── Emoji picker ────────────────────────────────────────────── */
function waOpenEmoji() {
  const picker = document.getElementById("waEmojiPicker");
  const grid = document.getElementById("waEmojiGrid");
  if (picker.style.display !== "none") {
    picker.style.display = "none";
    return;
  }
  if (!grid.childElementCount) {
    grid.innerHTML = WA_EMOJIS.map(
      (e) =>
        `<button class="wa-emoji-btn-pick" onclick="waPasteEmoji('${e}')">${e}</button>`,
    ).join("");
  }
  picker.style.display = "block";
}
function waPasteEmoji(e) {
  const inp = document.getElementById("waInput");
  inp.value += e;
  inp.focus();
  document.getElementById("waEmojiPicker").style.display = "none";
}
document.addEventListener("click", (e) => {
  const picker = document.getElementById("waEmojiPicker");
  const btn = document.getElementById("waEmojiBtn");
  if (picker && !picker.contains(e.target) && e.target !== btn)
    picker.style.display = "none";
});

/* ── File attach ─────────────────────────────────────────────── */
function waAttach() {
  if (waMode === "bot") {
    if (typeof toast === "function")
      toast("Switch to Live mode to send files.", "info");
    return;
  }
  document.getElementById("waFileInput").click();
}

async function waHandleFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    if (typeof toast === "function") toast("Max file size is 10 MB.", "error");
    return;
  }
  input.value = "";
  if (!sbClient) {
    if (typeof toast === "function") toast("Supabase not connected.", "error");
    return;
  }

  if (typeof toast === "function") toast("Uploading…", "info");
  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `chat/admin-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const ft = file.type.startsWith("image/")
      ? "image"
      : file.type === "application/pdf"
        ? "pdf"
        : file.type.startsWith("audio/")
          ? "audio"
          : "file";

    const { error: upErr } = await sbClient.storage
      .from("chat-files")
      .upload(path, file, { cacheControl: "3600" });
    if (upErr) throw new Error(upErr.message);
    const { data: pub } = sbClient.storage
      .from("chat-files")
      .getPublicUrl(path);

    await waPostMsg("", pub.publicUrl, ft, file.name, file.size);
  } catch (e) {
    if (typeof toast === "function")
      toast("Upload failed: " + e.message, "error");
  }
}

/* ── Voice recording ─────────────────────────────────────────── */
async function waToggleRec(btn) {
  if (waMode === "bot") {
    if (typeof toast === "function")
      toast("Switch to Live mode to record.", "info");
    return;
  }
  if (waMediaRecorder && waMediaRecorder.state === "recording") {
    waMediaRecorder.stop();
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    btn.classList.remove("recording");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    waMediaRecorder = new MediaRecorder(stream);
    waAudioChunks = [];
    waMediaRecorder.ondataavailable = (e) => waAudioChunks.push(e.data);
    waMediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(waAudioChunks, { type: "audio/webm" });
      const file = new File([blob], `voice-${Date.now()}.webm`, {
        type: "audio/webm",
      });
      if (!sbClient) return;
      try {
        const path = `chat/voice-admin-${Date.now()}.webm`;
        await sbClient.storage
          .from("chat-files")
          .upload(path, file, { cacheControl: "3600" });
        const { data: pub } = sbClient.storage
          .from("chat-files")
          .getPublicUrl(path);
        await waPostMsg("", pub.publicUrl, "voice", file.name, file.size);
      } catch (_) {}
    };
    waMediaRecorder.start();
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.classList.add("recording");
  } catch (_) {
    if (typeof toast === "function")
      toast("Microphone permission denied.", "error");
  }
}

/* ── Audio player ────────────────────────────────────────────── */
function waToggleAudio(btn, src) {
  let audio = waAudioPlayers[src];
  if (!audio) {
    audio = new Audio(src);
    waAudioPlayers[src] = audio;
    const bar = btn.nextElementSibling;
    const dur = bar?.nextElementSibling;
    audio.addEventListener("timeupdate", () => {
      const p = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      const prog = bar?.querySelector(".wa-audio-prog");
      if (prog) prog.style.width = p + "%";
      if (dur) dur.textContent = waFmtTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => {
      btn.textContent = "▶";
    });
  }
  if (audio.paused) {
    audio.play();
    btn.textContent = "⏸";
  } else {
    audio.pause();
    btn.textContent = "▶";
  }
}
function waFmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ":" + (Math.floor(s % 60) + "").padStart(2, "0");
}

/* ── Send ────────────────────────────────────────────────────── */
async function waSend() {
  const inp = document.getElementById("waInput");
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  waIsTyping = false;
  waSendTyping(false);
  document.getElementById("waEmojiPicker").style.display = "none";

  if (waMode === "bot" || waActive === "joy") {
    waBotReply(text);
    return;
  }
  if (!waActive) return;
  await waPostMsg(text);
}

async function waPostMsg(
  text = "",
  fileUrl = null,
  fileType = null,
  fileName = null,
  fileSize = null,
) {
  if (!waActive) return;
  const tempId = "tmp-" + Date.now();
  const fakeMsg = {
    id: tempId,
    sender: "admin",
    name: "Admin",
    text,
    timestamp: new Date().toISOString(),
    file_url: fileUrl,
    file_type: fileType,
    file_name: fileName,
    file_size: fileSize,
    reply_to_id: waReplyTo?.id || null,
    reply_preview: waReplyTo?.text || null,
    reactions: {},
    delivered_at: new Date().toISOString(),
  };

  if (!waMessages[waActive]) waMessages[waActive] = [];
  waMessages[waActive].push(fakeMsg);
  waRenderBubble(fakeMsg);
  waSentIds.add(tempId);
  waClearReply();
  if (typeof playSound === "function") playSound("send");

  try {
    const res = await waApi("/api/live-chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: waActive,
        sender: "admin",
        name: "Admin",
        text,
        timestamp: fakeMsg.timestamp,
        fileUrl,
        fileType,
        fileName,
        fileSize,
        replyToId: fakeMsg.reply_to_id,
        replyPreview: fakeMsg.reply_preview,
      }),
    });
    if (res.id) {
      waSentIds.add(String(res.id));
      waMessages[waActive] = waMessages[waActive].map((m) =>
        m.id === tempId ? { ...m, id: res.id } : m,
      );
      const el = waMsgs().querySelector(`[data-msg-id="${tempId}"]`);
      if (el) el.dataset.msgId = res.id;
    }
  } catch (_) {}
}

/* ── Bot reply ───────────────────────────────────────────────── */
async function waBotReply(text) {
  if (!waMessages["joy"]) waMessages["joy"] = [];
  waAppendBubble({
    id: "u-" + Date.now(),
    sender: "admin",
    name: "Admin",
    text,
    timestamp: new Date().toISOString(),
  });
  if (typeof playSound === "function") playSound("send");

  // Typing dots
  waShowTyping(true);
  document.getElementById("waTypingLabel").textContent = "Joy is thinking";

  const ctx = `You are Joy, AI assistant for Joyalty Photography admin dashboard.
LIVE DATA: Bookings:${typeof allBookings !== "undefined" ? allBookings.length : 0}, Confirmed:${typeof allBookings !== "undefined" ? allBookings.filter((b) => b.status === "confirmed").length : 0}, Revenue: KSh ${typeof allBookings !== "undefined" ? allBookings.reduce((a, b) => a + Number(b.deposit_paid || 0), 0).toLocaleString() : "0"}, Clients:${typeof allClients !== "undefined" ? allClients.length : 0}. Today:${new Date().toLocaleDateString("en-KE", { dateStyle: "full" })}.`;

  const history = (waMessages["joy"] || [])
    .filter((m) => m.sender !== "bot")
    .slice(-10);
  const formatted = [
    { role: "user", parts: [{ text: ctx }] },
    ...history
      .slice(0, -1)
      .map((m) => ({ role: "user", parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text }] },
  ];

  try {
    const res = await waApi("/api/gemini-chat", {
      method: "POST",
      body: JSON.stringify({ messages: formatted }),
    });
    waShowTyping(false);
    const reply = res.reply || "I couldn't respond right now.";
    waAppendBubble({
      id: "b-" + Date.now(),
      sender: "bot",
      name: "Joy",
      text: reply,
      timestamp: new Date().toISOString(),
    });
    if (typeof playSound === "function") playSound("receive");
  } catch (_) {
    waShowTyping(false);
    waAppendBubble({
      id: "e-" + Date.now(),
      sender: "bot",
      name: "Joy",
      text: "⚠ Connection error.",
      timestamp: new Date().toISOString(),
    });
  }
}

function waAppendBubble(msg) {
  if (!waMessages[waActive]) waMessages[waActive] = [];
  waMessages[waActive].push(msg);
  waRenderBubble(msg);
}

/* ── Clear chat ──────────────────────────────────────────────── */
function waClearChat() {
  if (waActive === "joy") {
    waMessages["joy"] = [];
    waMsgs().innerHTML = "";
    waAppendBubble({
      id: "bot-c",
      sender: "bot",
      name: "Joy",
      text: "Chat cleared. Ask me anything.",
      timestamp: new Date().toISOString(),
    });
  }
}

/* ── Lightbox / PDF ──────────────────────────────────────────── */
function waOpenLightbox(src) {
  document.getElementById("waLightboxImg").src = src;
  document.getElementById("waLightbox").style.display = "flex";
}
function waCloseLightbox() {
  document.getElementById("waLightbox").style.display = "none";
}

function waOpenPdf(src, name) {
  document.getElementById("waPdfName").textContent = decodeURIComponent(
    name || "Document",
  );
  document.getElementById("waPdfDownload").href = src;
  document.getElementById("waPdfFrame").src = src;
  document.getElementById("waPdfModal").style.display = "flex";
}
function waClosePdf() {
  document.getElementById("waPdfModal").style.display = "none";
  document.getElementById("waPdfFrame").src = "";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    waCloseLightbox();
    waClosePdf();
  }
});

/* ── Mobile nav ──────────────────────────────────────────────── */
function waShowMain() {
  if (window.innerWidth <= 768) {
    document.getElementById("waSidebar")?.classList.add("hidden");
    document.getElementById("waMain")?.classList.remove("hidden");
  }
}
function waShowSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById("waSidebar")?.classList.remove("hidden");
    document.getElementById("waMain")?.classList.add("hidden");
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */
function waMsgs() {
  return document.getElementById("waMsgs");
}
function waEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
async function waApi(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch (_) {
    return { error: t };
  }
}

/* ── Hook into admin.js switchTab ────────────────────────────── */
const _origSwitchTab = window.switchTab;
window.switchTab = function (tab, silent) {
  if (typeof _origSwitchTab === "function") _origSwitchTab(tab, silent);
  if (tab === "chat") {
    setTimeout(() => {
      waInit();
    }, 50);
  }
};
