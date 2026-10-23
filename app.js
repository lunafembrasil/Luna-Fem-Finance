// =====================================================================
// LUNA FEM FINANCE v2 - AUTENTICACIÓN Y ROLES ESTRICTOS
// =====================================================================

// Defina los dos únicos correos autorizados para acceder
const ALLOWED_USERS = {
  ADMIN: "agustind301@gmail.com",   // Reemplazar por tu correo real de administrador
  CASHIER: "lunafembrasil@gmail.com"   // Reemplazar por tu correo real de cajero
};

let currentUser = null;

// Escuchar estado de autenticación en Firebase
document.addEventListener('DOMContentLoaded', () => {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(handleAuthStateChanged);
  }
});

async function login() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const feedback = document.getElementById('loginFeedback');
  const loginBtn = document.getElementById('loginBtn');

  const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
  const password = passwordInput ? passwordInput.value : "";

  if (!email || !password) {
    feedback.textContent = "Ingresa tu correo y contraseña.";
    return;
  }

  // Filtrado previo antes de intentar autenticar
  if (email !== ALLOWED_USERS.ADMIN.toLowerCase() && email !== ALLOWED_USERS.CASHIER.toLowerCase()) {
    feedback.textContent = "Este correo no está autorizado para ingresar.";
    return;
  }

  try {
    loginBtn.disabled = true;
    loginBtn.textContent = "Verificando...";
    feedback.textContent = "";

    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error("Error en autenticación:", error);
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
      feedback.textContent = "Correo o contraseña incorrectos.";
    } else {
      feedback.textContent = "Error de conexión con Firebase.";
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar al Sistema";
  }
}

function handleAuthStateChanged(user) {
  const viewLogin = document.getElementById('view-login');
  const viewCashier = document.getElementById('view-cashier');
  const viewAdmin = document.getElementById('view-admin');
  const userBadge = document.getElementById('userBadge');
  const logoutBtn = document.getElementById('logoutBtn');

  // Ocultar todas las pantallas por defecto
  [viewLogin, viewCashier, viewAdmin].forEach(s => s?.classList.remove('active'));

  if (user) {
    const userEmail = user.email.toLowerCase();
    currentUser = user;

    if (logoutBtn) logoutBtn.style.display = 'block';

    // RUTA 1: ES ADMINISTRADOR
    if (userEmail === ALLOWED_USERS.ADMIN.toLowerCase()) {
      viewAdmin.classList.add('active');
      if (userBadge) userBadge.textContent = "Perfil: Administrador (" + user.email + ")";
    } 
    // RUTA 2: ES CAJERO
    else if (userEmail === ALLOWED_USERS.CASHIER.toLowerCase()) {
      viewCashier.classList.add('active');
      if (userBadge) userBadge.textContent = "Perfil: Cajero (" + user.email + ")";
    } 
    // RUTA 3: USUARIO NO AUTORIZADO
    else {
      alert("Acceso denegado: Tu usuario no pertenece a la lista de accesos de LunaFem Finance.");
      logout();
      return;
    }

    renderProducts();
    renderCart();

  } else {
    // SIN SESIÓN -> PANTALLA DE LOGIN
    currentUser = null;
    viewLogin.classList.add('active');
    if (userBadge) userBadge.textContent = "Sin Sesión";
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

async function logout() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    await firebase.auth().signOut();
  }
}
