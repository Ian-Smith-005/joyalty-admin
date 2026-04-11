// ════════════════════════════════════════════════════════════
// JOYALTY ADMIN — admin.js
// Tabs: Overview · Bookings · Clients · Email · Chat · Analytics
// Live chat: polls /api/live-chat for client sessions + replies
// ════════════════════════════════════════════════════════════

let currentUser = null;
let allBookings = [];
let allClients = [];
let adminChatMode = "bot"; // "bot" | "live"
let aiConversation = [];

// ── Auth ──────────────────────────────────────────────────────
function _showApp(user) {
  currentUser = user;
  const initials = (user.displayName || user.email || "A")[0].toUpperCase();
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminApp").style.display = "flex";
  document.getElementById("adminNameDisplay").textContent =
    user.displayName || user.email.split("@")[0];
  document.getElementById("adminAvatarInitial").textContent = initials;
  initDashboard();
}
function _showLogin(errorMsg) {
  document.getElementById("adminApp").style.display = "none";
  document.getElementById("loginScreen").style.display = "flex";
  if (errorMsg) {
    const e = document.getElementById("loginError");
    e.textContent = errorMsg;
    e.style.display = "block";
  }
}
async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginError");
  const btnTxt = document.getElementById("loginBtnText");
  errEl.style.display = "none";
  if (!email || !pass) {
    errEl.textContent = "Enter your email and password.";
    errEl.style.display = "block";
    return;
  }
  btnTxt.innerHTML = '<span class="spinner"></span>';
  try {
    const user = await window.joyaltyAuth.firebaseSignIn(email, pass);
    _showApp(user);
  } catch (err) {
    btnTxt.textContent = "Sign In";
    const msg =
      err.code === "auth/wrong-password" || err.code === "auth/user-not-found"
        ? "Incorrect email or password."
        : err.message || "Login failed.";
    errEl.textContent = msg;
    errEl.style.display = "block";
  }
}
async function doLogout() {
  stopLivePoll();
  await window.joyaltyAuth.firebaseSignOut().catch(() => {});
  currentUser = null;
  _showLogin();
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPass").value = "";
}
document.getElementById("loginPass").addEventListener("keypress", (e) => {
  if (e.key === "Enter") doLogin();
});
window.joyaltyAuth.checkAuthState(
  (user) => _showApp(user),
  () => _showLogin(),
);

// ── Tab navigation ────────────────────────────────────────────
const TAB_TITLES = {
  overview: "Overview",
  bookings: "Bookings",
  clients: "Clients",
  email: "Email",
  chat: "Chat",
  analytics: "Analytics",
};
function switchTab(tab) {
  document
    .querySelectorAll(".tab-section")
    .forEach((s) => s.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  document
    .querySelector(`.nav-item[onclick*="${tab}"]`)
    .classList.add("active");
  document.getElementById("tabTitle").textContent = TAB_TITLES[tab] || tab;
  if (tab === "bookings") loadBookings();
  if (tab === "clients") loadClients();
  if (tab === "analytics") renderAnalytics();
  if (tab === "chat") initAdminChat();
  if (tab !== "chat") stopLivePoll();
}

// ── Dashboard init ────────────────────────────────────────────
async function initDashboard() {
  await loadStats();
  await loadBookings();
  renderOverviewCharts();
}

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch("/api/admin/stats");
    const data = await r.json();
    if (data.error) return;
    document.getElementById("st-total").textContent = data.totalBookings ?? "—";
    document.getElementById("st-confirmed").textContent =
      data.confirmedBookings ?? "—";
    document.getElementById("st-pending").textContent =
      data.pendingBookings ?? "—";
    document.getElementById("st-revenue").textContent =
      data.totalRevenue != null
        ? Number(data.totalRevenue).toLocaleString()
        : "—";
    document.getElementById("pendingCount").textContent =
      data.pendingBookings ?? 0;
  } catch (_) {}
}

// ── Bookings ──────────────────────────────────────────────────
async function loadBookings() {
  try {
    const r = await fetch("/api/admin/bookings");
    const data = await r.json();
    if (data.error) {
      showAlert("bookingsAlert", data.error, "error");
      return;
    }
    allBookings = data.bookings || [];
    renderBookings(allBookings);
  } catch (err) {
    showAlert(
      "bookingsAlert",
      "Failed to load bookings: " + err.message,
      "error",
    );
  }
}

function renderBookings(rows) {
  const tbody = document.getElementById("bookingsBody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No bookings found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (b) => `
    <tr>
      <td><code style="font-size:.78rem">${esc(b.booking_ref)}</code></td>
      <td>
        <div style="font-weight:600">${esc(b.client_name || "")}</div>
        <div style="font-size:.75rem;color:var(--muted)">${esc(b.client_email || "")}</div>
      </td>
      <td>${esc(b.service_name || "")} <span style="color:var(--muted);font-size:.78rem">${esc(b.package_name || "")}</span></td>
      <td>${b.event_date ? new Date(b.event_date).toLocaleDateString("en-KE") : "—"}</td>
      <td>KSh ${Number(b.total_price || 0).toLocaleString()}</td>
      <td>${statusBadge(b.status)}</td>
      <td>
        <button class="action-btn edit"   onclick="openEditBooking(${b.id})"   title="Edit">  <i class="fa-solid fa-pen"></i></button>
        <button class="action-btn"        onclick="openEmailClient('${esc(b.client_email)}','${esc(b.booking_ref)}')" title="Email"><i class="fa-solid fa-envelope"></i></button>
        <button class="action-btn delete" onclick="openDeleteModal(${b.id})"  title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`,
    )
    .join("");
}

function statusBadge(s) {
  const map = {
    confirmed: "confirmed",
    pending_payment: "pending",
    cancelled: "cancelled",
    completed: "completed",
  };
  const cls = map[s] || "pending";
  const lbl = s === "pending_payment" ? "Pending" : s || "—";
  return `<span class="status-badge ${cls}">${esc(lbl)}</span>`;
}

// ── Clients ───────────────────────────────────────────────────
async function loadClients() {
  try {
    const r = await fetch("/api/admin/clients");
    const data = await r.json();
    if (data.error) return;
    allClients = data.clients || [];
    const tbody = document.getElementById("clientsBody");
    if (!tbody) return;
    tbody.innerHTML = allClients
      .map(
        (c) => `
      <tr>
        <td>${esc(c.name || "")}</td>
        <td>${esc(c.email || "")}</td>
        <td>${esc(c.phone || "")}</td>
        <td>${c.created_at ? new Date(c.created_at).toLocaleDateString("en-KE") : "—"}</td>
      </tr>`,
      )
      .join("");
  } catch (_) {}
}

// ── Search ────────────────────────────────────────────────────
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

// ── Booking modal ─────────────────────────────────────────────
let editingBookingId = null;
function openCreateBooking() {
  editingBookingId = null;
  document.getElementById("bookingModalTitle").textContent = "New Booking";
  ["bm-name", "bm-email", "bm-phone", "bm-location", "bm-notes"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    },
  );
  document.getElementById("bm-service").selectedIndex = 0;
  document.getElementById("bm-package").selectedIndex = 0;
  document.getElementById("bm-extra").selectedIndex = 0;
  document.getElementById("bm-date").value = "";
  openModal("bookingModal");
}
function openEditBooking(id) {
  const b = allBookings.find((x) => x.id === id);
  if (!b) return;
  editingBookingId = id;
  document.getElementById("bookingModalTitle").textContent = "Edit Booking";
  document.getElementById("bm-name").value = b.client_name || "";
  document.getElementById("bm-email").value = b.client_email || "";
  document.getElementById("bm-phone").value = b.client_phone || "";
  document.getElementById("bm-location").value = b.event_location || "";
  document.getElementById("bm-notes").value = b.event_description || "";
  document.getElementById("bm-date").value = b.event_date
    ? b.event_date.slice(0, 10)
    : "";
  // Set selects
  ["bm-service", "bm-package", "bm-extra"].forEach((selId, i) => {
    const vals = [b.service_name, b.package_name, b.extra_name];
    const sel = document.getElementById(selId);
    if (!sel || !vals[i]) return;
    for (let j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === vals[i] || sel.options[j].text === vals[i]) {
        sel.selectedIndex = j;
        break;
      }
    }
  });
  openModal("bookingModal");
}
async function submitBookingModal() {
  const alertId = "bookingModalAlert";
  if (editingBookingId) {
    // PUT — update existing
    const body = {
      status: null,
      eventDate: document.getElementById("bm-date")?.value || null,
      eventLocation: document.getElementById("bm-location")?.value || null,
      eventDescription: document.getElementById("bm-notes")?.value || null,
    };
    try {
      const r = await fetch(`/api/admin/bookings/${editingBookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.success) {
        closeModal("bookingModal");
        loadBookings();
        showAlert("bookingsAlert", "Booking updated.", "success");
      } else {
        showAlert(alertId, data.error || "Update failed.", "error");
      }
    } catch (err) {
      showAlert(alertId, err.message, "error");
    }
  } else {
    // POST — new booking (admin-created, no M-Pesa)
    const payload = {
      clientName: document.getElementById("bm-name")?.value.trim(),
      clientEmail: document.getElementById("bm-email")?.value.trim(),
      clientPhone: document.getElementById("bm-phone")?.value.trim(),
      serviceType: document.getElementById("bm-service")?.value,
      servicePackage:
        document.getElementById("bm-package")?.value || "Standard",
      extraServices: document.getElementById("bm-extra")?.value || "None",
      eventDate: document.getElementById("bm-date")?.value || null,
      eventLocation: document.getElementById("bm-location")?.value || null,
      eventDescription: document.getElementById("bm-notes")?.value || null,
    };
    if (
      !payload.clientName ||
      !payload.clientEmail ||
      !payload.clientPhone ||
      !payload.serviceType
    ) {
      showAlert(
        alertId,
        "Name, email, phone and service are required.",
        "error",
      );
      return;
    }
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.success) {
        closeModal("bookingModal");
        loadBookings();
        loadStats();
        showAlert(
          "bookingsAlert",
          `Booking ${data.bookingRef} created.`,
          "success",
        );
      } else {
        showAlert(alertId, data.error || "Failed to create booking.", "error");
      }
    } catch (err) {
      showAlert(alertId, err.message, "error");
    }
  }
}

// ── Delete booking ────────────────────────────────────────────
function openDeleteModal(id) {
  document.getElementById("deleteBookingId").value = id;
  openModal("deleteModal");
}
async function confirmDelete() {
  const id = document.getElementById("deleteBookingId").value;
  try {
    const r = await fetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
    const data = await r.json();
    if (data.success) {
      closeModal("deleteModal");
      loadBookings();
      loadStats();
      showAlert("bookingsAlert", "Booking deleted.", "success");
    } else {
      showAlert("bookingsAlert", data.error || "Delete failed.", "error");
      closeModal("deleteModal");
    }
  } catch (err) {
    showAlert("bookingsAlert", err.message, "error");
    closeModal("deleteModal");
  }
}

// ── Email client shortcut ─────────────────────────────────────
function openEmailClient(email, ref) {
  switchTab("email");
  const toEl = document.getElementById("emailTo");
  const subEl = document.getElementById("emailSubject");
  if (toEl) toEl.value = email;
  if (subEl) subEl.value = `Re: Your booking ${ref} — Joyalty Photography`;
}

// ── Send admin email ──────────────────────────────────────────
async function sendAdminEmail() {
  const to = document.getElementById("emailTo")?.value.trim();
  const subject = document.getElementById("emailSubject")?.value.trim();
  const body = document.getElementById("emailBody")?.value.trim();
  if (!to || !subject || !body) {
    showAlert("emailAlert", "Fill in all fields before sending.", "error");
    return;
  }
  try {
    const r = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Joyalty Admin",
        email: to,
        subject,
        message: body,
      }),
    });
    const data = await r.json();
    if (data.success) {
      showAlert("emailAlert", "Email sent successfully.", "success");
      document.getElementById("emailBody").value = "";
    } else {
      showAlert("emailAlert", data.error || "Send failed.", "error");
    }
  } catch (err) {
    showAlert("emailAlert", err.message, "error");
  }
}

// ════════════════════════════════════════════════════════════
// LIVE CHAT — admin side
// ════════════════════════════════════════════════════════════

let liveSessions = {}; // { sessionId: [messages] }
let activeSessionId = null;
let livePollTimer = null;
let sessionsLoadTimer = null;

function initAdminChat() {
  document
    .getElementById("modeBtnBot")
    .classList.toggle("active", adminChatMode === "bot");
  document
    .getElementById("modeBtnLive")
    .classList.toggle("active", adminChatMode === "live");
  if (adminChatMode === "bot") {
    renderBotContact();
  } else {
    loadLiveSessions();
    startSessionsRefresh();
  }
}

function setChatMode(mode) {
  adminChatMode = mode;
  document
    .getElementById("modeBtnBot")
    .classList.toggle("active", mode === "bot");
  document
    .getElementById("modeBtnLive")
    .classList.toggle("active", mode === "live");
  document.getElementById("contactList").innerHTML = "";
  document.getElementById("adminChatMessages").innerHTML = "";
  activeSessionId = null;
  stopLivePoll();
  if (sessionsLoadTimer) {
    clearInterval(sessionsLoadTimer);
    sessionsLoadTimer = null;
  }

  if (mode === "bot") {
    renderBotContact();
  } else {
    loadLiveSessions();
    startSessionsRefresh();
  }
}

// ── Bot contact ───────────────────────────────────────────────
function renderBotContact() {
  const list = document.getElementById("contactList");
  list.innerHTML = `
    <div class="contact-item active" onclick="selectBotContact(this)">
      <div class="contact-avatar bot"><i class="fa-solid fa-robot"></i></div>
      <div>
        <div class="contact-name">Joy — AI Assistant</div>
        <div class="contact-preview">Ask about bookings, clients…</div>
      </div>
    </div>`;
  selectBotContact(list.firstElementChild);
}
function selectBotContact(el) {
  document
    .querySelectorAll(".contact-item")
    .forEach((e) => e.classList.remove("active"));
  el.classList.add("active");
  activeSessionId = "joy";
  document.getElementById("chatActiveName").textContent = "Joy — AI Assistant";
  document.getElementById("chatActiveSub").textContent = "Gemini-powered";
  const msgs = document.getElementById("adminChatMessages");
  msgs.innerHTML = "";
  aiConversation = [];
  if (!msgs.children.length) {
    appendMsg(
      "Hi Admin 👋 Ask me anything about your bookings or clients.",
      "incoming",
      "🤖",
    );
  }
}

// ── Load live sessions from DB ────────────────────────────────
async function loadLiveSessions() {
  // Fetch all unique sessions by querying recent messages without a sessionId filter
  try {
    const r = await fetch("/api/live-chat/sessions");
    const data = await r.json().catch(() => null);

    if (data && data.sessions) {
      renderSessionContacts(data.sessions);
    } else {
      // Fallback: render existing cached sessions
      renderSessionContacts(
        Object.keys(liveSessions).map((id) => ({
          session_id: id,
          name: liveSessions[id]?.[0]?.name || id.split("-")[0],
          last_text: liveSessions[id]?.slice(-1)[0]?.text || "",
          unread: countUnread(id),
        })),
      );
    }
  } catch (_) {
    // Show cached if any
    renderSessionContacts(
      Object.keys(liveSessions).map((id) => ({
        session_id: id,
        name: liveSessions[id]?.[0]?.name || id.split("-")[0],
        last_text: liveSessions[id]?.slice(-1)[0]?.text || "",
        unread: countUnread(id),
      })),
    );
  }
}

function renderSessionContacts(sessions) {
  const list = document.getElementById("contactList");
  if (!sessions.length) {
    list.innerHTML = `<div class="empty-state" style="padding:24px 16px;font-size:.82rem">No live chat sessions yet.</div>`;
    return;
  }
  list.innerHTML = sessions
    .map(
      (s) => `
    <div class="contact-item ${s.session_id === activeSessionId ? "active" : ""}"
         onclick="selectLiveSession('${esc(s.session_id)}', '${esc(s.name || s.session_id.split("-")[0])}')">
      <div class="contact-avatar">${(s.name || "?")[0].toUpperCase()}</div>
      <div style="min-width:0;flex:1">
        <div class="contact-name">${esc(s.name || s.session_id.split("-")[0])}</div>
        <div class="contact-preview">${esc((s.last_text || "").substring(0, 40))}</div>
      </div>
      ${s.unread > 0 ? `<span class="contact-unread">${s.unread}</span>` : ""}
    </div>`,
    )
    .join("");
}

function countUnread(sessionId) {
  const msgs = liveSessions[sessionId] || [];
  return msgs.filter((m) => m.sender === "user" && !m._read).length;
}

// ── Select a live session ─────────────────────────────────────
async function selectLiveSession(sessionId, name) {
  activeSessionId = sessionId;
  stopLivePoll();

  document
    .querySelectorAll(".contact-item")
    .forEach((e) => e.classList.remove("active"));
  const item = document.querySelector(`.contact-item[onclick*="${sessionId}"]`);
  if (item) item.classList.add("active");

  document.getElementById("chatActiveName").textContent =
    name || sessionId.split("-")[0];
  document.getElementById("chatActiveSub").textContent =
    "Live conversation · " + sessionId;

  const msgs = document.getElementById("adminChatMessages");
  msgs.innerHTML = "";

  // Load full history
  await fetchAndRenderSession(sessionId);
  startLivePoll(sessionId);
}

async function fetchAndRenderSession(sessionId) {
  try {
    const r = await fetch(
      `/api/live-chat?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const data = await r.json();
    if (!data.messages) return;

    // Mark all as read
    liveSessions[sessionId] = data.messages.map((m) => ({ ...m, _read: true }));

    const msgs = document.getElementById("adminChatMessages");
    msgs.innerHTML = "";
    data.messages.forEach((m) => renderAdminChatBubble(m));
  } catch (_) {}
}

function renderAdminChatBubble(msg) {
  const isAdmin = msg.sender === "admin";
  const msgs = document.getElementById("adminChatMessages");
  const div = document.createElement("div");
  div.className = `msg ${isAdmin ? "outgoing" : "incoming"}`;
  div.dataset.msgId = msg.id;
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString(
    "en-KE",
    { hour: "2-digit", minute: "2-digit" },
  );
  div.innerHTML = `
    <div class="msg-avatar-sm">${isAdmin ? "A" : (msg.name || "?")[0].toUpperCase()}</div>
    <div>
      <div class="msg-bubble">${esc(msg.text)}</div>
      <div style="font-size:10px;opacity:.35;margin-top:3px;text-align:${isAdmin ? "right" : "left"}">${isAdmin ? "You" : "Client"} · ${time}</div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Live poll — check for new client messages every 4s ────────
function startLivePoll(sessionId) {
  stopLivePoll();
  livePollTimer = setInterval(async () => {
    if (!activeSessionId || activeSessionId === "joy") return;
    try {
      const r = await fetch(
        `/api/live-chat?sessionId=${encodeURIComponent(activeSessionId)}`,
      );
      const data = await r.json();
      if (!data.messages) return;

      const known = new Set(
        (liveSessions[activeSessionId] || []).map((m) => String(m.id)),
      );
      const newMsgs = data.messages.filter((m) => !known.has(String(m.id)));

      if (newMsgs.length) {
        newMsgs.forEach((m) => {
          liveSessions[activeSessionId] = liveSessions[activeSessionId] || [];
          liveSessions[activeSessionId].push({ ...m, _read: true });
          renderAdminChatBubble(m);
        });
      }
    } catch (_) {}
  }, 4000);
}

function stopLivePoll() {
  if (livePollTimer) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
}

// Refresh sessions list every 15s to pick up new visitors
function startSessionsRefresh() {
  if (sessionsLoadTimer) clearInterval(sessionsLoadTimer);
  sessionsLoadTimer = setInterval(() => {
    if (adminChatMode === "live") loadLiveSessions();
  }, 15000);
}

// ── Send admin reply ──────────────────────────────────────────
async function sendAdminChat() {
  const input = document.getElementById("adminChatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  if (!activeSessionId || activeSessionId === "joy") {
    // ── AI Bot mode ────────────────────────────────────────
    aiConversation.push({ type: "user", text });
    appendMsg(text, "outgoing", "A");

    const formatted = aiConversation.map((m) => ({
      role: m.type === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    }));

    const typingEl = document.createElement("div");
    typingEl.id = "adminTyping";
    typingEl.className = "msg incoming";
    typingEl.innerHTML =
      '<div class="msg-bubble" style="opacity:.45;font-style:italic">Joy is typing…</div>';
    document.getElementById("adminChatMessages").appendChild(typingEl);

    try {
      const res = await fetch("/api/gemini-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: formatted }),
      });
      const data = await res.json().catch(() => ({ reply: "Error" }));
      typingEl.remove();
      const reply = data.reply || "Sorry, I could not respond.";
      aiConversation.push({ type: "bot", text: reply });
      appendMsg(reply, "incoming", "🤖");
    } catch (_) {
      typingEl.remove();
      appendMsg("Connection error.", "incoming", "⚠");
    }
    return;
  }

  // ── Live Chat reply ────────────────────────────────────────
  const msg = {
    sessionId: activeSessionId,
    sender: "admin",
    name: "Admin",
    text,
    timestamp: new Date().toISOString(),
  };

  // Optimistically render
  renderAdminChatBubble({ ...msg, id: Date.now() });

  try {
    await fetch("/api/live-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    // Store locally
    liveSessions[activeSessionId] = liveSessions[activeSessionId] || [];
    liveSessions[activeSessionId].push({ ...msg, id: Date.now(), _read: true });
  } catch (_) {
    appendMsg("⚠ Message failed to send.", "incoming", "⚠");
  }
}

// ── Generic message appender (for bot mode) ───────────────────
function appendMsg(text, dir, avatarChar) {
  const msgs = document.getElementById("adminChatMessages");
  const div = document.createElement("div");
  div.className = `msg ${dir}`;
  div.innerHTML = `
    <div class="msg-avatar-sm">${avatarChar || (dir === "outgoing" ? "A" : "?")}</div>
    <div class="msg-bubble">${esc(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Charts ────────────────────────────────────────────────────
let charts = {};

function renderOverviewCharts() {
  const months = [
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
  const now = new Date().getMonth();
  const labels = months.slice(Math.max(0, now - 5), now + 1);
  const bkData = [2, 5, 3, 8, 6, allBookings.length || 1];
  const revData = [
    45e3,
    90e3,
    60e3,
    160e3,
    120e3,
    allBookings.reduce((a, b) => a + Number(b.deposit_paid || 0), 0) || 45e3,
  ];

  _dc("bookingsChart");
  charts.bookings = new Chart(document.getElementById("bookingsChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: bkData,
          backgroundColor: "rgba(108,99,255,.5)",
          borderColor: "#6c63ff",
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: _chartOpts(),
  });

  const svcCounts = {};
  allBookings.forEach((b) => {
    const s = b.service_name || "Other";
    svcCounts[s] = (svcCounts[s] || 0) + 1;
  });
  const svcLabels = Object.keys(svcCounts).length
    ? Object.keys(svcCounts)
    : ["Wedding", "Portrait", "Commercial", "Event"];
  const svcData = Object.keys(svcCounts).length
    ? Object.values(svcCounts)
    : [4, 3, 2, 2];
  _dc("servicesChart");
  charts.services = new Chart(document.getElementById("servicesChart"), {
    type: "doughnut",
    data: {
      labels: svcLabels,
      datasets: [
        {
          data: svcData,
          backgroundColor: [
            "#6c63ff",
            "#22c55e",
            "#f59e0b",
            "#ef4444",
            "#a78bfa",
            "#34d399",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8892a4", font: { size: 11 }, padding: 12 },
        },
      },
    },
  });

  _dc("revenueChart");
  charts.revenue = new Chart(document.getElementById("revenueChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue (KSh)",
          data: revData,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,.08)",
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#22c55e",
          pointRadius: 3,
        },
      ],
    },
    options: _chartOpts({ yTick: (v) => `${(v / 1000).toFixed(0)}K` }),
  });
}

function renderAnalytics() {
  const sc = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
  allBookings.forEach((b) => {
    if (sc[b.status] !== undefined) sc[b.status]++;
  });
  _dc("statusChart");
  charts.status = new Chart(document.getElementById("statusChart"), {
    type: "pie",
    data: {
      labels: Object.keys(sc),
      datasets: [
        {
          data: Object.values(sc),
          backgroundColor: ["#f59e0b", "#22c55e", "#ef4444", "#6c63ff"],
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
  _dc("paymentChart");
  charts.payment = new Chart(document.getElementById("paymentChart"), {
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
  const dailyData = days.map((_, i) =>
    i === 29 ? 45e3 : i === 28 ? 30e3 : i === 25 ? 18e3 : 0,
  );
  _dc("dailyRevenueChart");
  charts.daily = new Chart(document.getElementById("dailyRevenueChart"), {
    type: "bar",
    data: {
      labels: days,
      datasets: [
        {
          label: "Revenue",
          data: dailyData,
          backgroundColor: "rgba(108,99,255,.4)",
          borderColor: "#6c63ff",
          borderWidth: 1.5,
          borderRadius: 2,
        },
      ],
    },
    options: _chartOpts({
      xLimit: 8,
      yTick: (v) => `${(v / 1000).toFixed(0)}K`,
    }),
  });
}

function _chartOpts(opts = {}) {
  return {
    plugins: { legend: { display: false } },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: "rgba(255,255,255,.04)" },
        ticks: opts.yTick ? { callback: opts.yTick } : {},
      },
      x: {
        grid: { display: false },
        ticks: opts.xLimit ? { maxTicksLimit: opts.xLimit } : {},
      },
    },
  };
}
function _dc(id) {
  const c = Chart.getChart(id);
  if (c) c.destroy();
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
document.querySelectorAll(".admin-modal-backdrop").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.target === el) el.classList.remove("open");
  });
});

// ── Alerts ────────────────────────────────────────────────────
function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `admin-alert ${type}`;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 5000);
}

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
