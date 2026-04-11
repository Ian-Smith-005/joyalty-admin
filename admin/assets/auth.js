/* ============================================================
   JOYALTY ADMIN — auth.js
   Firebase Authentication for admin login.

   Setup:
   1. Go to console.firebase.google.com
   2. Create project "joyalty-admin" (or use existing)
   3. Enable Authentication → Email/Password
   4. Add your admin email as a user
   5. Go to Project Settings → Your Apps → Web App
   6. Copy the firebaseConfig values below
   7. Replace the placeholder values with your real config
============================================================ */

// ── Firebase config — replace with your real values ──────────
const firebaseConfig = {
  apiKey:            "AIzaSyA23Ne4ZmJGpGkeEOu3r6ePPx2vLwXKLl0",
  authDomain:        "joyalty-admin.firebaseapp.com",
  projectId:         "joyalty-admin",
  storageBucket:     "joyalty-admin.firebasestorage.app",
  messagingSenderId: "839017798819",
  appId:             "1:839017798819:web:66cdb6298ee614a20f3316",
};

// ── Allowed admin emails — only these can access the dashboard
// Add/remove emails here to control access
const ALLOWED_ADMINS = [
  "smithiian34@gmail.com",//test email 
  // "secondadmin@example.com",
];

// ── Firebase SDK (loaded via CDN in admin/index.html) ─────────
// Make sure these script tags are in admin/index.html <head>:
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
//   <script src="auth.js"></script>

let firebaseApp  = null;
let firebaseAuth = null;

function initFirebase() {
  if (firebaseApp) return;
  try {
    firebaseApp  = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    console.log("[auth] Firebase initialised");
  } catch (err) {
    console.error("[auth] Firebase init failed:", err.message);
  }
}

// ── Sign in ───────────────────────────────────────────────────
async function firebaseSignIn(email, password) {
  initFirebase();
  if (!firebaseAuth) throw new Error("Firebase not initialised");

  const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
  const user       = credential.user;

  if (!ALLOWED_ADMINS.includes(user.email)) {
    await firebaseAuth.signOut();
    throw new Error("Access denied — this email is not an admin.");
  }

  return user;
}

// ── Sign out ──────────────────────────────────────────────────
async function firebaseSignOut() {
  if (firebaseAuth) await firebaseAuth.signOut();
}

// ── Check existing session on page load ──────────────────────
function checkAuthState(onLoggedIn, onLoggedOut) {
  initFirebase();
  if (!firebaseAuth) { onLoggedOut(); return; }

  firebaseAuth.onAuthStateChanged(user => {
    if (user && ALLOWED_ADMINS.includes(user.email)) {
      onLoggedIn(user);
    } else {
      onLoggedOut();
    }
  });
}

// ── Export for use in admin/index.html ────────────────────────
window.joyaltyAuth = { firebaseSignIn, firebaseSignOut, checkAuthState };