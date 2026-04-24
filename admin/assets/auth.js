/* ============================================================
  Real time Firebase login
============================================================ */

// ── Firebase config — replace with your real values ──────────
const firebaseConfig = {
  apiKey: "AIzaSyA23Ne4ZmJGpGkeEOu3r6ePPx2vLwXKLl0",
  authDomain: "joyalty-admin.firebaseapp.com",
  projectId: "joyalty-admin",
  storageBucket: "joyalty-admin.firebasestorage.app",
  messagingSenderId: "839017798819",
  appId: "1:839017798819:web:66cdb6298ee614a20f3316",
};

// ── Allowed admin emails — only these can access the dashboard
// Add/remove emails here to control access
const ALLOWED_ADMINS = [
  "smithiian34@gmail.com", //test email
  // "secondadmin@example.com",
];

/// Initialise only once
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();

// Persist session across page loads
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

window.joyaltyAuth = {
  firebaseSignIn: (email, password) =>
    auth.signInWithEmailAndPassword(email, password).then((cred) => cred.user),

  firebaseSignOut: () => auth.signOut(),

  checkAuthState: (onLoggedIn, onLoggedOut) => {
    auth.onAuthStateChanged((user) => {
      if (user) {
        onLoggedIn(user);
      } else {
        onLoggedOut();
      }
    });
  },

  getCurrentUser: () => auth.currentUser,
};
