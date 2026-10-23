// =====================================================================
// LUNA FEM FINANCE v2 - LECTURA EN TIEMPO REAL DESDE FIRESTORE
// =====================================================================

const ALLOWED_USERS = {
  ADMIN: "agustind301@gmail.com",
  CASHIER: "lunafembrasil@gmail.com"
};

let currentUser = null;
let cart = [];
let products = []; // Se llenará desde Firestore
let allSales = []; // Aquí caerán tus 616+ ventas

document.addEventListener('DOMContentLoaded', () => {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(handleAuthStateChanged);
  }
  setupEvents();
});

function setupEvents() {
  const billInputs = document.querySelectorAll('.bill-item input');
  const rentFundInput = document.querySelector('.fund-section input');
  billInputs.forEach(input => input.addEventListener('input', calculatePhysicalCash));
  if (rentFundInput) rentFundInput.addEventListener('input', calculatePhysicalCash);
}

// ---------------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------------
async function login() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const feedback = document.getElementById('loginFeedback');
  const loginBtn = document.getElementById('loginBtn');

  const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
  const password = passwordInput ? passwordInput.value : "";

  if (!email || !password) {
    if (feedback) feedback.textContent = "Ingresa tu correo y contraseña.";
    return;
  }

  if (email !== ALLOWED_USERS.ADMIN.toLowerCase() && email !== ALLOWED_USERS.CASHIER.toLowerCase()) {
    if (feedback) feedback.textContent = "Este correo no tiene permisos para acceder.";
    return;
  }

  try {
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "Verificando..."; }
    if (feedback) feedback.textContent = "";
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error("Error en inicio de sesión:", error);
    if (feedback) feedback.textContent = "Correo o contraseña incorrectos.";
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "Entrar al Sistema"; }
  }
}

function handleAuthStateChanged(user) {
  const viewLogin = document.getElementById('view-login');
  const viewCashier = document.getElementById('view-cashier');
  const viewAdmin = document.getElementById('view-admin');
  const userProfileBadge = document.getElementById('userProfileBadge');
  const userBadgeText = document.getElementById('userBadgeText');
  const logoutBtn = document.getElementById('logoutBtn');

  [viewLogin, viewCashier, viewAdmin].forEach(s => s?.classList.remove('active'));

  if (user) {
    const userEmail = user.email.toLowerCase();
    currentUser = user;

    if (logoutBtn) logoutBtn.style.display = 'block';
    if (userProfileBadge) userProfileBadge.style.display = 'flex';

    if (userEmail === ALLOWED_USERS.ADMIN.toLowerCase()) {
      if (viewAdmin) viewAdmin.classList.add('active');
      if (userBadgeText) userBadgeText.textContent = "Admin";
    } 
    else if (userEmail === ALLOWED_USERS.CASHIER.toLowerCase()) {
      if (viewCashier) viewCashier.classList.add('active');
      if (userBadgeText) userBadgeText.textContent = "Cajero";
    } 
    else {
      logout();
      return;
    }
    
    // Iniciar conexión con Firestore una vez autenticado
    startFirestoreLiveListeners();

  } else {
    currentUser = null;
    if (viewLogin) viewLogin.classList.add('active');
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userProfileBadge) userProfileBadge.style.display = 'none';
  }
}

async function logout() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    await firebase.auth().signOut();
  }
}

// ---------------------------------------------------------------------
// CONEXIÓN A FIRESTORE (Lectura de las 616+ ventas y productos)
// ---------------------------------------------------------------------
function startFirestoreLiveListeners() {
  const db = firebase.firestore();

  // 1. Escuchar Catálogo de Productos
  db.collection("products").onSnapshot(snapshot => {
    products = [];
    snapshot.forEach(doc => products.push(doc.data()));
    renderProducts();
  }, err => console.error("Error cargando productos:", err));

  // 2. Escuchar Historial de Ventas
  db.collection("sales").onSnapshot(snapshot => {
    allSales = [];
    let canceladas = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      allSales.push(data);
      if (data.status === 'cancelled' || data.cancelled === true) canceladas++;
    });

    const totalSalesBadge = document.getElementById('totalSalesCount');
    if (totalSalesBadge) totalSalesBadge.textContent = allSales.length;

    const kpiCanceladas = document.getElementById('kpi-canceladas');
    if (kpiCanceladas) kpiCanceladas.textContent = canceladas;

    updateAdminDashboard(allSales);
  }, err => console.error("Error cargando ventas:", err));
}

function updateAdminDashboard(salesData) {
  // Filtrar ventas de HOY
  const todayISO = new Date().toISOString().split('T')[0];
  const todaySales = salesData.filter(s => 
    (s.dateISO === todayISO || (s.date && s.date.includes(todayISO))) && 
    (s.status !== 'cancelled' && s.cancelled !== true)
  );

  const totalToday = todaySales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  
  const kpiHoy = document.getElementById('kpi-ventas-hoy');
  if (kpiHoy) kpiHoy.textContent = `R$ ${totalToday.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
}

// ---------------------------------------------------------------------
// LÓGICA DE CAJA Y PUNTO DE VENTA (POS)
// ---------------------------------------------------------------------
function calculatePhysicalCash() {
  const billInputs = document.querySelectorAll('.bill-item input');
  const rentFundInput = document.querySelector('.fund-section input');
  const multipliers = [200, 100, 50, 20, 10, 5, 2, 1];
  let totalCash = 0;

  billInputs.forEach((input, index) => {
    totalCash += (Number(input.value) || 0) * multipliers[index];
  });
  return totalCash;
}

function renderProducts() {
  const grid = document.getElementById('posProductGrid');
  if (!grid) return;
  
  if (products.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1;">Cargando productos de Firestore...</p>`;
    return;
  }

  grid.innerHTML = products.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}')">
      <h4 style="font-size: 0.95rem;">${escapeHTML(p.name)}</h4>
      <p style="color: var(--gold); font-weight: 700;">R$ ${Number(p.price || 0).toFixed(2)}</p>
      <small style="color: var(--text-muted);">${p.stock > 0 ? 'Stock: ' + p.stock : 'Sin stock'}</small>
    </div>
  `).join('');
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) { existingItem.qty += 1; } 
  else { cart.push({ ...product, qty: 1 }); }
  renderCart();
}

function renderCart() {
  const cartContainer = document.querySelector('.cart-items');
  const totalsArea = document.querySelector('.totals-area');
  if (!cartContainer || !totalsArea) return;

  cartContainer.innerHTML = cart.length ? cart.map(item => `
    <div class="cart-item-row">
      <div class="cart-item-info">
        <div class="cart-item-title">${escapeHTML(item.name)}</div>
        <div class="cart-item-qty">${item.qty} un. x R$ ${Number(item.price).toFixed(2)}</div>
      </div>
      <div class="cart-item-price">R$ ${(item.qty * item.price).toFixed(2)}</div>
    </div>
  `).join('') : '<p style="color: var(--text-muted); text-align: center; font-size: 0.9rem;">Ningún producto seleccionado</p>';

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  totalsArea.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2)}</span></div>
    <div class="total-row grand-total"><span>Total a Cobrar</span><span>R$ ${subtotal.toFixed(2)}</span></div>
  `;
}

function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
