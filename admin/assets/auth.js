/* ============================================================
   Firebase Admin Auth (Full)
============================================================ */

// ── Firebase config ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA23Ne4ZmJGpGkeEOu3r6ePPx2vLwXKLl0",
  authDomain: "joyalty-admin.firebaseapp.com",
  projectId: "joyalty-admin",
  storageBucket: "joyalty-admin.firebasestorage.app",
  messagingSenderId: "839017798819",
  appId: "1:839017798819:web:66cdb6298ee614a20f3316",
};

// ── Allowed admins ───────────────────────────────────────────
const ALLOWED_ADMINS = ["smithiian34@gmail.com"];

// ── Firebase init ────────────────────────────────────────────
let firebaseApp = null;
let firebaseAuth = null;

function initFirebase() {
  if (firebaseApp) return;

  try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    console.log("[auth] Firebase initialised");
  } catch (err) {
    console.error("[auth] Init failed:", err.message);
  }
}

// ── Redirect ─────────────────────────────────────────────────
function redirectToLogin() {
  window.location.href = "/admin/login/index.html";
}

// ── Sign in ──────────────────────────────────────────────────
async function firebaseSignIn(email, password) {
  initFirebase();

  if (!firebaseAuth) throw new Error("Firebase not initialised");

  const credential = await firebaseAuth.signInWithEmailAndPassword(
    email,
    password,
  );
  const user = credential.user;

  if (!ALLOWED_ADMINS.includes(user.email)) {
    await firebaseAuth.signOut();
    throw new Error("Access denied — not an admin");
  }

  return user;
}

// ── Sign out ─────────────────────────────────────────────────
async function firebaseSignOut() {
  initFirebase();

  if (firebaseAuth) {
    await firebaseAuth.signOut();
  }

  redirectToLogin();
}

// ── Auth state guard ─────────────────────────────────────────
function checkAuthState(onLoggedIn) {
  initFirebase();

  if (!firebaseAuth) {
    redirectToLogin();
    return;
  }

  firebaseAuth.onAuthStateChanged((user) => {
    if (user && ALLOWED_ADMINS.includes(user.email)) {
      onLoggedIn(user);
    } else {
      redirectToLogin();
    }
  });
}

// ── Export ───────────────────────────────────────────────────
window.joyaltyAuth = {
  firebaseSignIn,
  firebaseSignOut,
  checkAuthState,
};
