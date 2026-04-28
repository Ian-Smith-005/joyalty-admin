/* ================================================================
   JOYALTY ADMIN — admin-wa.js  (GoldenChat redesign)
   Full media support: image, video, PDF, audio, voice recording.
   File preview bar before sending. Caption support.
   All Realtime, reactions, reply-quote, ticks intact.
================================================================ */

/* ── State ───────────────────────────────────────────────────── */
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
let waReactions = {};
let waPendingFile = null; // { file, url, type, name, size }
let waPendingCaption = "";
let waAttachMenuOpen = false;
let waRecordingTimer = null;
let waRecordingStart = 0;

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
  "😅",
  "🫡",
  "💪",
  "🥳",
];

/* ── Init ────────────────────────────────────────────────────── */
function waInit() {
  waRenderModeUI();
  if (waMode === "bot") waStartBot();
  else waLoadSessions();
  waSubscribeRealtime();
}

/* ── Mode ────────────────────────────────────────────────────── */
function waSetMode(mode) {
  waMode = mode;
  waRenderModeUI();
  waMsgs().innerHTML = "";
  waActive = null;
  document.getElementById("waEmptyState").style.display = "flex";
  waClearPreview();
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

/* ── Bot ─────────────────────────────────────────────────────── */
function waStartBot() {
  const list = document.getElementById("waSessionList");
  list.innerHTML = `
    <div class="wa-session-item active" onclick="waSelectBot()">
      <div class="wa-sess-ava" style="background:linear-gradient(135deg,#6c3aed,#9d4edd);color:#fff;font-size:1.1rem">
        <i class="fa-solid fa-robot"></i>
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
  document.getElementById("waHdAva").innerHTML =
    '<i class="fa-solid fa-robot"></i>';
  document.getElementById("waHdAva").style.background =
    "linear-gradient(135deg,#6c3aed,#9d4edd)";
  document.getElementById("waHdAva").style.color = "#fff";
  document.getElementById("waHdName").textContent = "Joy — AI Assistant";
  document.getElementById("waHdSubTxt").textContent = "Gemini · live context";
  document.getElementById("waOnlineDot").style.display = "none";
  document.getElementById("waEmptyState").style.display = "none";
  waMsgs().innerHTML = "";
  if (!waMessages["joy"]?.length) {
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

/* ── Sessions ────────────────────────────────────────────────── */
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
    list.innerHTML = `<div style="padding:28px 16px;text-align:center;color:rgba(238,236,232,.2);font-size:.83rem">No live sessions yet</div>`;
    return;
  }
  list.innerHTML = waSessions
    .map((s) => {
      const name = s.display_name || s.session_id.split("-")[0];
      const isOn = !!waOnlineUsers[s.session_id];
      const active = s.session_id === waActive;
      return `<div class="wa-session-item${active ? " active" : ""}" data-sid="${waEsc(s.session_id)}"
      onclick="waSelectSession('${waEsc(s.session_id)}','${waEsc(name)}')">
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

  const ava = document.getElementById("waHdAva");
  ava.textContent = (name || "?")[0].toUpperCase();
  ava.style.background = "linear-gradient(135deg,#d4af37,#8b6f1f)";
  ava.style.color = "#111";
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

/* ── Realtime ────────────────────────────────────────────────── */
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
          if (typeof triggerNotification === "function")
            triggerNotification(
              "New message from " + (msg.name || "a client"),
              msg.text,
              msg.session_id,
            );
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
        const tickEl = document.querySelector(
          `[data-msg-id="${msg.id}"] .wa-ticks`,
        );
        if (tickEl) {
          tickEl.className = msg.read_at ? "wa-ticks blue" : "wa-ticks grey";
          tickEl.querySelector("i").className =
            msg.read_at || msg.delivered_at
              ? "fa-solid fa-check-double"
              : "fa-solid fa-check";
        }
      },
    )
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.sender === "user" && payload.sessionId === waActive)
        waShowTyping(payload.typing);
    })
    .subscribe();

  // Presence
  if (waPresenceCh) sbClient.removeChannel(waPresenceCh);
  waPresenceCh = sbClient
    .channel("user-presence-admin")
    .on("presence", { event: "sync" }, () => {
      const state = waPresenceCh.presenceState();
      waOnlineUsers = {};
      Object.keys(state).forEach((key) =>
        state[key].forEach((e) => {
          if (e.user) waOnlineUsers[e.user] = true;
        }),
      );
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
      if (status === "SUBSCRIBED")
        await waPresenceCh.track({
          user: "admin",
          role: "admin",
          online_at: new Date().toISOString(),
        });
    });
}

/* ── Bubble render ────────────────────────────────────────────── */
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
  if (prev?.dataset.ts) {
    if (
      new Date(prev.dataset.ts).toDateString() !==
      new Date(msg.timestamp || Date.now()).toDateString()
    ) {
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

  const senderName =
    !isOut && !isBot && waMode === "live"
      ? `<div class="wa-msg-sender-name">${waEsc(name)}</div>`
      : "";

  const quoteHtml = msg.reply_preview
    ? `<div class="wa-quote" onclick="waScrollToMsg(${msg.reply_to_id})">
         <i class="fa-solid fa-reply"></i>${waEsc(msg.reply_preview.substring(0, 60))}${msg.reply_preview.length > 60 ? "…" : ""}
       </div>`
    : "";

  const content = waRenderMsgContent(msg);

  let ticksHtml = "";
  if (isOut) {
    const cls = msg.read_at ? "blue" : "grey";
    const icon =
      msg.read_at || msg.delivered_at ? "fa-check-double" : "fa-check";
    ticksHtml = `<span class="wa-ticks ${cls}"><i class="fa-solid ${icon}"></i></span>`;
  }

  row.innerHTML = `
    ${senderName}
    <div class="wa-bubble-wrap">
      ${!isOut ? `<div class="wa-bubble-ava">${name[0].toUpperCase()}</div>` : ""}
      <div class="wa-bubble" style="position:relative">
        ${quoteHtml}
        ${content}
        <div class="wa-msg-meta">
          <span class="wa-msg-time">${time}</span>
          ${ticksHtml}
        </div>
        ${waRenderReactions(rx, msg.id)}
      </div>
    </div>`;

  // Hover reaction bar
  const bubble = row.querySelector(".wa-bubble");
  let reactEl = null;
  bubble.addEventListener("mouseenter", () => {
    if (reactEl) return;
    reactEl = document.createElement("div");
    reactEl.className = "wa-react-bar";
    reactEl.innerHTML =
      ["👍", "❤️", "😂", "🔥", "😮"]
        .map(
          (e) =>
            `<button class="wa-react-btn" onclick="waAddReaction(${msg.id},'${e}')">${e}</button>`,
        )
        .join("") +
      `<button class="wa-reply-btn" onclick="waSetReply(${JSON.stringify(msg).replace(/"/g, "&quot;")})" title="Reply">↩</button>`;
    bubble.appendChild(reactEl);
  });
  bubble.addEventListener("mouseleave", () => {
    reactEl?.remove();
    reactEl = null;
  });

  // Long-press mobile
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

  // Animate in
  row.style.cssText += ";opacity:0;transform:translateY(12px)";
  requestAnimationFrame(() => {
    row.style.transition =
      "opacity .3s ease, transform .3s cubic-bezier(.25,.46,.45,.94)";
    row.style.opacity = "1";
    row.style.transform = "translateY(0)";
  });

  container.scrollTop = container.scrollHeight;
}

function waRenderMsgContent(msg) {
  if (!msg.file_url)
    return `<span style="white-space:pre-wrap;word-break:break-word">${waEsc(msg.text)}</span>`;

  const url = waEsc(msg.file_url);
  const name = waEsc(msg.file_name || "file");
  const size = msg.file_size ? waFmtSize(msg.file_size) : "";
  const ft = msg.file_type || "";
  const cap = msg.text
    ? `<div style="margin-top:8px;font-size:.85rem;word-break:break-word">${waEsc(msg.text)}</div>`
    : "";

  if (ft === "image")
    return `<div>
      <img src="${url}" class="wa-img-bubble" alt="${name}"
           onclick="waOpenMedia('${url}','image')" loading="lazy">
      ${cap}
    </div>`;

  if (ft === "video")
    return `<div>
      <video class="wa-video-bubble" preload="metadata"
             onclick="waOpenMedia('${url}','video')" title="${name}">
        <source src="${url}">
      </video>
      ${cap}
    </div>`;

  if (ft === "audio" || ft === "voice")
    return `<div>
      <div class="wa-audio">
        <button class="wa-audio-btn" onclick="waToggleAudio(this,'${url}')">▶</button>
        <div class="wa-audio-track"><div class="wa-audio-prog"></div></div>
        <span class="wa-audio-dur">0:00</span>
      </div>
      ${cap}
    </div>`;

  if (ft === "pdf")
    return `<div>
      <div class="wa-file-bubble pdf" onclick="waOpenPdf('${url}','${name}')">
        <div class="wa-file-thumb"><i class="fa-solid fa-file-pdf" style="color:#ef4444"></i></div>
        <div class="wa-file-details">
          <div class="wa-file-name">${name}</div>
          <div class="wa-file-size">${size}</div>
        </div>
      </div>
      ${cap}
    </div>`;

  return `<div>
    <a href="${url}" target="_blank" rel="noopener" class="wa-file-bubble">
      <div class="wa-file-thumb"><i class="fa-solid fa-file"></i></div>
      <div class="wa-file-details">
        <div class="wa-file-name">${name}</div>
        <div class="wa-file-size">${size}</div>
      </div>
    </a>
    ${cap}
  </div>`;
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
      ([e, c]) =>
        `<button class="wa-reaction-pill" onclick="waAddReaction(${msgId},'${e}')">${e}<span class="wa-reaction-count">${c > 1 ? c : ""}</span></button>`,
    )
    .join("");
  return `<div class="wa-reactions" data-rxid="${msgId}">${pills}</div>`;
}

/* ── Reactions ───────────────────────────────────────────────── */
async function waAddReaction(msgId, emoji) {
  if (!sbClient || !waActive) return;
  const sid = waActive;
  if (!waMessages[sid]) return;
  const idx = waMessages[sid].findIndex((m) => String(m.id) === String(msgId));
  if (idx === -1) return;
  const msg = { ...waMessages[sid][idx] };
  const rx = { ...(msg.reactions || {}) };
  if (rx["admin"] === emoji) delete rx["admin"];
  else rx["admin"] = emoji;
  msg.reactions = rx;
  waMessages[sid][idx] = msg;
  const rxEl = document.querySelector(`.wa-reactions[data-rxid="${msgId}"]`);
  if (rxEl) rxEl.outerHTML = waRenderReactions(rx, msgId);
  try {
    await sbClient
      .from("live_chat_messages")
      .update({ reactions: rx })
      .eq("id", msgId);
  } catch (_) {}
}

/* ── Reply ────────────────────────────────────────────────────── */
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
  document.getElementById("waReplyText").textContent = waReplyTo.text;
  document.getElementById("waReplyBar").style.display = "flex";
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
    el.style.transition = "background .3s";
    el.style.background = "rgba(212,175,55,.2)";
    setTimeout(() => {
      el.style.background = "";
    }, 1400);
  }
}

/* ── Typing ───────────────────────────────────────────────────── */
function waShowTyping(show) {
  const bar = document.getElementById("waTypingBar");
  bar.style.display = show ? "flex" : "none";
  if (show)
    document.getElementById("waTypingLabel").textContent =
      document.getElementById("waHdName").textContent + " is typing";
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

/* ── Emoji picker ─────────────────────────────────────────────── */
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
  if (
    picker &&
    !picker.contains(e.target) &&
    e.target !== btn &&
    !btn?.contains(e.target)
  )
    picker.style.display = "none";
  // Close attach menu
  const menu = document.getElementById("waAttachMenu");
  const attachBtn = document.getElementById("waAttachToggle");
  if (
    menu &&
    waAttachMenuOpen &&
    !menu.contains(e.target) &&
    e.target !== attachBtn &&
    !attachBtn?.contains(e.target)
  ) {
    menu.style.display = "none";
    waAttachMenuOpen = false;
  }
});

/* ── Attach menu ─────────────────────────────────────────────── */
function waToggleAttach() {
  const menu = document.getElementById("waAttachMenu");
  if (!menu) return;
  waAttachMenuOpen = !waAttachMenuOpen;
  menu.style.display = waAttachMenuOpen ? "flex" : "none";
}

function waTriggerFileInput(accept) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = accept;
  inp.onchange = (e) => {
    waHandleFile(e.target.files[0]);
    inp.value = "";
  };
  inp.click();
  document.getElementById("waAttachMenu").style.display = "none";
  waAttachMenuOpen = false;
}

async function waHandleFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) {
    if (typeof toast === "function") toast("Max 50 MB.", "error");
    return;
  }
  if (waMode === "bot") {
    if (typeof toast === "function")
      toast("Switch to Live mode to send files.", "info");
    return;
  }

  // Determine type
  let ft = "file";
  if (file.type.startsWith("image/")) ft = "image";
  else if (file.type.startsWith("video/")) ft = "video";
  else if (file.type === "application/pdf") ft = "pdf";
  else if (file.type.startsWith("audio/")) ft = "audio";

  // Build local preview URL
  const localUrl = URL.createObjectURL(file);
  waPendingFile = {
    file,
    url: localUrl,
    type: ft,
    name: file.name,
    size: file.size,
  };
  waPendingCaption = "";
  waShowPreviewBar();
}

function waShowPreviewBar() {
  const bar = document.getElementById("waPreviewBar");
  if (!bar || !waPendingFile) return;
  const f = waPendingFile;

  let thumbHtml = "";
  if (f.type === "image")
    thumbHtml = `<div class="wa-preview-thumb"><img src="${f.url}" alt="preview"></div>`;
  else if (f.type === "video")
    thumbHtml = `<div class="wa-preview-thumb"><i class="fa-solid fa-video" style="color:#a78bfa"></i></div>`;
  else if (f.type === "pdf")
    thumbHtml = `<div class="wa-preview-thumb"><i class="fa-solid fa-file-pdf" style="color:#ef4444"></i></div>`;
  else if (f.type === "audio")
    thumbHtml = `<div class="wa-preview-thumb"><i class="fa-solid fa-music" style="color:#d4af37"></i></div>`;
  else
    thumbHtml = `<div class="wa-preview-thumb"><i class="fa-solid fa-file" style="color:#60a5fa"></i></div>`;

  bar.innerHTML = `
    <div class="wa-preview-bar">
      <div class="wa-preview-content">
        ${thumbHtml}
        <div class="wa-preview-info">
          <div class="wa-preview-name">${waEsc(f.name)}</div>
          <div style="font-size:.72rem;color:rgba(238,236,232,.45)">${waFmtSize(f.size)}</div>
        </div>
        <button class="wa-preview-close" onclick="waClearPreview()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <input class="wa-caption-input" id="waCaptionInput" placeholder="Add a caption…"
        value="${waEsc(waPendingCaption)}"
        oninput="waPendingCaption=this.value">
    </div>`;
  bar.style.display = "block";
  document.getElementById("waCaptionInput")?.focus();
}

function waClearPreview() {
  waPendingFile = null;
  waPendingCaption = "";
  const bar = document.getElementById("waPreviewBar");
  if (bar) {
    bar.innerHTML = "";
    bar.style.display = "none";
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
    // Stop recording
    waMediaRecorder.stop();
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    btn.classList.remove("recording");
    btn.title = "Voice note";
    clearInterval(waRecordingTimer);
    btn.textContent = "";
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
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
      // Show in preview bar then let user send
      waPendingFile = {
        file,
        url: URL.createObjectURL(blob),
        type: "voice",
        name: file.name,
        size: file.size,
      };
      waPendingCaption = "";
      waShowPreviewBar();
    };
    waMediaRecorder.start();
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.classList.add("recording");
    // Show recording timer
    waRecordingStart = Date.now();
    waRecordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - waRecordingStart) / 1000);
      const m = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, "0");
      const s = (elapsed % 60).toString().padStart(2, "0");
      btn.title = `Recording ${m}:${s} — click to stop`;
    }, 1000);
  } catch (_) {
    if (typeof toast === "function")
      toast("Microphone permission denied.", "error");
  }
}

/* ── Upload to Supabase Storage ──────────────────────────────── */
async function waUploadToStorage(file, ft) {
  if (!sbClient) throw new Error("Supabase not connected");
  const ext = file.name.split(".").pop() || "bin";
  const path = `chat/admin-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sbClient.storage
    .from("chat-files")
    .upload(path, file, { cacheControl: "3600" });
  if (error) throw new Error(error.message);
  const { data: pub } = sbClient.storage.from("chat-files").getPublicUrl(path);
  return pub.publicUrl;
}

/* ── Send ────────────────────────────────────────────────────── */
async function waSend() {
  const inp = document.getElementById("waInput");
  const text = inp.value.trim();
  const hasFile = !!waPendingFile;

  if (!text && !hasFile) return;
  inp.value = "";
  waIsTyping = false;
  waSendTyping(false);
  document.getElementById("waEmojiPicker").style.display = "none";

  if (waMode === "bot" || waActive === "joy") {
    if (text) waBotReply(text);
    waClearPreview();
    return;
  }
  if (!waActive) return;

  if (hasFile) {
    const f = waPendingFile;
    const caption = waPendingCaption.trim();
    waClearPreview();
    if (typeof toast === "function") toast("Sending…", "info");
    try {
      const uploadedUrl = await waUploadToStorage(f.file, f.type);
      await waPostMsg(caption, uploadedUrl, f.type, f.name, f.size);
    } catch (e) {
      if (typeof toast === "function")
        toast("Upload failed: " + e.message, "error");
    }
    return;
  }

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
  waShowTyping(true);
  document.getElementById("waTypingLabel").textContent = "Joy is thinking";

  const ctx = `You are Joy, AI assistant for Joyalty Photography admin.
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
    waAppendBubble({
      id: "b-" + Date.now(),
      sender: "bot",
      name: "Joy",
      text: res.reply || "I couldn't respond.",
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

/* ── Clear ───────────────────────────────────────────────────── */
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

/* ── Media viewer ─────────────────────────────────────────────── */
function waOpenMedia(src, type) {
  const lb = document.getElementById("waLightbox");
  const content = document.getElementById("waLightboxContent");
  if (!lb || !content) return;

  if (type === "image") {
    content.innerHTML = `
      <button class="wa-lightbox-close" onclick="waCloseLightbox()"><i class="fa-solid fa-xmark"></i></button>
      <img src="${src}" alt="image" style="max-width:100%;max-height:85vh;display:block">`;
  } else if (type === "video") {
    content.innerHTML = `
      <button class="wa-lightbox-close" onclick="waCloseLightbox()"><i class="fa-solid fa-xmark"></i></button>
      <video controls autoplay style="max-width:100%;max-height:85vh;display:block">
        <source src="${src}">
      </video>`;
  }
  lb.style.display = "flex";
}
function waOpenLightbox(src) {
  waOpenMedia(src, "image");
}
function waCloseLightbox() {
  const lb = document.getElementById("waLightbox");
  if (lb) lb.style.display = "none";
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

/* ── Audio player ─────────────────────────────────────────────── */
function waToggleAudio(btn, src) {
  let audio = waAudioPlayers[src];
  if (!audio) {
    audio = new Audio(src);
    waAudioPlayers[src] = audio;
    const bar = btn.nextElementSibling,
      dur = bar?.nextElementSibling;
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

/* ── Mobile ───────────────────────────────────────────────────── */
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
function waFmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ":" + (Math.floor(s % 60) + "").padStart(2, "0");
}
function waFmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
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
  if (tab === "chat") setTimeout(() => waInit(), 50);
};

/* ── Additional helpers needed by the new HTML ───────────────── */

// Session search filter
function waFilterSessions(q) {
  const lq = q.toLowerCase().trim();
  document.querySelectorAll(".wa-session-item[data-sid]").forEach((el) => {
    const name =
      el.querySelector(".wa-sess-name")?.textContent?.toLowerCase() || "";
    const prev =
      el.querySelector(".wa-sess-prev")?.textContent?.toLowerCase() || "";
    el.style.display =
      !lq || name.includes(lq) || prev.includes(lq) ? "" : "none";
  });
}

// Refresh sessions button
function waRefreshSessions() {
  if (waMode === "live") waLoadSessions();
}
