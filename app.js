// =====================================================================
// LUNA FEM FINANCE v2 - MOTOR PRINCIPAL Y BÚSQUEDA EN TIEMPO REAL
// =====================================================================

const ALLOWED_USERS = {
  ADMIN: "agustind301@gmail.com",
  CASHIER: "lunafembrasil@gmail.com"
};

let currentUser = null;
let cart = []; // Carrito del Cajero
let manualCart = []; // Carrito de Venta Manual
let products = []; // Catálogo maestro
let filteredProducts = []; // Para búsqueda de cajero
let manualFilteredProducts = []; // Para búsqueda manual
let allSales = []; 

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
// CONEXIÓN A FIRESTORE
// ---------------------------------------------------------------------
function startFirestoreLiveListeners() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const db = firebase.firestore();

  // Escuchar Catálogo
  db.collection("products").onSnapshot(snapshot => {
    products = [];
    snapshot.forEach(doc => {
      const p = doc.data();
      if (!p.id) p.id = doc.id;
      products.push(p);
    });
    
    // Inicializar listas de búsqueda con todos los productos
    filteredProducts = [...products]; 
    manualFilteredProducts = [...products];
    
    renderProducts();
    renderManualProducts();
  }, err => console.warn("Aviso en Productos:", err));

  // Escuchar Ventas
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
    
    // Si estamos en la pestaña de historial, actualizamos la tabla
    const historicalView = document.getElementById('admin-historical-sales-view');
    if (historicalView && historicalView.style.display === 'block') {
        renderHistoricalSales();
    }
  }, err => console.warn("Aviso en Ventas:", err));
}

function updateAdminDashboard(salesData) {
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
// BÚSQUEDA Y FILTRADO EN TIEMPO REAL
// ---------------------------------------------------------------------
function filterProducts(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    filteredProducts = [...products];
  } else {
    filteredProducts = products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.categoria && p.categoria.toLowerCase().includes(q)) || 
      (p.barcode && String(p.barcode).includes(q))
    );
  }
  renderProducts();
}

function filterManualProducts(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    manualFilteredProducts = [...products];
  } else {
    manualFilteredProducts = products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.categoria && p.categoria.toLowerCase().includes(q)) || 
      (p.barcode && String(p.barcode).includes(q))
    );
  }
  renderManualProducts();
}

// ---------------------------------------------------------------------
// POS (CAJERO) - RENDERIZADO Y CARRITO
// ---------------------------------------------------------------------
function renderProducts() {
  const grid = document.getElementById('posProductGrid');
  if (!grid) return;
  
  if (filteredProducts.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1;">No se encontraron productos.</p>`;
    return;
  }

  grid.innerHTML = filteredProducts.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}', false)">
      <h4 style="font-size: 0.95rem;">${escapeHTML(p.name)}</h4>
      <p style="color: var(--gold); font-weight: 700;">R$ ${Number(p.price || 0).toFixed(2)}</p>
    </div>
  `).join('');
}

function addToCart(productId, isManual) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const targetCart = isManual ? manualCart : cart;
  const existingItem = targetCart.find(item => item.id === productId);
  
  if (existingItem) { existingItem.qty += 1; } 
  else { targetCart.push({ ...product, qty: 1, discount: 0 }); }
  
  if (isManual) renderManualCart();
  else renderCart();
}

function removeFromCart(productId, isManual) {
  if (isManual) {
    manualCart = manualCart.filter(item => item.id !== productId);
    renderManualCart();
  } else {
    cart = cart.filter(item => item.id !== productId);
    renderCart();
  }
}

function updateItemDiscount(productId, discountValue, isManual) {
  const targetCart = isManual ? manualCart : cart;
  const item = targetCart.find(i => i.id === productId);
  if (item) {
    item.discount = Number(discountValue) || 0;
    if (isManual) renderManualCart();
    else renderCart();
  }
}

function renderCart() {
  const cartContainer = document.querySelector('.cart-items');
  const totalsArea = document.querySelector('.totals-area');
  if (!cartContainer || !totalsArea) return;

  cartContainer.innerHTML = cart.length ? cart.map(item => {
    const itemTotal = (item.price * item.qty) - (item.discount || 0);
    return `
    <div class="cart-item-row" style="align-items: flex-start; margin-bottom: 15px;">
      <div class="cart-item-info" style="flex: 1;">
        <div class="cart-item-title">${escapeHTML(item.name)}</div>
        <div class="cart-item-qty" style="display: flex; gap: 10px; align-items: center; margin-top: 5px;">
          <span>${item.qty} un. x R$ ${Number(item.price).toFixed(2)}</span>
          <span style="font-size: 0.8rem; color: var(--pink-dark);">Desc R$ <input type="number" value="${item.discount || 0}" style="width: 50px; padding: 2px; border: 1px solid var(--border); border-radius: 4px;" onchange="updateItemDiscount('${item.id}', this.value, false)"></span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
        <button class="remove-btn" onclick="removeFromCart('${item.id}', false)">✖</button>
        <div class="cart-item-price">R$ ${itemTotal.toFixed(2)}</div>
      </div>
    </div>
  `}).join('') : '<p style="color: var(--text-muted); text-align: center; font-size: 0.9rem;">Ningún producto seleccionado</p>';

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalDescuentos = cart.reduce((sum, item) => sum + (item.discount || 0), 0);
  const total = subtotal - totalDescuentos;

  totalsArea.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2)}</span></div>
    <div class="total-row"><span>Descuentos (Items)</span><span style="color: var(--pink-dark);">- R$ ${totalDescuentos.toFixed(2)}</span></div>
    <div class="total-row grand-total"><span>Total a Cobrar</span><span>R$ ${total.toFixed(2)}</span></div>
  `;
}

// ---------------------------------------------------------------------
// VENTA MANUAL (ADMIN)
// ---------------------------------------------------------------------
function renderManualProducts() {
  const grid = document.getElementById('manualProductGrid');
  if (!grid) return;
  
  if (manualFilteredProducts.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1;">No se encontraron productos.</p>`;
    return;
  }

  grid.innerHTML = manualFilteredProducts.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}', true)">
      <h4 style="font-size: 0.95rem;">${escapeHTML(p.name)}</h4>
      <p style="color: var(--gold); font-weight: 700;">R$ ${Number(p.price || 0).toFixed(2)}</p>
    </div>
  `).join('');
}

function renderManualCart() {
  const cartContainer = document.getElementById('manualCartItems');
  const totalsArea = document.getElementById('manualTotalsArea');
  if (!cartContainer || !totalsArea) return;

  cartContainer.innerHTML = manualCart.length ? manualCart.map(item => {
    const itemTotal = (item.price * item.qty) - (item.discount || 0);
    return `
    <div class="cart-item-row" style="align-items: flex-start; margin-bottom: 15px;">
      <div class="cart-item-info" style="flex: 1;">
        <div class="cart-item-title">${escapeHTML(item.name)}</div>
        <div class="cart-item-qty" style="display: flex; gap: 10px; align-items: center; margin-top: 5px;">
          <span>${item.qty} un. x R$ ${Number(item.price).toFixed(2)}</span>
          <span style="font-size: 0.8rem; color: var(--pink-dark);">Desc R$ <input type="number" value="${item.discount || 0}" style="width: 50px; padding: 2px; border: 1px solid var(--border); border-radius: 4px;" onchange="updateItemDiscount('${item.id}', this.value, true)"></span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
        <button class="remove-btn" onclick="removeFromCart('${item.id}', true)">✖</button>
        <div class="cart-item-price">R$ ${itemTotal.toFixed(2)}</div>
      </div>
    </div>
  `}).join('') : '<p style="color: var(--text-muted); text-align: center; font-size: 0.9rem;">Ningún producto seleccionado</p>';

  const subtotal = manualCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalDescuentos = manualCart.reduce((sum, item) => sum + (item.discount || 0), 0);
  const total = subtotal - totalDescuentos;

  totalsArea.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2)}</span></div>
    <div class="total-row"><span>Descuentos</span><span style="color: var(--pink-dark);">- R$ ${totalDescuentos.toFixed(2)}</span></div>
    <div class="total-row grand-total" style="font-size: 1.2rem;"><span>Total Venta Manual</span><span>R$ ${total.toFixed(2)}</span></div>
  `;
}

function calculatePhysicalCash() {
  const billInputs = document.querySelectorAll('.bill-item input');
  let totalCash = 0;
  const multipliers = [200, 100, 50, 20, 10, 5, 2, 1];
  billInputs.forEach((input, index) => {
    totalCash += (Number(input.value) || 0) * multipliers[index];
  });
  return totalCash;
}

// ---------------------------------------------------------------------
// HISTORIAL DE VENTAS (ADMIN)
// ---------------------------------------------------------------------
function renderHistoricalSales() {
    const tbody = document.getElementById('historicalSalesTableBody');
    if (!tbody) return;

    if (allSales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No hay ventas registradas.</td></tr>';
        return;
    }

    // Ordenar de más reciente a más antigua
    const sortedSales = [...allSales].sort((a, b) => {
        const dateA = a.dateISO || a.createdAt || "";
        const dateB = b.dateISO || b.createdAt || "";
        return dateB.localeCompare(dateA);
    });

    // Mostrar las últimas 100 ventas (o las que quieras)
    const displaySales = sortedSales.slice(0, 100);

    tbody.innerHTML = displaySales.map(sale => {
        const isCancelled = sale.status === 'cancelled' || sale.cancelled === true;
        const statusClass = isCancelled ? 'status-cancelled' : 'status-completed';
        const statusText = isCancelled ? 'Cancelada' : 'Completada';
        
        // Formatear la fecha
        let displayDate = "Sin fecha";
        if (sale.dateISO) {
             displayDate = new Date(sale.dateISO).toLocaleDateString('es-UY');
        } else if (sale.createdAt) {
             displayDate = new Date(sale.createdAt).toLocaleDateString('es-UY');
        } else if (sale.date) {
            displayDate = sale.date; // Fallback a la fecha en texto
        }

        return `
        <tr>
            <td>${displayDate}</td>
            <td>${escapeHTML(sale.id || 'N/A')}</td>
            <td style="font-weight: 600;">R$ ${Number(sale.total || 0).toFixed(2)}</td>
            <td>${escapeHTML(sale.method || 'N/A')}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        </tr>
        `;
    }).join('');
}

function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
