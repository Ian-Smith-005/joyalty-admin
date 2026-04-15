/* ============================================================
   JOYALTY ADMIN — admin.js
   ✓ Supabase URL loaded from /api/config (awaits __configReady)
   ✓ Firebase auth persists — no login flash on refresh
   ✓ Tab memory (sessionStorage)
   ✓ Supabase Realtime live chat
   ✓ Joy AI with live data context
   ✓ Double-bubble fix (data-msg-id dedup + sentIds)
   ✓ Push notifications + sound
   ✓ Profile editor + avatar
   ✓ Full CRUD bookings
============================================================ */

// ── Wait for Supabase config to be ready (set by index.html) ─
// admin.js is loaded dynamically only AFTER window.__configReady resolves,
// so SUPABASE_URL and SUPABASE_ANON are guaranteed to be set here.

const SB_URL = window.SUPABASE_URL || "";
const SB_ANON = window.SUPABASE_ANON || "";

// Only create Supabase client if we have valid config
let sbClient = null;
if (SB_URL && SB_ANON && SB_URL !== "https://YOUR_PROJECT.supabase.co") {
  try {
    sbClient = supabase.createClient(SB_URL, SB_ANON);
    console.log("[admin] Supabase client ready:", SB_URL);
  } catch (e) {
    console.error("[admin] Supabase init failed:", e.message);
  }
} else {
  console.warn(
    "[admin] Supabase URL not configured — realtime disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY in Cloudflare env vars.",
  );
}

// ── State ──────────────────────────────────────────────────────
let currentUser = null;
let allBookings = [];
let allClients = [];
let chatMode = "bot";
let aiConvo = [];
let activeSession = null;
let sentIds = new Set();
let rtChannel = null;
let unread = 0;
let prefs = loadPrefs();
let editId = null;

// ═══════════════════════════════════════════════════════════════
// SUPABASE REALTIME
// ═══════════════════════════════════════════════════════════════
function subscribeRealtime() {
  if (!sbClient) return;
  if (rtChannel) sbClient.removeChannel(rtChannel);
  rtChannel = sbClient
    .channel("admin-live-chat")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "live_chat_messages" },
      (payload) => {
        const msg = payload.new;
        if (!msg) return;
        if (msg.sender === "admin" && sentIds.has(String(msg.id))) return;

        if (msg.session_id === activeSession) {
          renderBubble(msg);
        } else {
          unread++;
          updateBadges();
          loadSessions();
          if (prefs.chatNotif !== false) {
            pushNotif("New message from " + (msg.name || "a client"), msg.text);
            if (prefs.soundNotif) beep();
          }
        }
      },
    )
    .subscribe((status) => {
      console.log("[realtime] status:", status);
    });
}

// ═══════════════════════════════════════════════════════════════
// AUTH — Firebase persistence prevents login flash on refresh
// ═══════════════════════════════════════════════════════════════
function showApp(user) {
  currentUser = user;
  // Hide login, show app — but keep login hidden via CSS initially
  // so there's no visible flash
  g("loginScreen").style.display = "none";
  g("adminApp").style.display = "flex";

  const init = (user.displayName || user.email || "A")[0].toUpperCase();
  setText("sbAvatar", init);
  setText("sbName", user.displayName || user.email.split("@")[0]);
  setText("avaPreview", init);
  setVal("profileEmail", user.email || "");
  setVal("profileName", ls("adminDisplayName") || user.displayName || "");
  setVal("profileStudio", ls("adminStudio") || "");
  setVal("profilePhone", ls("adminPhone") || "");

  const savedAva = ls("adminAva");
  if (savedAva) setAvaImg(savedAva);

  loadPrefsUI();
  subscribeRealtime();
  initDash();
  switchTab(sessionStorage.getItem("adminTab") || "overview", true);
}

function showLogin(err) {
  g("adminApp").style.display = "none";
  g("loginScreen").style.display = "flex";
  if (err) {
    const el = g("loginError");
    if (el) {
      el.textContent = err;
      el.style.display = "block";
    }
  }
}

async function doLogin() {
  const email = getVal("loginEmail"),
    pass = getVal("loginPass");
  const errEl = g("loginError"),
    btn = g("loginBtnText");
  if (errEl) errEl.style.display = "none";
  if (!email || !pass) {
    if (errEl) {
      errEl.textContent = "Enter your email and password.";
      errEl.style.display = "block";
    }
    return;
  }
  if (btn) btn.innerHTML = '<span class="spinner"></span>';
  try {
    const user = await window.joyaltyAuth.firebaseSignIn(email, pass);
    showApp(user);
  } catch (e) {
    if (btn) btn.textContent = "Sign In";
    const msg =
      e.code === "auth/wrong-password" || e.code === "auth/user-not-found"
        ? "Incorrect email or password."
        : e.message || "Login failed.";
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }
  }
}

async function doLogout() {
  if (rtChannel && sbClient) sbClient.removeChannel(rtChannel);
  await window.joyaltyAuth.firebaseSignOut().catch(() => {});
  currentUser = null;
  sessionStorage.removeItem("adminTab");
  showLogin();
  setVal("loginEmail", "");
  setVal("loginPass", "");
}

function togglePw() {
  const inp = g("loginPass"),
    ico = g("pwIcon");
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  if (ico)
    ico.className =
      inp.type === "text" ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
}

g("loginPass")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") doLogin();
});

// ── KEY FIX: checkAuthState runs immediately on page load.
// Firebase persists the session in IndexedDB, so on refresh it calls
// onLoggedIn immediately — the login screen never shows.
// We hide loginScreen via CSS initially (display:none set on the element
// itself in HTML, not via body class) to prevent any flash.
window.joyaltyAuth.checkAuthState(
  (user) => showApp(user),
  () => showLogin(),
);

// ═══════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════
const TITLES = {
  overview: "Overview",
  bookings: "Bookings",
  clients: "Clients",
  email: "Email",
  chat: "Chat",
  analytics: "Analytics",
  profile: "Profile",
};

function switchTab(tab, silent) {
  document.querySelectorAll(".tab").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item[data-tab],.bn-item[data-tab]").forEach(n => {
    n.classList.toggle("active", n.dataset.tab === tab);
  });
  g("tab-"+tab)?.classList.add("active");
  setText("tabTitle", TITLES[tab] || tab);
  if (!silent) sessionStorage.setItem("adminTab", tab);
 
  // ── Chat mode class — lets CSS give the chat panel full height
  //    without bleeding into other tabs (fallback for no :has())
  const pc = document.querySelector(".page-content");
  if (pc) pc.classList.toggle("chat-mode", tab === "chat");
 
  if (tab === "bookings")  loadBookings();
  if (tab === "clients")   loadClients();
  if (tab === "analytics") renderAnalytics();
  if (tab === "chat")      { initChat(); resetUnread(); }
}
 1

document
  .querySelectorAll(".nav-item[data-tab],.bn-item[data-tab]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tab;
      if (t && t !== "more") switchTab(t);
    });
  });

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
async function initDash() {
  await Promise.all([loadStats(), loadBookings()]);
  renderOverviewCharts();
}

async function loadStats() {
  try {
    const d = await api("/api/admin/stats");
    if (d.error) return;
    setText("st-total", d.totalBookings ?? "—");
    setText("st-confirmed", d.confirmedBookings ?? "—");
    setText("st-pending", d.pendingBookings ?? "—");
    setText(
      "st-revenue",
      d.totalRevenue ? Number(d.totalRevenue).toLocaleString() : "—",
    );
    const p = d.pendingBookings ?? 0;
    setText("pendingBadge", p);
    g("pendingBadge").style.display = p > 0 ? "" : "none";
    setText("bnPending", p);
    g("bnPending").style.display = p > 0 ? "" : "none";
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// BOOKINGS
// ═══════════════════════════════════════════════════════════════
async function loadBookings() {
  try {
    const d = await api("/api/admin/bookings");
    if (!Array.isArray(d.bookings)) {
      showAlert("bookingsAlert", d.error || "Load failed.", "error");
      return;
    }
    allBookings = d.bookings;
    renderBookings(allBookings);
  } catch (e) {
    showAlert("bookingsAlert", e.message, "error");
  }
}

function renderBookings(rows) {
  const tb = g("bookingsBody");
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7"><div class="empty-state">No bookings yet</div></td></tr>`;
    return;
  }
  tb.innerHTML = rows
    .map(
      (b) => `
    <tr>
      <td style="font-family:monospace;font-size:.76rem">${esc(b.booking_ref)}</td>
      <td><div style="font-weight:600">${esc(b.client_name || "—")}</div><div style="font-size:.72rem;color:var(--muted)">${esc(b.client_email || "")}</div></td>
      <td>${esc(b.service_name || "—")}</td>
      <td style="font-size:.8rem">${b.event_date ? new Date(b.event_date).toLocaleDateString("en-KE") : "—"}</td>
      <td style="font-weight:600">KSh ${Number(b.total_price || 0).toLocaleString()}</td>
      <td>${badge(b.status)}</td>
      <td style="white-space:nowrap">
        <button class="act-btn edit" onclick="openEditBooking(${b.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="act-btn"      onclick="emailShortcut('${esc(b.client_email)}','${esc(b.booking_ref)}')" title="Email"><i class="fa-solid fa-envelope"></i></button>
        <button class="act-btn del"  onclick="openDeleteBooking(${b.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`,
    )
    .join("");
}

function badge(s) {
  const cls = s === "pending_payment" ? "pending" : s || "pending";
  const lbl =
    s === "pending_payment"
      ? "Pending"
      : s
        ? s[0].toUpperCase() + s.slice(1)
        : "—";
  return `<span class="status-badge ${cls}">${esc(lbl)}</span>`;
}

function openCreateBooking() {
  editId = null;
  setText("bmTitle", "New Booking");
  [
    "bm-name",
    "bm-email",
    "bm-phone",
    "bm-date",
    "bm-location",
    "bm-notes",
  ].forEach((i) => setVal(i, ""));
  setIdx("bm-service", 0);
  setIdx("bm-package", 0);
  setIdx("bm-extra", 0);
  openModal("bookingModal");
}
function openEditBooking(id) {
  const b = allBookings.find((x) => x.id === id);
  if (!b) return;
  editId = id;
  setText("bmTitle", "Edit Booking");
  setVal("bm-name", b.client_name || "");
  setVal("bm-email", b.client_email || "");
  setVal("bm-phone", b.client_phone || "");
  setVal("bm-location", b.event_location || "");
  setVal("bm-notes", b.event_description || "");
  setVal("bm-date", b.event_date ? b.event_date.slice(0, 10) : "");
  selByText("bm-service", b.service_name || "");
  selByText("bm-package", b.package_name || "Standard");
  selByText("bm-extra", b.extra_name || "None");
  openModal("bookingModal");
}
function selByText(id, txt) {
  const s = g(id);
  if (!s) return;
  for (let i = 0; i < s.options.length; i++) {
    if (s.options[i].text === txt || s.options[i].value === txt) {
      s.selectedIndex = i;
      return;
    }
  }
}
async function submitBooking() {
  const body = {
    clientName: getVal("bm-name"),
    clientEmail: getVal("bm-email"),
    clientPhone: getVal("bm-phone"),
    serviceType: getVal("bm-service"),
    servicePackage: getVal("bm-package") || "Standard",
    extraServices: getVal("bm-extra") || "None",
    eventDate: getVal("bm-date") || null,
    eventLocation: getVal("bm-location") || null,
    eventDescription: getVal("bm-notes") || null,
  };
  if (!body.clientName || !body.clientEmail || !body.serviceType) {
    showAlert("bmAlert", "Name, email and service required.", "error");
    return;
  }
  try {
    const ep = editId ? `/api/admin/bookings/${editId}` : "/api/bookings";
    const d = await api(ep, {
      method: editId ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    if (d.success || d.bookingRef) {
      closeModal("bookingModal");
      await Promise.all([loadBookings(), loadStats()]);
      toast(
        editId ? "Booking updated." : `Booking ${d.bookingRef} created.`,
        "success",
      );
      switchTab("bookings");
    } else showAlert("bmAlert", d.error || "Failed.", "error");
  } catch (e) {
    showAlert("bmAlert", e.message, "error");
  }
}
function openDeleteBooking(id) {
  setVal("deleteId", id);
  openModal("deleteModal");
}
async function confirmDelete() {
  const id = getVal("deleteId");
  try {
    const d = await api(`/api/admin/bookings/${id}`, { method: "DELETE" });
    closeModal("deleteModal");
    if (d.success) {
      await Promise.all([loadBookings(), loadStats()]);
      toast("Booking deleted.", "success");
    } else toast(d.error || "Delete failed.", "error");
  } catch (e) {
    closeModal("deleteModal");
    toast(e.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════
// CLIENTS + SEARCH
// ═══════════════════════════════════════════════════════════════
async function loadClients() {
  try {
    const d = await api("/api/admin/clients");
    if (!Array.isArray(d.clients)) return;
    allClients = d.clients;
    const tb = g("clientsBody");
    if (!tb) return;
    tb.innerHTML = allClients.length
      ? allClients
          .map(
            (c) =>
              `<tr><td style="font-weight:600">${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone || "—")}</td><td style="font-size:.78rem;color:var(--muted)">${c.created_at ? new Date(c.created_at).toLocaleDateString("en-KE") : "—"}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4"><div class="empty-state">No clients yet</div></td></tr>`;
  } catch (_) {}
}
function onSearch(q) {
  if (!q) {
    renderBookings(allBookings);
    return;
  }
  const lq = q.toLowerCase();
  renderBookings(
    allBookings.filter(
      (b) =>
        (b.booking_ref || "").toLowerCase().includes(lq) ||
        (b.client_name || "").toLowerCase().includes(lq) ||
        (b.client_email || "").toLowerCase().includes(lq) ||
        (b.service_name || "").toLowerCase().includes(lq),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════
// EMAIL
// ═══════════════════════════════════════════════════════════════
function emailShortcut(email, ref) {
  switchTab("email");
  setVal("emailTo", email);
  setVal("emailSubject", `Re: Your booking ${ref} — Joyalty Photography`);
}
async function sendAdminEmail() {
  const to = getVal("emailTo"),
    subject = getVal("emailSubject"),
    message = getVal("emailBody");
  if (!to || !subject || !message) {
    showAlert("emailAlert", "Fill all fields.", "error");
    return;
  }
  try {
    const d = await api("/api/contact", {
      method: "POST",
      body: JSON.stringify({
        name: "Joyalty Admin",
        email: to,
        subject,
        message,
      }),
    });
    if (d.success) {
      showAlert("emailAlert", "Email sent.", "success");
      ["emailTo", "emailSubject", "emailBody"].forEach((i) => setVal(i, ""));
    } else showAlert("emailAlert", d.error || "Send failed.", "error");
  } catch (e) {
    showAlert("emailAlert", e.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════
function initChat() {
  g("modeBtnBot")?.classList.toggle("active", chatMode === "bot");
  g("modeBtnLive")?.classList.toggle("active", chatMode === "live");
  if (chatMode === "bot") renderBotContact();
  else loadSessions();
}
function setChatMode(mode) {
  chatMode = mode;
  g("modeBtnBot")?.classList.toggle("active", mode === "bot");
  g("modeBtnLive")?.classList.toggle("active", mode === "live");
  g("adminMsgs").innerHTML = "";
  activeSession = null;
  if (mode === "bot") {
    renderBotContact();
    showContacts();
  } else {
    loadSessions();
    showContacts();
  }
}

function renderBotContact() {
  g("contactList").innerHTML =
    `<div class="contact-item active" id="botItem" onclick="selectBot(this)"><div class="c-ava bot"><i class="fa-solid fa-robot"></i></div><div><div class="c-name">Joy — AI Assistant</div><div class="c-prev">Live data: bookings, revenue, clients</div></div></div>`;
  selectBot(g("botItem"));
}
function selectBot(el) {
  document
    .querySelectorAll(".contact-item")
    .forEach((e) => e.classList.remove("active"));
  el.classList.add("active");
  activeSession = "joy";
  setText("chatHdName", "Joy — AI Assistant");
  setText("chatHdSub", "Gemini · live dashboard context");
  g("chatHdAva").className = "chat-ava bot";
  g("chatHdAva").innerHTML = '<i class="fa-solid fa-robot"></i>';
  g("adminMsgs").innerHTML = "";
  aiConvo = [];
  appendMsg(
    "Hi Admin 👋 I have your live bookings, clients and revenue data. Ask me anything.",
    "in",
    "🤖",
  );
  showChat();
}

async function loadSessions() {
  try {
    const d = await api("/api/live-chat/sessions");
    renderContacts(d.sessions || []);
  } catch (_) {
    renderContacts([]);
  }
}
function renderContacts(sessions) {
  const list = g("contactList");
  if (!sessions.length) {
    list.innerHTML = `<div class="empty-state" style="padding:20px 14px;font-size:.81rem">No live sessions yet.</div>`;
    return;
  }
  list.innerHTML = sessions
    .map((s) => {
      const name = s.name || s.session_id.split("-")[0];
      return `<div class="contact-item${s.session_id === activeSession ? " active" : ""}" onclick="selectSession('${esc(s.session_id)}','${esc(name)}')"><div class="c-ava">${name[0].toUpperCase()}</div><div style="min-width:0;flex:1"><div class="c-name">${esc(name)}</div><div class="c-prev">${esc((s.last_text || "").substring(0, 34))}</div></div>${s.unread > 0 ? `<span class="c-unread">${s.unread}</span>` : ""}</div>`;
    })
    .join("");
}
async function selectSession(sid, name) {
  document
    .querySelectorAll(".contact-item")
    .forEach((e) => e.classList.remove("active"));
  document
    .querySelector(`.contact-item[onclick*="${sid}"]`)
    ?.classList.add("active");
  activeSession = sid;
  setText("chatHdName", name || sid.split("-")[0]);
  setText("chatHdSub", "Live · " + sid);
  g("chatHdAva").className = "chat-ava";
  g("chatHdAva").textContent = (name || "?")[0].toUpperCase();
  g("adminMsgs").innerHTML = "";
  try {
    const d = await api(`/api/live-chat?sessionId=${encodeURIComponent(sid)}`);
    (d.messages || []).forEach(renderBubble);
  } catch (_) {}
  showChat();
}

function renderBubble(msg) {
  const msgs = g("adminMsgs");
  if (msgs.querySelector(`[data-msg-id="${msg.id}"]`)) return; // ← dedup
  const isOut = msg.sender === "admin";
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString(
    "en-KE",
    { hour: "2-digit", minute: "2-digit" },
  );
  const div = document.createElement("div");
  div.className = `msg ${isOut ? "out" : "in"}`;
  div.dataset.msgId = msg.id;
  div.innerHTML = `<div class="msg-ava">${isOut ? "A" : (msg.name || "?")[0].toUpperCase()}</div><div class="msg-col"><div class="msg-bubble">${esc(msg.text)}</div><div class="msg-time">${isOut ? "You" : "Client"} · ${time}</div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendAdminMsg() {
  const input = g("adminInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  // ── Joy AI ──────────────────────────────────────────────────
  if (activeSession === "joy" || chatMode === "bot") {
    aiConvo.push({ type: "user", text });
    appendMsg(text, "out", "A");
    const ctx = `You are Joy, AI assistant for Joyalty Photography admin dashboard.
LIVE DATA: Total bookings: ${allBookings.length}, Confirmed: ${allBookings.filter((b) => b.status === "confirmed").length}, Pending: ${allBookings.filter((b) => b.status === "pending_payment").length}, Revenue: KSh ${allBookings.reduce((a, b) => a + Number(b.deposit_paid || 0), 0).toLocaleString()}, Clients: ${allClients.length}. Today: ${new Date().toLocaleDateString("en-KE", { dateStyle: "full" })}.
Be concise and helpful.`;
    const formatted = [
      { role: "user", parts: [{ text: ctx }] },
      ...aiConvo
        .slice(0, -1)
        .map((m) => ({
          role: m.type === "user" ? "user" : "model",
          parts: [{ text: m.text }],
        })),
      { role: "user", parts: [{ text }] },
    ];
    const tp = document.createElement("div");
    tp.className = "typing";
    tp.id = "adminTyping";
    tp.innerHTML = "<span></span><span></span><span></span>";
    g("adminMsgs").appendChild(tp);
    g("adminMsgs").scrollTop = 99999;
    try {
      const res = await api("/api/gemini-chat", {
        method: "POST",
        body: JSON.stringify({ messages: formatted }),
      });
      tp.remove();
      const reply = res.reply || "I couldn't respond.";
      aiConvo.push({ type: "bot", text: reply });
      appendMsg(reply, "in", "🤖");
    } catch (_) {
      tp.remove();
      appendMsg("Connection error.", "in", "⚠");
    }
    return;
  }

  // ── Live reply ──────────────────────────────────────────────
  if (!activeSession) return;
  const tempId = "tmp-" + Date.now();
  renderBubble({
    id: tempId,
    sender: "admin",
    name: "Admin",
    text,
    timestamp: new Date().toISOString(),
  });
  sentIds.add(tempId);
  try {
    const res = await api("/api/live-chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: activeSession,
        sender: "admin",
        name: "Admin",
        text,
        timestamp: new Date().toISOString(),
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

function appendMsg(text, dir, ava) {
  const msgs = g("adminMsgs");
  const time = new Date().toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const div = document.createElement("div");
  div.className = `msg ${dir}`;
  div.innerHTML = `<div class="msg-ava">${ava || (dir === "out" ? "A" : "?")}</div><div class="msg-col"><div class="msg-bubble">${esc(text)}</div><div class="msg-time">${time}</div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
function clearChat() {
  aiConvo = [];
  g("adminMsgs").innerHTML = "";
  if (chatMode === "bot")
    appendMsg("Chat cleared. Ask me anything.", "in", "🤖");
}

function showChat() {
  if (window.innerWidth <= 768) {
    g("chatContacts")?.classList.add("hidden");
    g("chatMain")?.classList.remove("hidden");
  }
}
function showContacts() {
  if (window.innerWidth <= 768) {
    g("chatContacts")?.classList.remove("hidden");
    g("chatMain")?.classList.add("hidden");
  }
}

function updateBadges() {
  ["chatBadgeSB", "bnChat"].forEach((id) => {
    const el = g(id);
    if (!el) return;
    el.textContent = unread > 0 ? unread : "!";
    el.style.display = unread > 0 ? "" : "none";
  });
}
function resetUnread() {
  unread = 0;
  updateBadges();
}

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
async function requestNotifPerm() {
  if (!("Notification" in window)) {
    toast("Not supported.", "error");
    return;
  }
  const p = await Notification.requestPermission();
  if (p === "granted") {
    toast("Notifications enabled ✓", "success");
    g("notifDot").style.display = "";
    g("pushToggle").checked = true;
    savePref("pushEnabled", true);
    prefs.pushEnabled = true;
    setText("notifStatus", "Notifications are enabled.");
  } else {
    toast("Permission denied.", "error");
    setText("notifStatus", "Enable in browser settings.");
  }
}
function togglePush(on) {
  if (on) requestNotifPerm();
  else {
    savePref("pushEnabled", false);
    prefs.pushEnabled = false;
    setText("notifStatus", "Disabled.");
  }
}
function pushNotif(title, body) {
  if (!prefs.pushEnabled || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/admin/icons/icon-192.png" });
  } catch (_) {}
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)(),
      o = c.createOscillator(),
      gn = c.createGain();
    o.connect(gn);
    gn.connect(c.destination);
    o.frequency.setValueAtTime(880, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, c.currentTime + 0.15);
    gn.gain.setValueAtTime(0.28, c.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.start();
    o.stop(c.currentTime + 0.3);
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════
function previewAva(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast("Max 2 MB.", "error");
    return;
  }
  const r = new FileReader();
  r.onload = (e) => {
    setAvaImg(e.target.result);
    localStorage.setItem("adminAva", e.target.result);
  };
  r.readAsDataURL(file);
}
function setAvaImg(src) {
  ["avaPreview", "sbAvatar"].forEach((id) => {
    const el = g(id);
    if (el)
      el.innerHTML = `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  });
}
function saveProfile() {
  const name = getVal("profileName"),
    studio = getVal("profileStudio"),
    phone = getVal("profilePhone");
  if (name) {
    localStorage.setItem("adminDisplayName", name);
    setText("sbName", name);
  }
  if (studio) localStorage.setItem("adminStudio", studio);
  if (phone) localStorage.setItem("adminPhone", phone);
  toast("Profile saved.", "success");
}
async function changePassword() {
  const np = getVal("newPw"),
    cp = getVal("confirmPw");
  if (!np || np.length < 8) {
    showAlert("pwAlert", "Min 8 characters.", "error");
    return;
  }
  if (np !== cp) {
    showAlert("pwAlert", "Passwords do not match.", "error");
    return;
  }
  try {
    await firebase.auth().currentUser?.updatePassword(np);
    showAlert("pwAlert", "Password updated.", "success");
    setVal("newPw", "");
    setVal("confirmPw", "");
  } catch (e) {
    showAlert("pwAlert", e.message, "error");
  }
}
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem("adminPrefs") || "{}");
  } catch (_) {
    return {};
  }
}
function savePref(k, v) {
  prefs[k] = v;
  localStorage.setItem("adminPrefs", JSON.stringify(prefs));
}
function loadPrefsUI() {
  const pt = g("pushToggle"),
    cn = g("chatNotifToggle"),
    sn = g("soundToggle");
  if (pt) pt.checked = !!prefs.pushEnabled;
  if (cn) cn.checked = prefs.chatNotif !== false;
  if (sn) sn.checked = !!prefs.soundNotif;
  const ok = Notification.permission === "granted";
  setText(
    "notifStatus",
    ok && prefs.pushEnabled
      ? "Notifications are enabled."
      : "Click 🔔 to enable.",
  );
  if (ok && prefs.pushEnabled) {
    const d = g("notifDot");
    if (d) d.style.display = "";
  }
}

// ═══════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════
let charts = {};
function renderOverviewCharts() {
  const mo = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const now = new Date().getMonth(),
    labels = mo.slice(Math.max(0, now - 5), now + 1);
  dc("bookingsChart");
  charts.bk = new Chart(g("bookingsChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: [2, 5, 3, 8, 6, allBookings.length || 1],
          backgroundColor: "rgba(212,168,75,.3)",
          borderColor: "#d4a84b",
          borderWidth: 1.5,
          borderRadius: 5,
        },
      ],
    },
    options: cOpts(),
  });
  const sc = {};
  allBookings.forEach((b) => {
    const s = b.service_name || "Other";
    sc[s] = (sc[s] || 0) + 1;
  });
  const sl = Object.keys(sc).length
    ? Object.keys(sc)
    : ["Wedding", "Portrait", "Commercial", "Event"];
  const sd = Object.keys(sc).length ? Object.values(sc) : [4, 3, 2, 2];
  dc("servicesChart");
  charts.svc = new Chart(g("servicesChart"), {
    type: "doughnut",
    data: {
      labels: sl,
      datasets: [
        {
          data: sd,
          backgroundColor: [
            "#d4a84b",
            "#7c6ef0",
            "#22c55e",
            "#ef4444",
            "#f59e0b",
            "#06b6d4",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8892a4", font: { size: 11 }, padding: 9 },
        },
      },
    },
  });
  dc("revenueChart");
  charts.rv = new Chart(g("revenueChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: [
            45e3,
            90e3,
            60e3,
            160e3,
            120e3,
            allBookings.reduce((a, b) => a + Number(b.deposit_paid || 0), 0) ||
              45e3,
          ],
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,.08)",
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#22c55e",
          pointRadius: 3,
        },
      ],
    },
    options: cOpts({ yTick: (v) => `${(v / 1000).toFixed(0)}K` }),
  });
}
function renderAnalytics() {
  const sc = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
  allBookings.forEach((b) => {
    if (sc[b.status] !== undefined) sc[b.status]++;
  });
  dc("statusChart");
  charts.st = new Chart(g("statusChart"), {
    type: "pie",
    data: {
      labels: Object.keys(sc),
      datasets: [
        {
          data: Object.values(sc),
          backgroundColor: ["#f59e0b", "#22c55e", "#ef4444", "#d4a84b"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8892a4", font: { size: 11 } },
        },
      },
    },
  });
  dc("paymentChart");
  charts.pm = new Chart(g("paymentChart"), {
    type: "doughnut",
    data: {
      labels: ["M-Pesa", "Pending"],
      datasets: [
        {
          data: [
            allBookings.filter((b) => b.status === "confirmed").length || 6,
            allBookings.filter((b) => b.status === "pending_payment").length ||
              1,
          ],
          backgroundColor: ["#22c55e", "#f59e0b"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8892a4", font: { size: 11 } },
        },
      },
    },
  });
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 29 + i);
    return d.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
  });
  dc("dailyChart");
  charts.dr = new Chart(g("dailyChart"), {
    type: "bar",
    data: {
      labels: days,
      datasets: [
        {
          label: "Revenue",
          data: days.map((_, i) =>
            i === 29 ? 45e3 : i === 28 ? 30e3 : i === 25 ? 18e3 : 0,
          ),
          backgroundColor: "rgba(212,168,75,.3)",
          borderColor: "#d4a84b",
          borderWidth: 1.5,
          borderRadius: 2,
        },
      ],
    },
    options: cOpts({ xLimit: 8, yTick: (v) => `${(v / 1000).toFixed(0)}K` }),
  });
}
function cOpts(o = {}) {
  return {
    plugins: { legend: { display: false } },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: "rgba(255,255,255,.04)" },
        ticks: o.yTick ? { callback: o.yTick } : {},
        border: { display: false },
      },
      x: {
        grid: { display: false },
        ticks: o.xLimit ? { maxTicksLimit: o.xLimit } : {},
        border: { display: false },
      },
    },
  };
}
function dc(id) {
  const c = Chart.getChart(id);
  if (c) c.destroy();
}

// ═══════════════════════════════════════════════════════════════
// MOBILE NAV
// ═══════════════════════════════════════════════════════════════
function toggleSidebar() {
  const sb = g("sidebar"),
    open = sb.classList.toggle("open");
  g("sbOverlay")?.classList.toggle("open", open);
}
function closeSidebar() {
  g("sidebar")?.classList.remove("open");
  g("sbOverlay")?.classList.remove("open");
}
function openMore() {
  g("moreSheet")?.classList.add("open");
  g("sheetOverlay")?.classList.add("open");
}
function closeMore() {
  g("moreSheet")?.classList.remove("open");
  g("sheetOverlay")?.classList.remove("open");
}

// ═══════════════════════════════════════════════════════════════
// MODALS / ALERTS / TOASTS
// ═══════════════════════════════════════════════════════════════
function openModal(id) {
  g(id)?.classList.add("open");
}
function closeModal(id) {
  g(id)?.classList.remove("open");
}
document.querySelectorAll(".modal-wrap").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.target === el) el.classList.remove("open");
  });
});

function toast(msg, type = "info") {
  const icons = {
    success: "fa-circle-check",
    error: "fa-triangle-exclamation",
    info: "fa-bell",
  };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i>${esc(msg)}`;
  g("toastWrap")?.appendChild(t);
  setTimeout(() => {
    t.style.animation = "toastOut .25s ease forwards";
    setTimeout(() => t.remove(), 260);
  }, 3400);
}
function showAlert(id, msg, type) {
  const el = g(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type}`;
  setTimeout(() => {
    el.className = "alert";
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
async function api(url, opts = {}) {
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
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function g(id) {
  return document.getElementById(id);
}
function setText(id, v) {
  const el = g(id);
  if (el) el.textContent = v;
}
function setVal(id, v) {
  const el = g(id);
  if (el) el.value = v;
}
function getVal(id) {
  const el = g(id);
  return el ? el.value.trim() : "";
}
function setIdx(id, i) {
  const el = g(id);
  if (el) el.selectedIndex = i;
}
function ls(k) {
  return localStorage.getItem(k) || "";
}
