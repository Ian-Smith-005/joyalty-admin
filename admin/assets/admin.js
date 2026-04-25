/* ============================================================
   JOYALTY ADMIN — admin.js  (fixed)
   
   FIXES APPLIED:
   1. Removed React/JSX imports — plain JS only, no bundler
   2. doLogout() now redirects to /admin/login/ (correct path)
   3. initChat() uses waInit() from admin-wa.js (no React mount)
   4. sbClient initialised from window.SUPABASE_URL which is
      guaranteed set before this file loads (Promise.all guard
      in index.html) — removed the redundant null-check warning
============================================================ */

// ── Supabase browser client ───────────────────────────────────
const SB_URL = window.SUPABASE_URL || "";
const SB_ANON = window.SUPABASE_ANON || "";
let sbClient = null;
if (SB_URL && SB_ANON) {
  try {
    sbClient = supabase.createClient(SB_URL, SB_ANON);
    console.log("[admin] Supabase ready:", SB_URL);
  } catch (e) {
    console.error("[supabase]", e.message);
  }
} else {
  console.warn(
    "[admin] SUPABASE_URL or SUPABASE_ANON_KEY missing — check Cloudflare env vars and /api/config",
  );
}

// ── State ─────────────────────────────────────────────────────
const currentUser = window.__currentUser;
let allBookings = [];
let allClients = [];
let chatMode = "bot";
let aiConvo = [];
let activeSession = null;
let sentIds = new Set();
let rtChannel = null;
let presenceChannel = null;
let unread = 0;
let prefs = loadPrefs();
let editId = null;
let onlineUsers = {};
let deferredPrompt = null;

// ── PWA install prompt ────────────────────────────────────────
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.getElementById("pwaInstallBanner")) return;
  const banner = document.createElement("div");
  banner.id = "pwaInstallBanner";
  banner.style.cssText = `position:fixed;bottom:calc(var(--bn-h,60px) + 10px);left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#2a1d08,#3a2808);border:1px solid rgba(212,168,75,.3);border-radius:12px;padding:12px 20px;display:flex;align-items:center;gap:14px;z-index:1000;box-shadow:0 8px 28px rgba(0,0,0,.5);animation:toastIn .25s ease;max-width:340px;width:90%;`;
  banner.innerHTML = `
    <i class="fa-solid fa-mobile-screen-button" style="color:#d4a84b;font-size:1.2rem;flex-shrink:0"></i>
    <div style="flex:1;min-width:0">
      <div style="font-size:.83rem;font-weight:700;color:#f0ece4">Install Joyalty Admin</div>
      <div style="font-size:.72rem;color:rgba(240,236,228,.5)">Add to home screen for quick access</div>
    </div>
    <button onclick="installPWA()" style="background:linear-gradient(135deg,#b8860b,#d4a84b);color:#0a0810;border:none;border-radius:8px;padding:7px 14px;font-family:'Quicksand',sans-serif;font-weight:700;font-size:.78rem;cursor:pointer;flex-shrink:0">Install</button>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(240,236,228,.4);cursor:pointer;font-size:.9rem;padding:2px 4px;flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>`;
  document.body.appendChild(banner);
}

async function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  if (result.outcome === "accepted") toast("App installed! ✓", "success");
  deferredPrompt = null;
  document.getElementById("pwaInstallBanner")?.remove();
}

// ── Init ──────────────────────────────────────────────────────
function init() {
  const u = currentUser;
  if (!u) return;

  const initChar = (u.displayName || u.email || "A")[0].toUpperCase();
  setText("sbAvatar", initChar);
  setText("sbName", u.displayName || u.email.split("@")[0]);
  setText("avaPreview", initChar);
  setVal("profileEmail", u.email || "");
  setVal("profileName", ls("adminDisplayName") || u.displayName || "");
  setVal("profileStudio", ls("adminStudio") || "");
  setVal("profilePhone", ls("adminPhone") || "");
  const savedAva = ls("adminAva");
  if (savedAva) setAvaImg(savedAva);

  loadPrefsUI();
  subscribeRealtime();
  subscribePresence();
  initDash();
  switchTab(sessionStorage.getItem("adminTab") || "overview", true);
}
init();

// ── FIX: correct logout path ──────────────────────────────────
async function doLogout() {
  if (rtChannel && sbClient) sbClient.removeChannel(rtChannel);
  if (presenceChannel && sbClient) sbClient.removeChannel(presenceChannel);
  await window.joyaltyAuth.firebaseSignOut().catch(() => {});
  window.location.replace("/admin/login/");
}

// ═════════════════════════════════════════════════════════════
// REALTIME + PRESENCE
// ═════════════════════════════════════════════════════════════
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
          // Delegate to admin-wa.js renderer if available
          if (typeof waRenderBubble === "function") waRenderBubble(msg);
          else renderBubble(msg);
        } else {
          unread++;
          updateBadges();
          if (typeof waLoadSessions === "function") waLoadSessions();
          if (prefs.chatNotif !== false) {
            triggerNotification(
              `New message from ${msg.name || "a client"}`,
              msg.text,
              msg.session_id,
            );
            if (prefs.soundNotif !== false) playSound("receive");
          }
        }
      },
    )
    .subscribe();
}

function subscribePresence() {
  if (!sbClient) return;
  if (presenceChannel) sbClient.removeChannel(presenceChannel);
  presenceChannel = sbClient
    .channel("user-presence")
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineUsers = {};
      Object.keys(state).forEach((key) => {
        onlineUsers[key] = true;
      });
      updateOnlineIndicators();
    })
    .on("presence", { event: "join" }, ({ key }) => {
      onlineUsers[key] = true;
      updateOnlineIndicators();
    })
    .on("presence", { event: "leave" }, ({ key }) => {
      delete onlineUsers[key];
      updateOnlineIndicators();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({
          user: "admin",
          online_at: new Date().toISOString(),
        });
      }
    });
}

function updateOnlineIndicators() {
  if (activeSession && activeSession !== "joy") {
    const isOnline = !!onlineUsers[activeSession];
    const dot = document.getElementById("onlineDot");
    const status = document.getElementById("onlineStatus");
    if (dot) dot.style.display = isOnline ? "" : "none";
    if (status)
      status.textContent = isOnline
        ? "Online now"
        : `Live · ${activeSession.split("-")[0]}`;
    // Also update admin-wa.js header if active
    const waOnlineDot = document.getElementById("waOnlineDot");
    const waSubTxt = document.getElementById("waHdSubTxt");
    if (waOnlineDot) waOnlineDot.style.display = isOnline ? "" : "none";
    if (waSubTxt) waSubTxt.textContent = isOnline ? "Online" : "Live chat";
  }
  document
    .querySelectorAll(".contact-item[data-sid],.wa-session-item[data-sid]")
    .forEach((el) => {
      const sid = el.dataset.sid;
      const dot = el.querySelector(".c-online,.wa-sess-online");
      if (dot) dot.style.display = onlineUsers[sid] ? "block" : "none";
    });
}

// ═════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═════════════════════════════════════════════════════════════
async function triggerNotification(title, body, sessionId) {
  if (!prefs.pushEnabled) return;
  if (Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration("/admin/");
    if (reg) {
      reg.showNotification(title, {
        body,
        icon: "/admin/icons/icon-192.png",
        badge: "/admin/icons/icon-192.png",
        tag: sessionId || "joyalty-chat",
        renotify: true,
        data: { url: "/admin/", sessionId },
        actions: [{ action: "open", title: "Open Chat" }],
      });
      return;
    }
  }
  try {
    new Notification(title, { body, icon: "/admin/icons/icon-192.png" });
  } catch (_) {}
}

async function requestNotifPerm() {
  if (!("Notification" in window)) {
    toast("Notifications not supported.", "error");
    return;
  }
  const p = await Notification.requestPermission();
  if (p === "granted") {
    toast("Notifications enabled ✓", "success");
    g("notifDot").style.display = "";
    g("pushToggle").checked = true;
    savePref("pushEnabled", true);
    prefs.pushEnabled = true;
    setText("notifStatus", "Push notifications are enabled.");
  } else {
    toast("Permission denied.", "error");
    setText("notifStatus", "Please enable in browser settings.");
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

// ═════════════════════════════════════════════════════════════
// SOUND
// ═════════════════════════════════════════════════════════════
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "send") {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    }
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════
// TABS
// ═════════════════════════════════════════════════════════════
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
  const current = document.querySelector(".tab.active");
  const next = g("tab-" + tab);
  if (!next || next === current) return;

  if (current) {
    current.style.opacity = "0";
    current.style.transform = "translateY(6px)";
    setTimeout(() => current.classList.remove("active"), 160);
  }
  setTimeout(
    () => {
      next.classList.add("active");
      next.style.opacity = "0";
      next.style.transform = "translateY(6px)";
      requestAnimationFrame(() => {
        next.style.transition = "opacity .2s ease, transform .2s ease";
        next.style.opacity = "1";
        next.style.transform = "translateY(0)";
      });
    },
    current ? 160 : 0,
  );

  document
    .querySelectorAll(".nav-item[data-tab],.bn-item[data-tab]")
    .forEach((n) => n.classList.toggle("active", n.dataset.tab === tab));
  setText("tabTitle", TITLES[tab] || tab);
  if (!silent) sessionStorage.setItem("adminTab", tab);

  const pc = document.querySelector(".page-content");
  if (pc) pc.classList.toggle("chat-mode", tab === "chat");

  if (tab === "bookings") loadBookings();
  if (tab === "clients") loadClients();
  if (tab === "analytics") renderAnalytics();
  if (tab === "chat") {
    // FIX: call waInit() from admin-wa.js, not React
    if (typeof waInit === "function") waInit();
    resetUnread();
  }
}

document
  .querySelectorAll(".nav-item[data-tab],.bn-item[data-tab]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tab;
      if (t && t !== "more") switchTab(t);
    });
  });

// ═════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════
// BOOKINGS — CRUD
// ═════════════════════════════════════════════════════════════
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
    <tr class="booking-row" data-id="${b.id}">
      <td style="font-family:monospace;font-size:.76rem">${esc(b.booking_ref)}</td>
      <td><div style="font-weight:600">${esc(b.client_name || "—")}</div><div style="font-size:.72rem;color:var(--muted)">${esc(b.client_email || "")}</div></td>
      <td>${esc(b.service_name || "—")}</td>
      <td style="font-size:.8rem">${b.event_date ? new Date(b.event_date).toLocaleDateString("en-KE") : "—"}</td>
      <td style="font-weight:600">KSh ${Number(b.total_price || 0).toLocaleString()}</td>
      <td>${badge(b.status)}</td>
      <td style="white-space:nowrap">
        <button class="act-btn edit" onclick="openEditBooking(${b.id})"   title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="act-btn"      onclick="emailShortcut('${esc(b.client_email)}','${esc(b.booking_ref)}')" title="Email"><i class="fa-solid fa-envelope"></i></button>
        <button class="act-btn del"  onclick="openDeleteBooking(${b.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`,
    )
    .join("");

  document.querySelectorAll(".booking-row").forEach((row, i) => {
    row.style.opacity = "0";
    row.style.transform = "translateY(8px)";
    row.style.transition = `opacity .2s ease ${i * 30}ms, transform .2s ease ${i * 30}ms`;
    requestAnimationFrame(() => {
      row.style.opacity = "1";
      row.style.transform = "none";
    });
  });
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
  setVal("deleteId", String(id));
  const b = allBookings.find((x) => x.id === id);
  const modal = g("deleteModal");
  if (modal && b) {
    const p = modal.querySelector(".modal-body p");
    if (p)
      p.innerHTML = `Delete booking <strong style="color:var(--gold)">${esc(b.booking_ref)}</strong> for <strong>${esc(b.client_name || "")}</strong>?<br><span style="font-size:.8rem;opacity:.6">This cannot be undone.</span>`;
  }
  openModal("deleteModal");
}

async function confirmDelete() {
  const id = getVal("deleteId");
  if (!id) {
    toast("No booking selected.", "error");
    return;
  }
  const btn = g("confirmDeleteBtn");
  if (btn) btn.innerHTML = '<span class="spinner"></span>';
  try {
    const d = await api(`/api/admin/bookings/${id}`, { method: "DELETE" });
    closeModal("deleteModal");
    if (btn) btn.textContent = "Yes, Delete";
    if (d.success) {
      const row = document.querySelector(`.booking-row[data-id="${id}"]`);
      if (row) {
        row.style.transition = "opacity .25s ease, transform .25s ease";
        row.style.opacity = "0";
        row.style.transform = "translateX(-20px)";
        setTimeout(() => row.remove(), 260);
      }
      allBookings = allBookings.filter((b) => String(b.id) !== id);
      await loadStats();
      toast("Booking deleted.", "success");
    } else {
      toast(d.error || "Delete failed.", "error");
      console.error("[delete]", d.error);
    }
  } catch (e) {
    if (btn) btn.textContent = "Yes, Delete";
    closeModal("deleteModal");
    toast("Delete failed: " + e.message, "error");
  }
}

// ═════════════════════════════════════════════════════════════
// CLIENTS
// ═════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════
// EMAIL
// ═════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════
// CHAT — delegated entirely to admin-wa.js
// FIX: removed React/JSX imports. initChat() calls waInit().
// ═════════════════════════════════════════════════════════════
function initChat() {
  if (typeof waInit === "function") {
    waInit();
  } else {
    console.error("[admin] admin-wa.js not loaded — chat unavailable");
  }
}

// These stubs exist so old HTML onclick references don't break.
// admin-wa.js overrides them with full implementations.
function setChatMode(mode) {
  if (typeof waSetMode === "function") waSetMode(mode);
}
function renderBubble(msg) {
  if (typeof waRenderBubble === "function") waRenderBubble(msg);
}
function appendMsg(t, d, a) {
  /* noop — admin-wa.js handles all rendering */
}
function clearChat() {
  if (typeof waClearChat === "function") waClearChat();
}
function showChat() {
  if (typeof waShowMain === "function") waShowMain();
}
function showContacts() {
  if (typeof waShowSidebar === "function") waShowSidebar();
}
function sendAdminMsg() {
  if (typeof waSend === "function") waSend();
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

// ═════════════════════════════════════════════════════════════
// CHARTS — real data from allBookings
// ═════════════════════════════════════════════════════════════
let charts = {};

async function renderOverviewCharts() {
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
  const now = new Date().getMonth();
  const labels = mo.slice(Math.max(0, now - 5), now + 1);

  const bkCounts = labels.map((lbl) => {
    const mIdx = mo.indexOf(lbl);
    return allBookings.filter((b) => {
      const d = b.created_at ? new Date(b.created_at) : null;
      return d && d.getMonth() === mIdx;
    }).length;
  });
  const rvData = labels.map((lbl) => {
    const mIdx = mo.indexOf(lbl);
    return allBookings
      .filter((b) => {
        const d = b.created_at ? new Date(b.created_at) : null;
        return d && d.getMonth() === mIdx && b.status === "confirmed";
      })
      .reduce((sum, b) => sum + Number(b.deposit_paid || 0), 0);
  });

  dc("bookingsChart");
  charts.bk = new Chart(g("bookingsChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: bkCounts,
          backgroundColor: "rgba(212,168,75,.32)",
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
  const sd = Object.keys(sc).length ? Object.values(sc) : [0, 0, 0, 0];

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
          data: rvData,
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

async function renderAnalytics() {
  const sc = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
  allBookings.forEach((b) => {
    if (sc[b.status] !== undefined) sc[b.status]++;
  });

  dc("statusChart");
  charts.st = new Chart(g("statusChart"), {
    type: "pie",
    data: {
      labels: ["Pending", "Confirmed", "Cancelled", "Completed"],
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

  const svcMap = {};
  allBookings.forEach((b) => {
    const s = b.service_name || "Other";
    svcMap[s] = (svcMap[s] || 0) + 1;
  });
  dc("paymentChart");
  charts.pm = new Chart(g("paymentChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(svcMap).length ? Object.keys(svcMap) : ["No data"],
      datasets: [
        {
          data: Object.keys(svcMap).length ? Object.values(svcMap) : [1],
          backgroundColor: [
            "#d4a84b",
            "#7c6ef0",
            "#22c55e",
            "#ef4444",
            "#f59e0b",
          ],
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
  const labels = mo.slice(Math.max(0, new Date().getMonth() - 11));
  const rvMonthly = labels.map((lbl) => {
    const mIdx = mo.indexOf(lbl);
    return allBookings
      .filter((b) => {
        const d = b.created_at ? new Date(b.created_at) : null;
        return d && d.getMonth() === mIdx && b.status === "confirmed";
      })
      .reduce((sum, b) => sum + Number(b.deposit_paid || 0), 0);
  });
  dc("dailyChart");
  charts.dr = new Chart(g("dailyChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: rvMonthly,
          backgroundColor: "rgba(212,168,75,.32)",
          borderColor: "#d4a84b",
          borderWidth: 1.5,
          borderRadius: 3,
        },
      ],
    },
    options: cOpts({ yTick: (v) => `${(v / 1000).toFixed(0)}K` }),
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

// ═════════════════════════════════════════════════════════════
// PROFILE
// ═════════════════════════════════════════════════════════════
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
    showAlert("pwAlert", "Min 8 chars.", "error");
    return;
  }
  if (np !== cp) {
    showAlert("pwAlert", "Passwords don't match.", "error");
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
  if (sn) sn.checked = prefs.soundNotif !== false;
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

// ═════════════════════════════════════════════════════════════
// MOBILE NAV
// ═════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════
// MODALS / ALERTS / TOASTS
// ═════════════════════════════════════════════════════════════
function openModal(id) {
  const el = g(id);
  if (el) {
    el.classList.add("open");
    el.style.animation = "none";
    requestAnimationFrame(() => {
      el.style.animation = "";
    });
  }
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

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════
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
