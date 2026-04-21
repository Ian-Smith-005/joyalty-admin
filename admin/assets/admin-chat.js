/* ============================================================
   JOYALTY ADMIN — admin-chat.js
   Chat additions: blue ticks, typing indicator, file attachments,
   PDF modal, image lightbox, voice playback, reply quoting,
   read receipts. Include AFTER admin.js in index.html.
============================================================ */

// ── File upload via Supabase Storage (admin side) ─────────────
async function adminUploadFile(file) {
  if (!sbClient) throw new Error("Supabase not connected");
  const ext = file.name.split(".").pop() || "bin";
  const path = `chat/admin-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sbClient.storage
    .from("chat-files")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(error.message);
  const { data: pub } = sbClient.storage.from("chat-files").getPublicUrl(path);
  return pub.publicUrl;
}

function adminFileType(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

// ── Attach file (admin) ────────────────────────────────────────
function adminAttachFile() {
  if (!activeSession || activeSession === "joy") {
    toast("Select a live session first.", "error");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,.pdf,audio/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast("Max 10 MB.", "error");
      return;
    }
    const toastEl = toast("Uploading…", "info");
    try {
      const url = await adminUploadFile(file);
      const type = adminFileType(file);
      await sendAdminFileMsg(url, type, file.name, file.size);
    } catch (e) {
      toast("Upload failed: " + e.message, "error");
    }
  };
  input.click();
}

// ── Voice recording (admin) ────────────────────────────────────
let adminMR = null,
  adminAudioChunks = [];
async function toggleAdminRecording(btn) {
  if (!activeSession || activeSession === "joy") {
    toast("Select a live session first.", "error");
    return;
  }
  if (adminMR && adminMR.state === "recording") {
    adminMR.stop();
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    btn.classList.remove("recording");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    adminMR = new MediaRecorder(stream);
    adminAudioChunks = [];
    adminMR.ondataavailable = (e) => adminAudioChunks.push(e.data);
    adminMR.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(adminAudioChunks, { type: "audio/webm" });
      const file = new File([blob], "voice-" + Date.now() + ".webm", {
        type: "audio/webm",
      });
      try {
        const url = await adminUploadFile(file);
        await sendAdminFileMsg(url, "voice", file.name, file.size);
      } catch (e) {
        toast("Voice send failed.", "error");
      }
    };
    adminMR.start();
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.classList.add("recording");
  } catch (_) {
    toast("Mic permission denied.", "error");
  }
}

// ── Send file message (admin → live chat) ─────────────────────
async function sendAdminFileMsg(fileUrl, fileType, fileName, fileSize) {
  const tempId = "tmp-" + Date.now();
  const fakeMsg = {
    id: tempId,
    sender: "admin",
    name: "Admin",
    text: "",
    timestamp: new Date().toISOString(),
    file_url: fileUrl,
    file_type: fileType,
    file_name: fileName,
    file_size: fileSize,
    reply_to_id: adminReplyTo?.id || null,
    reply_preview: adminReplyTo?.text?.substring(0, 80) || null,
  };
  renderBubble(fakeMsg);
  sentIds.add(tempId);
  clearAdminReply();
  playSound("send");

  try {
    const res = await api("/api/live-chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: activeSession,
        sender: "admin",
        name: "Admin",
        text: "",
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
      sentIds.add(String(res.id));
      const el = g("adminMsgs").querySelector(`[data-msg-id="${tempId}"]`);
      if (el) el.dataset.msgId = res.id;
    }
  } catch (_) {
    appendMsg("⚠ Send failed.", "in", "⚠");
  }
}

// ── Reply quoting (admin) ──────────────────────────────────────
let adminReplyTo = null;
function setAdminReply(msg) {
  adminReplyTo = {
    id: msg.id,
    text: (msg.text || msg.file_name || "📎 file").substring(0, 80),
  };
  let bar = document.getElementById("adminReplyBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "adminReplyBar";
    bar.className = "reply-bar";
    bar.innerHTML = `<div class="reply-bar-inner"><i class="fa-solid fa-reply"></i><span id="adminReplyText"></span></div><button onclick="clearAdminReply()"><i class="fa-solid fa-xmark"></i></button>`;
    g("adminInput")?.parentElement?.insertBefore(bar, g("adminInput"));
  }
  g("adminReplyText").textContent = adminReplyTo.text;
  g("adminInput")?.focus();
}
function clearAdminReply() {
  adminReplyTo = null;
  g("adminReplyBar")?.remove();
}

// ── Patch renderBubble to support all new fields ───────────────
// Override the renderBubble in admin.js
function renderBubble(msg) {
  const msgs = g("adminMsgs");
  if (msgs.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const isOut = msg.sender === "admin";
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString(
    "en-KE",
    { hour: "2-digit", minute: "2-digit" },
  );

  const div = document.createElement("div");
  div.className = `msg ${isOut ? "out" : "in"}`;
  div.dataset.msgId = msg.id;
  div.style.opacity = "0";
  div.style.transform = "translateY(10px) scale(.97)";

  let body = "";

  // Reply quote
  if (msg.reply_preview) {
    body += `<div class="msg-quote"><i class="fa-solid fa-reply"></i> ${esc(msg.reply_preview)}</div>`;
  }

  // File content
  if (msg.file_url) {
    body += renderAdminFile(msg);
  } else {
    body += `<div class="msg-bubble">${esc(msg.text)}</div>`;
  }

  // Time + ticks for outgoing
  const ticks = isOut ? renderTicks(msg) : "";
  body += `<div class="msg-meta"><span class="msg-time">${isOut ? "You" : msg.name || "Client"} · ${time}</span>${ticks}</div>`;

  div.innerHTML = `<div class="msg-ava">${isOut ? "A" : (msg.name || "?")[0].toUpperCase()}</div><div class="msg-col">${body}</div>`;

  // Right-click to quote
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setAdminReply(msg);
  });
  div.addEventListener(
    "touchstart",
    () => {
      div._lp = setTimeout(() => setAdminReply(msg), 600);
    },
    { passive: true },
  );
  div.addEventListener("touchend", () => clearTimeout(div._lp));

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;

  requestAnimationFrame(() => {
    div.style.transition =
      "opacity .2s ease, transform .2s cubic-bezier(.34,1.2,.64,1)";
    div.style.opacity = "1";
    div.style.transform = "none";
  });
}

function renderAdminFile(msg) {
  const url = msg.file_url;
  const name = msg.file_name || "file";
  const type = msg.file_type || "";
  if (type === "image")
    return `<img src="${url}" class="msg-img" alt="${esc(name)}" onclick="openAdminLightbox('${url}')" loading="lazy">`;
  if (type === "audio" || type === "voice")
    return `<div class="msg-audio"><button class="audio-play-btn" onclick="toggleAdminAudio(this,'${url}')"><i class="fa-solid fa-play"></i></button><div class="audio-bar"><div class="audio-progress"></div></div><span class="audio-dur">0:00</span></div>`;
  if (type === "pdf")
    return `<div class="msg-file pdf-file" onclick="openAdminPDF('${url}','${esc(name)}')"><i class="fa-solid fa-file-pdf" style="color:#ef4444;font-size:1.4rem"></i><span>${esc(name)}</span><i class="fa-solid fa-expand" style="font-size:.75rem;opacity:.5"></i></div>`;
  return `<a href="${url}" target="_blank" class="msg-file"><i class="fa-solid fa-file"></i><span>${esc(name)}</span></a>`;
}

function renderTicks(msg) {
  if (msg.read_at)
    return `<span class="ticks blue" title="Read"><i class="fa-solid fa-check-double"></i></span>`;
  if (msg.delivered_at)
    return `<span class="ticks grey" title="Delivered"><i class="fa-solid fa-check-double"></i></span>`;
  return `<span class="ticks grey" title="Sent"><i class="fa-solid fa-check"></i></span>`;
}

// ── Lightbox / PDF / Audio (admin) ─────────────────────────────
function openAdminLightbox(src) {
  let box = document.getElementById("adminLightbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "adminLightbox";
    box.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;";
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }
  box.innerHTML = `<img src="${src}" style="max-width:100%;max-height:90vh;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.7)" onclick="event.stopPropagation()"><button style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:1rem" onclick="document.getElementById('adminLightbox').remove()"><i class="fa-solid fa-xmark"></i></button>`;
}

function openAdminPDF(src, name) {
  let modal = document.getElementById("adminPDFModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "adminPDFModal";
    modal.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;padding:16px;";
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="display:flex;align-items:center;gap:12px;width:100%;max-width:860px;margin-bottom:10px"><span style="color:#f0ece4;font-size:.9rem;flex:1">${esc(name)}</span><a href="${src}" target="_blank" style="color:#d4a84b;font-size:.8rem;text-decoration:none"><i class="fa-solid fa-download"></i> Download</a><button onclick="document.getElementById('adminPDFModal').remove()" style="background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:1.1rem"><i class="fa-solid fa-xmark"></i></button></div><iframe src="${src}" style="width:100%;max-width:860px;flex:1;border:none;border-radius:10px;background:#fff"></iframe>`;
}

const adminAudioPlayers = {};
function toggleAdminAudio(btn, src) {
  let audio = adminAudioPlayers[src];
  if (!audio) {
    audio = new Audio(src);
    adminAudioPlayers[src] = audio;
    const bar = btn.nextElementSibling,
      dur = bar?.nextElementSibling;
    audio.addEventListener("timeupdate", () => {
      const p = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      const pr = bar?.querySelector(".audio-progress");
      if (pr) pr.style.width = p + "%";
      if (dur) dur.textContent = fmtT(audio.currentTime);
    });
    audio.addEventListener("ended", () => {
      btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    });
  }
  if (audio.paused) {
    audio.play();
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    audio.pause();
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
}
function fmtT(s) {
  const m = Math.floor(s / 60);
  return m + ":" + (Math.floor(s % 60) + "").padStart(2, "0");
}

// ── Typing indicator broadcast (admin → user) ─────────────────
let adminIsTyping = false,
  adminTypingTimer = null;
function broadcastAdminTyping(isTyp) {
  if (!liveCh && sbClient && activeSession && activeSession !== "joy") {
    // Use the realtime channel already subscribed in admin.js
  }
  // Broadcast via Supabase realtime broadcast on rtChannel
  if (rtChannel) {
    rtChannel
      .send({
        type: "broadcast",
        event: "typing",
        payload: { sender: "admin", sessionId: activeSession, typing: isTyp },
      })
      .catch(() => {});
  }
}

// Hook into admin input keystrokes for typing broadcast
document.getElementById("adminInput")?.addEventListener("input", () => {
  if (!activeSession || activeSession === "joy") return;
  if (!adminIsTyping) {
    adminIsTyping = true;
    broadcastAdminTyping(true);
  }
  clearTimeout(adminTypingTimer);
  adminTypingTimer = setTimeout(() => {
    adminIsTyping = false;
    broadcastAdminTyping(false);
  }, 2000);
});

// ── Override sendAdminMsg to include reply support ─────────────
const _origSendMsg = window.sendAdminMsg;
window.sendAdminMsg = async function () {
  const input = g("adminInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  adminIsTyping = false;
  broadcastAdminTyping(false);

  if (activeSession === "joy" || chatMode === "bot") {
    // Let original AI handler run
    const fakeInput = { value: text };
    g("adminInput").value = text;
    if (_origSendMsg) {
      await _origSendMsg();
    } else {
      appendMsg(text, "out", "A");
      playSound("send");
    }
    clearAdminReply();
    return;
  }

  if (!activeSession) return;

  const tempId = "tmp-" + Date.now();
  renderBubble({
    id: tempId,
    sender: "admin",
    name: "Admin",
    text,
    timestamp: new Date().toISOString(),
    reply_to_id: adminReplyTo?.id || null,
    reply_preview: adminReplyTo?.text?.substring(0, 80) || null,
  });
  sentIds.add(tempId);
  clearAdminReply();
  playSound("send");

  try {
    const res = await api("/api/live-chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: activeSession,
        sender: "admin",
        name: "Admin",
        text,
        timestamp: new Date().toISOString(),
        replyToId: adminReplyTo?.id || null,
        replyPreview: adminReplyTo?.text || null,
      }),
    });
    if (res.id) {
      sentIds.add(String(res.id));
      const el = g("adminMsgs").querySelector(`[data-msg-id="${tempId}"]`);
      if (el) el.dataset.msgId = res.id;
    }
  } catch (_) {
    appendMsg("⚠ Send failed.", "in", "⚠");
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("adminLightbox")?.remove();
    document.getElementById("adminPDFModal")?.remove();
  }
});
