// If already logged in, go straight to dashboard
window.joyaltyAuth.checkAuthState(
  () => {
    window.location.replace("/admin/");
  },
  () => {
    /* not logged in — show form */
  },
);

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const errBox = document.getElementById("errorBox");
  const btn = document.getElementById("btnText");
  errBox.style.display = "none";

  if (!email || !pass) {
    errBox.textContent = "Enter your email and password.";
    errBox.style.display = "block";
    return;
  }
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    await window.joyaltyAuth.firebaseSignIn(email, pass);
    window.location.replace("/admin/");
  } catch (e) {
    btn.textContent = "Sign In";
    errBox.textContent =
      e.code === "auth/wrong-password" || e.code === "auth/user-not-found"
        ? "Incorrect email or password."
        : e.message || "Login failed.";
    errBox.style.display = "block";
  }
}

function togglePw() {
  const inp = document.getElementById("loginPass");
  const ico = document.getElementById("pwIcon");
  inp.type = inp.type === "password" ? "text" : "password";
  ico.className =
    inp.type === "text" ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
}

document.getElementById("loginPass").addEventListener("keypress", (e) => {
  if (e.key === "Enter") doLogin();
});
