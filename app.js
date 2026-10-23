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
// =====================================================================
// LECTURA DIRECTA Y EN TIEMPO REAL DESDE FIRESTORE
// =====================================================================

function startFirestoreLiveListeners() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const dbInst = firebase.firestore();

  // 1. Escuchar Catálogo de Productos
  dbInst.collection("products").onSnapshot(snapshot => {
    const loadedProducts = [];
    snapshot.forEach(doc => loadedProducts.push(doc.data()));
    
    if (loadedProducts.length > 0) {
      products = loadedProducts; // Reemplaza la memoria temporal con la verdad de Firestore
      renderProducts();
    }
  }, err => console.warn("Error leyendo productos de Firestore:", err));

  // 2. Escuchar Historial Completo de Ventas
  dbInst.collection("sales").onSnapshot(snapshot => {
    const loadedSales = [];
    snapshot.forEach(doc => loadedSales.push(doc.data()));
    
    // Ordenar de la más reciente a la más antigua
    loadedSales.sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
    
    updateDashboardMetrics(loadedSales);
  }, err => console.warn("Error leyendo ventas de Firestore:", err));
}

// Actualizar métricas del Administrador con las ventas leídas de Firestore
function updateDashboardMetrics(salesList) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const todaySales = salesList.filter(s => s.dateISO === todayISO && !s.cancelled);
  const todayTotal = todaySales.reduce((sum, s) => sum + Number(s.total || 0), 0);

  const todayKpiEl = document.querySelector('#view-admin .dashboard-grid .kpi-card .value');
  if (todayKpiEl) {
    todayKpiEl.textContent = "R$ " + todayTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }
}

// Llamar los listeners cuando el usuario autenticado entra
const originalHandleAuthStateChanged = handleAuthStateChanged;
handleAuthStateChanged = function(user) {
  originalHandleAuthStateChanged(user);
  if (user) {
    startFirestoreLiveListeners();
  }
};
