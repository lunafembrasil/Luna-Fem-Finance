// =====================================================================
// LUNA FEM FINANCE v2 - MOTOR PRINCIPAL
// =====================================================================

// 1. ESTADO GLOBAL (Memoria temporal de la sesión)
let cart = [];
let products = [
  // Productos de prueba iniciales (luego vendrán de Firestore)
  { id: 'p1', name: 'Batom Matte', price: 19.90, stock: 15, type: 'produto' },
  { id: 'p2', name: 'Paleta Sombras', price: 45.00, stock: 8, type: 'produto' },
  { id: 'p3', name: 'Brinco Argola', price: 12.50, stock: 22, type: 'produto' },
  { id: 'p4', name: 'Serviço Impressão', price: 2.00, stock: 0, type: 'servico' }
];

// 2. LÓGICA DE ARQUEO FÍSICO (Billetes y Alquiler)
const billInputs = document.querySelectorAll('.bill-item input');
const rentFundInput = document.querySelector('.fund-section input');

function calculatePhysicalCash() {
  const multipliers = [200, 100, 50, 20, 10, 5, 2, 1]; // El último "1" es para las monedas (valor exacto)
  let totalCash = 0;

  billInputs.forEach((input, index) => {
    const qty = Number(input.value) || 0;
    totalCash += qty * multipliers[index];
  });

  const rentFund = Number(rentFundInput?.value) || 0;
  const netCash = totalCash - rentFund; // Dinero real disponible restando lo apartado para Dios/Alquiler

  // Aquí actualizaremos el panel de resumen (lo conectaremos al HTML en el próximo paso)
  console.log(`Total Billetes: R$ ${totalCash.toFixed(2)} | Fondo Alquiler: R$ ${rentFund.toFixed(2)} | Caja Neta: R$ ${netCash.toFixed(2)}`);
  return { totalCash, rentFund, netCash };
}

// Escuchar cambios en los billetes para calcular en tiempo real
billInputs.forEach(input => input.addEventListener('input', calculatePhysicalCash));
if (rentFundInput) rentFundInput.addEventListener('input', calculatePhysicalCash);


// 3. LÓGICA DEL PUNTO DE VENTA (Carrito y Productos)
function renderProducts() {
  const grid = document.querySelector('.product-grid');
  if (!grid) return;
  
  grid.innerHTML = products.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}')" ${p.type === 'servico' ? 'style="border-style: dashed;"' : ''}>
      <h4>${p.name}</h4>
      <p>R$ ${p.price.toFixed(2)}</p>
      <small>${p.type === 'servico' ? 'Serviço' : 'Estoque: ' + p.stock}</small>
    </div>
  `).join('');
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  renderCart();
}

function renderCart() {
  const cartContainer = document.querySelector('.cart-items');
  const totalsArea = document.querySelector('.totals-area');
  
  if (!cartContainer || !totalsArea) return;

  // Renderizar items
  cartContainer.innerHTML = cart.map(item => `
    <div class="cart-item-row">
      <div class="cart-item-info">
        <div class="cart-item-title">${item.name}</div>
        <div class="cart-item-qty">${item.qty} un. x R$ ${item.price.toFixed(2)}</div>
      </div>
      <div class="cart-item-price">R$ ${(item.qty * item.price).toFixed(2)}</div>
    </div>
  `).join('');

  // Calcular totales
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const discountInput = document.querySelector('.totals-area input[type="number"]');
  const discountPercent = Number(discountInput?.value) || 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const total = subtotal - discountAmount;

  // Renderizar totales
  totalsArea.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2)}</span></div>
    <div class="total-row">
      <span style="display: flex; align-items: center; gap: 10px;">Desconto % 
        <input type="number" class="input" style="width: 70px; padding: 5px; height: 30px;" value="${discountPercent}" onchange="renderCart()" min="0" max="100">
      </span>
      <span>- R$ ${discountAmount.toFixed(2)}</span>
    </div>
    <div class="total-row grand-total"><span>Total a Cobrar</span><span>R$ ${total.toFixed(2)}</span></div>
  `;
}

// 4. CONEXIÓN A FIRESTORE (El nuevo estándar)
async function saveSale(saleData) {
  // Asegúrate de tener inicializado Firebase en tu index.html
  if (typeof firebase === 'undefined') {
    alert("Firebase no está conectado aún.");
    return;
  }
  
  try {
    const db = firebase.firestore();
    // Guardamos la venta directo en la nube sin pasar por cachés intermedias
    await db.collection("sales").doc(saleData.id).set(saleData);
    alert("¡Venta registrada con éxito en la roca firme de Firestore!");
    cart = []; // Limpiamos carrito
    renderCart();
  } catch (error) {
    console.error("Error al guardar venta: ", error);
    alert("Hubo un error al registrar la venta. Revisa los permisos de Firestore.");
  }
}

// Inicializar la vista
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  renderCart();
});