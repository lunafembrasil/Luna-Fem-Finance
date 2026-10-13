const STORAGE_KEY = "luna_fem_finance_v0_3";
const DRIVE_HANDLE_DB = "luna_fem_finance_drive_handles";
const DRIVE_HANDLE_STORE = "handles";
const DRIVE_HANDLE_KEY = "backupFolder";
const LAST_BACKUP_KEY = "luna_fem_finance_last_drive_backup";
const LAST_AUTO_BACKUP_KEY = "luna_fem_finance_last_auto_drive_backup";
const MOBILE_SCRIPT_URL_KEY = "luna_fem_finance_mobile_script_url";
const MOBILE_SECRET_KEY = "luna_fem_finance_mobile_secret";
const LAST_MOBILE_SYNC_KEY = "luna_fem_finance_last_mobile_sync";
const DEVICE_ID_KEY = "luna_fem_finance_device_id";
const DEVICE_NAME_KEY = "luna_fem_finance_device_name";
const PENDING_MOBILE_SYNC_KEY = "luna_fem_finance_pending_mobile_sync";
const APP_VERSION = "2.0.0-online";

const defaultData = {
  settings: {
    lowStockAlert: 3,
    maxDiscountPercent: 80
  },
  sellers: [
    {number:1, name:"Agustín", commissionPercent:0, active:true},
    {number:2, name:"Natalia", commissionPercent:0, active:true},
    {number:3, name:"Karol", commissionPercent:0, active:true}
  ],
  categories: [
    "Eletrônicos",
    "Presentes",
    "Beleza",
    "Semijoias / Bijuterias",
    "Brinquedos",
    "Úteis escolares",
    "Mochilas",
    "Termos / Jarras",
    "Parlantes / Fones",
    "Cabos / Carregadores",
    "Serviços",
    "Outros"
  ],
  products: [
    {id:"p1", name:"Cabo USB-C reforçado", category:"Cabos / Carregadores", type:"produto", cost:8, price:19.99, stock:10, sku:"CAB-USB-C", supplier:"", note:""},
    {id:"p2", name:"Brinco delicado", category:"Semijoias / Bijuterias", type:"produto", cost:2.50, price:6.99, stock:20, sku:"BRI-001", supplier:"", note:""},
    {id:"p3", name:"Impressão colorida", category:"Serviços", type:"servico", cost:0.35, price:1.50, stock:0, sku:"SERV-IMP-COR", supplier:"", note:"Serviço sem estoque"}
  ],
  sales: [],
  cashOpen: null,
  cashHistory: [],
  cashSessions: [],
  syncHistory: [],
  actionHistory: [],
  currentUser: null
};

let db = migrateDB(structuredClone(defaultData));
let dbStorageReady = true;
let selectedRole = "cashier";
let selectedSellerNumber = 1;
let cart = [];

// =====================================================================
// NÚCLEO GOOGLE FIREBASE CLOUD & FIRESTORE
// =====================================================================
let fsDb = null;
let firestoreUnsubscribers = [];
let isCloudReady = false;
let isMigratingBundled = false;

function isFirebaseConfigured(){
  return typeof firebase !== "undefined" &&
         firebase.apps &&
         firebase.apps.length > 0 &&
         typeof firebaseConfig !== "undefined" &&
         firebaseConfig.apiKey &&
         firebaseConfig.apiKey !== "TU_API_KEY";
}

function getFirestoreDB(){
  if(!fsDb && isFirebaseConfigured()){
    fsDb = firebase.firestore();
  }
  return fsDb;
}

function setCloudStatusBadge(status){
  const el = document.getElementById("connectionStatus");
  if(!el) return;
  if(status === "syncing"){
    el.textContent = "Sincronizando...";
    el.className = "connection-badge syncing";
    el.title = "Sincronizando dados em tempo real com o Google Firebase.";
  }else if(status === "online" && navigator.onLine){
    el.textContent = "Nuvem Conectada";
    el.className = "connection-badge online";
    el.title = "Conectado ao Firebase Cloud. Dados salvos e sincronizados em tempo real.";
  }else{
    el.textContent = "Offline (Local)";
    el.className = "connection-badge offline";
    el.title = "Sem conexão com a nuvem no momento. As alterações estão no cache local.";
  }
}

function startFirestoreListeners(){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;

  stopFirestoreListeners();
  setCloudStatusBadge("syncing");

  // 1. Config / Estado geral (settings, sellers, categories, cashOpen)
  const unsubConfig = dbInst.collection("config").doc("main").onSnapshot(async doc => {
    if(doc.exists){
      const data = doc.data();
      if(data.settings) db.settings = { ...defaultData.settings, ...data.settings };
      if(Array.isArray(data.sellers) && data.sellers.length) db.sellers = data.sellers;
      if(Array.isArray(data.categories) && data.categories.length) db.categories = data.categories;
      db.cashOpen = data.cashOpen !== undefined ? data.cashOpen : null;
      fillCategories();
      fillSellers();
      renderAll();
      setCloudStatusBadge("online");
    } else {
      await initCloudFirstTime();
    }
  }, err => {
    console.warn("Aviso no listener config do Firestore:", err);
    setCloudStatusBadge("offline");
  });
  firestoreUnsubscribers.push(unsubConfig);

  // 2. Coleção de Produtos
  const unsubProducts = dbInst.collection("products").onSnapshot(snapshot => {
    const prods = [];
    snapshot.forEach(doc => prods.push(doc.data()));
    if(prods.length > 0){
      db.products = prods;
      fillCategories();
      renderAll();
    }
    setCloudStatusBadge("online");
  }, err => console.warn("Aviso no listener de produtos:", err));
  firestoreUnsubscribers.push(unsubProducts);

  // 3. Coleção de Vendas
  const unsubSales = dbInst.collection("sales").onSnapshot(snapshot => {
    const list = [];
    snapshot.forEach(doc => list.push(doc.data()));
    list.sort((a,b) => (b.dateISO || "").localeCompare(a.dateISO || "") || (b.createdAt || "").localeCompare(a.createdAt || "") || (b.id || "").localeCompare(a.id || ""));
    db.sales = list;
    renderAll();
    setCloudStatusBadge("online");
  }, err => console.warn("Aviso no listener de vendas:", err));
  firestoreUnsubscribers.push(unsubSales);

  // 4. Histórico de Caixa (movimentações)
  const unsubCash = dbInst.collection("cashHistory").limit(200).onSnapshot(snapshot => {
    const list = [];
    snapshot.forEach(doc => list.push(doc.data()));
    list.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    db.cashHistory = list;
    renderAll();
  }, err => console.warn("Aviso no listener de caixa:", err));
  firestoreUnsubscribers.push(unsubCash);

  // 5. Histórico de Sessões de Caixa
  const unsubSessions = dbInst.collection("cashSessions").limit(100).onSnapshot(snapshot => {
    const list = [];
    snapshot.forEach(doc => list.push(doc.data()));
    list.sort((a,b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
    db.cashSessions = list;
    renderAll();
  }, err => console.warn("Aviso no listener de sessões:", err));
  firestoreUnsubscribers.push(unsubSessions);

  // 6. Histórico de Ações (Auditoria)
  const unsubActions = dbInst.collection("actionHistory").limit(100).onSnapshot(snapshot => {
    const list = [];
    snapshot.forEach(doc => list.push(doc.data()));
    list.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    db.actionHistory = list;
    renderAll();
  }, err => console.warn("Aviso no listener de auditoria:", err));
  firestoreUnsubscribers.push(unsubActions);

  isCloudReady = true;
}

function stopFirestoreListeners(){
  firestoreUnsubscribers.forEach(unsub => {
    try{ if(typeof unsub === "function") unsub(); }catch(e){}
  });
  firestoreUnsubscribers = [];
  isCloudReady = false;
}

async function initCloudFirstTime(){
  if(isMigratingBundled) return;
  isMigratingBundled = true;
  try{
    const dbInst = getFirestoreDB();
    if(!dbInst) return;

    const bundled = window.LF_BUNDLED_BACKUP || null;
    let dataToUpload = bundled ? migrateDB(structuredClone(bundled)) : structuredClone(defaultData);

    const countSales = Array.isArray(dataToUpload.sales) ? dataToUpload.sales.length : 0;
    const countProds = Array.isArray(dataToUpload.products) ? dataToUpload.products.length : 0;

    console.log(`Inicializando Firebase Firestore com ${countProds} produtos e ${countSales} vendas...`);

    await dbInst.collection("config").doc("main").set({
      settings: dataToUpload.settings || defaultData.settings,
      sellers: dataToUpload.sellers || defaultData.sellers,
      categories: dataToUpload.categories || defaultData.categories,
      cashOpen: dataToUpload.cashOpen || null
    }, { merge: true });

    if(countProds > 0){
      await batchUploadCollection(dbInst, "products", dataToUpload.products, "id");
    }
    if(countSales > 0){
      await batchUploadCollection(dbInst, "sales", dataToUpload.sales, "id");
    }

    logAction("Banco na nuvem inicializado", `Migrados ${countProds} produtos e ${countSales} vendas.`);
  }catch(error){
    console.error("Falha ao inicializar dados no Firestore:", error);
  }finally{
    isMigratingBundled = false;
  }
}

async function batchUploadCollection(dbInst, collectionName, items, keyField = "id"){
  if(!Array.isArray(items) || !items.length) return;
  const CHUNK_SIZE = 400;
  for(let i = 0; i < items.length; i += CHUNK_SIZE){
    const batch = dbInst.batch();
    const chunk = items.slice(i, i + CHUNK_SIZE);
    chunk.forEach(item => {
      const docId = String(item[keyField] || uid(collectionName));
      const ref = dbInst.collection(collectionName).doc(docId);
      batch.set(ref, item, { merge: true });
    });
    await batch.commit();
  }
}

// Operações diretas de persistência no Firestore
async function saveSaleToFirestore(sale){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("sales").doc(sale.id).set(sale);
    for(const item of (sale.items || [])){
      const prod = db.products.find(p => p.id === item.id);
      if(prod && prod.type === "produto"){
        await dbInst.collection("products").doc(prod.id).update({ stock: prod.stock }).catch(()=>{});
      }
    }
  }catch(err){
    console.warn("Aviso ao salvar venda no Firestore:", err);
  }
}

async function cancelSaleInFirestore(id){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("sales").doc(id).update({ cancelled: true });
    const sale = db.sales.find(s => s.id === id);
    if(sale && Array.isArray(sale.items)){
      for(const item of sale.items){
        const prod = db.products.find(p => p.id === item.id);
        if(prod && prod.type === "produto"){
          await dbInst.collection("products").doc(prod.id).update({ stock: prod.stock }).catch(()=>{});
        }
      }
    }
  }catch(err){
    console.warn("Erro ao cancelar venda no Firestore:", err);
  }
}

async function saveProductToFirestore(product){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("products").doc(product.id).set(product);
  }catch(err){
    console.warn("Erro ao salvar produto no Firestore:", err);
  }
}

async function deleteProductFromFirestore(productId){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("products").doc(productId).delete();
  }catch(err){
    console.warn("Erro ao excluir produto no Firestore:", err);
  }
}

async function saveCashMoveToFirestore(move){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("cashHistory").doc(move.id).set(move);
  }catch(err){
    console.warn("Erro ao salvar movimento de caixa:", err);
  }
}

async function saveCashSessionToFirestore(session){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("cashSessions").doc(session.id).set(session);
  }catch(err){
    console.warn("Erro ao salvar fechamento de caixa:", err);
  }
}

async function saveActionLogToFirestore(actionEntry){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("actionHistory").doc(actionEntry.id).set(actionEntry);
  }catch(err){}
}

async function saveSyncLogToFirestore(syncEntry){
  const dbInst = getFirestoreDB();
  if(!dbInst) return;
  try{
    await dbInst.collection("syncHistory").doc(syncEntry.id).set(syncEntry);
  }catch(err){}
}

async function saveDB(){
  const dbInst = getFirestoreDB();
  if(!dbInst) return Promise.resolve(false);
  try{
    await dbInst.collection("config").doc("main").set({
      settings: db.settings,
      sellers: db.sellers,
      categories: db.categories,
      cashOpen: db.cashOpen
    }, { merge: true });
    return true;
  }catch(error){
    console.warn("Falha ao salvar configuração no Firestore:", error);
    return false;
  }
}

function migrateDB(data){
  if(!data) data = structuredClone(defaultData);

  // Migração para vendedores numerados
  if(!Array.isArray(data.sellers) || data.sellers.length === 0){
    data.sellers = structuredClone(defaultData.sellers);
  }else if(typeof data.sellers[0] === "string"){
    data.sellers = data.sellers.map((name, index) => ({number:index + 1, name}));
  }

  const requiredSellers = [
    {number:1, name:"Agustín"},
    {number:2, name:"Natalia"},
    {number:3, name:"Karol"}
  ];
  requiredSellers.forEach(s => {
    if(!data.sellers.some(existing => Number(existing.number) === s.number)){
      data.sellers.push(s);
    }
  });

  data.sales = (data.sales || []).map(sale => {
    if(!sale.sellerNumber){
      const found = data.sellers.find(s => s.name === sale.seller);
      sale.sellerNumber = found ? found.number : 1;
      sale.sellerName = sale.seller || (found ? found.name : "Agustín");
    }
    return sale;
  });

  if(!data.settings) data.settings = structuredClone(defaultData.settings);
  if(!data.categories) data.categories = structuredClone(defaultData.categories);
  if(!data.products) data.products = [];
  if(!data.cashHistory) data.cashHistory = [];
  if(!data.cashSessions) data.cashSessions = [];

  data.sellers.forEach(s => {
    if(typeof s.commissionPercent !== "number" || isNaN(s.commissionPercent)) s.commissionPercent = 0;
    if(typeof s.active !== "boolean") s.active = true;
  });
  if(typeof data.settings.maxDiscountPercent !== "number" || isNaN(data.settings.maxDiscountPercent)){
    data.settings.maxDiscountPercent = 80;
  }

  if(!Array.isArray(data.syncHistory)) data.syncHistory = [];
  if(!Array.isArray(data.actionHistory)) data.actionHistory = [];

  return data;
}
function money(value){
  return "R$ " + Number(value || 0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2});
}
function todayISO(){
  return new Date().toISOString().slice(0,10);
}
function nowText(){
  return new Date().toLocaleString("pt-BR");
}
function uid(prefix){
  return prefix + "_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}
// v0.7 - Módulo 10/11: identidade deste computador (não faz parte do backup/negócio,
// fica só neste navegador - por isso vive no localStorage e não em db).
function getDeviceId(){
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if(!id){
    id = uid("device");
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
function getDeviceName(){
  return localStorage.getItem(DEVICE_NAME_KEY) || "Computador sem nome";
}
function setDeviceName(name){
  localStorage.setItem(DEVICE_NAME_KEY, name || "");
}
function num(id){
  return Number(document.getElementById(id).value || 0);
}
function text(id){
  return document.getElementById(id).value.trim();
}
function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("logoutBtn").classList.toggle("hidden", id === "loginScreen");
}
function todaySales(){
  return db.sales.filter(s => s.dateISO === todayISO() && !s.cancelled);
}
function totalsToday(){
  const sales = todaySales();
  return {
    total: sales.reduce((a,s)=>a+s.total,0),
    profit: sales.reduce((a,s)=>a+s.profit,0),
    count: sales.length
  };
}

function productsSoldToday(sales = todaySales()){
  const map = new Map();
  sales.forEach(sale => {
    (Array.isArray(sale.items) ? sale.items : []).forEach(item => {
      const key = item.id || String(item.name || "").trim().toLowerCase();
      if(!key) return;
      if(!map.has(key)){
        map.set(key, {id:item.id || "", name:item.name || "Produto", qty:0, total:0});
      }
      const row = map.get(key);
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      row.qty += qty;
      row.total += qty * price;
    });
  });
  return Array.from(map.values()).sort((a,b) => b.qty - a.qty || b.total - a.total || a.name.localeCompare(b.name));
}

function ensureProductsSoldTodayCard(){
  let card = document.getElementById("productsSoldTodayCard");
  if(card) return card;

  const anchor = document.getElementById("sellerTodaySummary");
  if(!anchor || !anchor.parentElement) return null;

  card = document.createElement("div");
  card.id = "productsSoldTodayCard";
  card.className = anchor.parentElement.className || "card";
  card.style.marginTop = "16px";
  card.innerHTML = `
    <div class="section-title">
      <div>
        <h3 style="margin:0;">Produtos vendidos hoje</h3>
        <small class="muted">Somente as vendas de hoje</small>
      </div>
    </div>
    <div id="productsSoldTodayList"></div>
  `;
  anchor.parentElement.insertAdjacentElement("afterend", card);
  return card;
}

function renderProductsSoldToday(sales = todaySales()){
  const card = ensureProductsSoldTodayCard();
  const box = card ? card.querySelector("#productsSoldTodayList") : document.getElementById("productsSoldTodayList");
  if(!box) return;
  const rows = productsSoldToday(sales);
  box.innerHTML = rows.length ? rows.map(row => `
    <div class="summary-row">
      <span><strong>${escapeHTML(row.name)}</strong><br><small>${row.qty} unidade(s) vendida(s)</small></span>
      <strong>${money(row.total)}</strong>
    </div>
  `).join("") : `<p class="muted">Nenhum produto vendido hoje.</p>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  // Inicialização e persistência do Firebase
  if(typeof firebase !== "undefined" && firebase.apps && firebase.apps.length){
    try{
      const fs = firebase.firestore();
      await fs.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if(err.code === "failed-precondition"){
          console.warn("Persistência offline ativa em outra aba.");
        }else if(err.code === "unimplemented"){
          console.warn("Navegador não suporta persistência IndexedDB para Firestore.");
        }
      });
    }catch(e){
      console.warn("Aviso na persistência offline do Firestore:", e);
    }

    firebase.auth().onAuthStateChanged(handleAuthStateChanged);
  }else{
    console.warn("Firebase SDK não detectado ou credenciais pendentes.");
    const feedback = document.getElementById("loginFeedback");
    if(feedback) feedback.textContent = "Aviso: configure suas credenciais no arquivo 'firebase-config.js'.";
  }

  setupLogin();
  setupTabs();
  setupEvents();
  fillCategories();
  fillSellers();
  renderAll();

  renderConnectionStatus();
  window.addEventListener("online", () => {
    renderConnectionStatus();
    if(typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser && !isCloudReady){
      startFirestoreListeners();
    }
    retryPendingMobileSync();
  });
  window.addEventListener("offline", renderConnectionStatus);
  retryPendingMobileSync();
});

// v0.7 - Módulo 9: reenvia a sincronização do Painel Mobile que falhou por falta de
// internet. O payload sempre leva o estado completo atual, então não precisa de fila.
function retryPendingMobileSync(){
  if(navigator.onLine && localStorage.getItem(PENDING_MOBILE_SYNC_KEY) === "1"){
    syncMobilePanel(true, "reconexão automática");
  }
}

function renderConnectionStatus(){
  const el = document.getElementById("connectionStatus");
  if(!el) return;
  const online = navigator.onLine;
  if(isCloudReady && online){
    el.textContent = "Nuvem Conectada";
    el.className = "connection-badge online";
    el.title = "Conectado ao Firebase Cloud. Dados sincronizados em tempo real.";
  }else if(online){
    el.textContent = "Online";
    el.className = "connection-badge online";
    el.title = "Conectado à internet.";
  }else{
    el.textContent = "Offline";
    el.className = "connection-badge offline";
    el.title = "Sem internet agora. Operações salvas em cache local.";
  }
}

function setupLogin(){
  document.querySelectorAll(".role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedRole = btn.dataset.role;
      document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const loginBtn = document.getElementById("loginBtn");
  if(loginBtn) loginBtn.addEventListener("click", login);

  const pwdInput = document.getElementById("loginPassword");
  if(pwdInput) pwdInput.addEventListener("keydown", e => {
    if(e.key === "Enter") login();
  });

  const emailInput = document.getElementById("loginEmail");
  if(emailInput) emailInput.addEventListener("keydown", e => {
    if(e.key === "Enter") {
      if(pwdInput) pwdInput.focus();
    }
  });

  const logoutBtn = document.getElementById("logoutBtn");
  if(logoutBtn) logoutBtn.addEventListener("click", performLogout);

  const sidebarLogoutBtn = document.getElementById("sidebarLogoutBtn");
  if(sidebarLogoutBtn) sidebarLogoutBtn.addEventListener("click", performLogout);
}

async function login(){
  const emailInput = document.getElementById("loginEmail");
  const pwdInput = document.getElementById("loginPassword");
  const feedback = document.getElementById("loginFeedback");
  const loginBtn = document.getElementById("loginBtn");

  const email = emailInput ? emailInput.value.trim() : "";
  const password = pwdInput ? pwdInput.value : "";

  if(!isFirebaseConfigured()){
    const msg = "Firebase não configurado. Por favor, insira suas credenciais no arquivo 'firebase-config.js'.";
    if(feedback) feedback.textContent = msg;
    alert(msg);
    return;
  }

  if(!email || !password){
    const msg = "Informe o e-mail e a senha de acesso.";
    if(feedback) feedback.textContent = msg;
    alert(msg);
    return;
  }

  try{
    if(loginBtn){
      loginBtn.disabled = true;
      loginBtn.textContent = "Entrando...";
    }
    if(feedback) feedback.textContent = "";

    await firebase.auth().signInWithEmailAndPassword(email, password);
  }catch(error){
    console.error("Erro no login Firebase:", error);
    let msg = "Falha ao entrar no sistema.";
    if(error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found"){
      msg = "E-mail ou senha incorretos.";
    }else if(error.code === "auth/invalid-email"){
      msg = "Formato de e-mail inválido.";
    }else if(error.code === "auth/network-request-failed"){
      msg = "Erro de conexão. Verifique sua conexão com a internet.";
    }else if(error.code === "auth/too-many-requests"){
      msg = "Muitas tentativas sem sucesso. Tente novamente mais tarde.";
    }else{
      msg = error.message;
    }
    if(feedback) feedback.textContent = msg;
    alert(msg);
  }finally{
    if(loginBtn){
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    }
  }
}

async function performLogout(){
  try{
    if(typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser){
      await firebase.auth().signOut();
    }
  }catch(e){
    console.warn("Erro ao fazer logout:", e);
  }
  stopFirestoreListeners();
  db.currentUser = null;
  cart = [];
  showScreen("loginScreen");
  const pwdInput = document.getElementById("loginPassword");
  if(pwdInput) pwdInput.value = "";
}

async function handleAuthStateChanged(user){
  if(user){
    let userRole = selectedRole || "cashier";
    try{
      const dbInst = getFirestoreDB();
      if(dbInst){
        const userDoc = await dbInst.collection("users").doc(user.uid).get();
        if(userDoc.exists && userDoc.data().role){
          userRole = userDoc.data().role;
        }else{
          if(user.email && user.email.toLowerCase().includes("admin")){
            userRole = "admin";
          }
          await dbInst.collection("users").doc(user.uid).set({
            email: user.email,
            role: userRole,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
    }catch(err){
      console.warn("Aviso ao recuperar perfil do usuário:", err);
    }

    db.currentUser = {
      uid: user.uid,
      email: user.email,
      role: userRole,
      name: userRole === "admin" ? "Administrador" : "Caixa"
    };

    const emailEl = document.getElementById("currentUserEmail");
    if(emailEl) emailEl.textContent = user.email;

    startFirestoreListeners();
    showScreen(userRole === "admin" ? "adminScreen" : "cashierScreen");
    renderAll();
  }else{
    stopFirestoreListeners();
    db.currentUser = null;
    showScreen("loginScreen");
  }
}

async function updateAuthPassword(){
  const newPass = document.getElementById("newAuthPassword")?.value || "";
  const confirmPass = document.getElementById("confirmAuthPassword")?.value || "";
  const feedback = document.getElementById("authSecurityFeedback");
  if(!newPass){
    alert("Informe a nova senha.");
    return;
  }
  if(newPass.length < 6){
    alert("A senha deve ter no mínimo 6 caracteres.");
    return;
  }
  if(newPass !== confirmPass){
    alert("A confirmação de senha não confere.");
    return;
  }
  if(typeof firebase === "undefined" || !firebase.auth().currentUser){
    alert("Nenhum usuário conectado via Firebase.");
    return;
  }
  try{
    if(feedback) feedback.textContent = "Atualizando senha...";
    await firebase.auth().currentUser.updatePassword(newPass);
    logAction("Senha alterada", `Usuário: ${firebase.auth().currentUser.email}`);
    document.getElementById("newAuthPassword").value = "";
    document.getElementById("confirmAuthPassword").value = "";
    if(feedback){
      feedback.style.color = "#1f8a4c";
      feedback.textContent = "Senha atualizada com sucesso no Firebase!";
    }
    alert("Senha atualizada com sucesso no Firebase!");
  }catch(error){
    console.error("Erro ao alterar senha:", error);
    let msg = error.message;
    if(error.code === "auth/requires-recent-login"){
      msg = "Por motivos de segurança, saia do sistema e faça login novamente antes de alterar a senha.";
    }
    if(feedback){
      feedback.style.color = "#c53030";
      feedback.textContent = msg;
    }
    alert("Erro ao alterar senha: " + msg);
  }
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab + "Tab").classList.add("active");
      renderAll();
    });
  });
}

function setupEvents(){
  document.getElementById("productSearch").addEventListener("input", renderProductsForCashier);
  document.getElementById("paymentSelect").addEventListener("change", updatePaymentBoxes);

  const discountPercentInput = document.getElementById("discountPercent");
  if(discountPercentInput) discountPercentInput.addEventListener("input", sanitizeDiscountAndRender);

  const cardFeeInput = document.getElementById("cardFee");
  if(cardFeeInput) cardFeeInput.addEventListener("input", renderCart);
  document.getElementById("finishSaleBtn").addEventListener("click", finishSale);

  const quickProductBtn = document.getElementById("quickProductBtn");
  if(quickProductBtn) quickProductBtn.addEventListener("click", createQuickProduct);

  document.getElementById("saveProductBtn").addEventListener("click", saveProduct);
  document.getElementById("clearProductBtn").addEventListener("click", clearProductForm);
  document.getElementById("saveCashMoveBtn").addEventListener("click", saveCashMovement);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
  document.getElementById("downloadBackupBtn").addEventListener("click", downloadBackup);
  document.getElementById("restoreBackupInput").addEventListener("change", restoreBackup);

  const chooseDriveFolderBtn = document.getElementById("chooseDriveFolderBtn");
  if(chooseDriveFolderBtn) chooseDriveFolderBtn.addEventListener("click", chooseDriveFolder);

  const saveBackupToDriveBtn = document.getElementById("saveBackupToDriveBtn");
   const downloadFullBackupBtn=document.getElementById("downloadFullBackupBtn"); if(downloadFullBackupBtn) downloadFullBackupBtn.addEventListener("click",downloadFullBackup);
   const saveFullBackupToDriveBtn=document.getElementById("saveFullBackupToDriveBtn"); if(saveFullBackupToDriveBtn) saveFullBackupToDriveBtn.addEventListener("click",saveFullBackupToDrive);
  if(saveBackupToDriveBtn) saveBackupToDriveBtn.addEventListener("click", () => saveBackupToDrive(false));

  const saveReportToDriveBtn = document.getElementById("saveReportToDriveBtn");
  if(saveReportToDriveBtn) saveReportToDriveBtn.addEventListener("click", saveReportToDrive);

  const clearDriveFolderBtn = document.getElementById("clearDriveFolderBtn");
  if(clearDriveFolderBtn) clearDriveFolderBtn.addEventListener("click", clearDriveFolder);

  const saveMobileConfigBtn = document.getElementById("saveMobileConfigBtn");
  if(saveMobileConfigBtn) saveMobileConfigBtn.addEventListener("click", saveMobileConfig);

  const testMobileSyncBtn = document.getElementById("testMobileSyncBtn");
  if(testMobileSyncBtn) testMobileSyncBtn.addEventListener("click", () => syncMobilePanel(false, "teste manual"));

  const syncMobileNowBtn = document.getElementById("syncMobileNowBtn");
  if(syncMobileNowBtn) syncMobileNowBtn.addEventListener("click", () => syncMobilePanel(false, "sincronização manual"));

  // v0.5 - Centro de Controle: atalhos do Início, Vendedores e Configurações.
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(`.tab[data-tab="${btn.dataset.goto}"]`);
      if(target) target.click();
    });
  });

  const saveSellerBtn = document.getElementById("saveSellerBtn");
  if(saveSellerBtn) saveSellerBtn.addEventListener("click", saveSeller);

  const clearSellerBtn = document.getElementById("clearSellerBtn");
  if(clearSellerBtn) clearSellerBtn.addEventListener("click", clearSellerForm);

  const updateAuthPasswordBtn = document.getElementById("updateAuthPasswordBtn");
  if(updateAuthPasswordBtn) updateAuthPasswordBtn.addEventListener("click", updateAuthPassword);

  const manualSalePanel = document.querySelector(".manual-sale-panel");
  if(manualSalePanel){
    manualSalePanel.addEventListener("toggle", () => {
      if(manualSalePanel.open){
        renderManualSaleSellers();
        renderManualSaleProductPicker();
        renderManualSaleCart();
      }
    });
  }

  const saveRulesBtn = document.getElementById("saveRulesBtn");
  if(saveRulesBtn) saveRulesBtn.addEventListener("click", saveRuleSettings);

  // v0.6 - Fusionador Inteligente e Histórico de sincronização.
  const analyzeMergeBtn = document.getElementById("analyzeMergeBtn");
  if(analyzeMergeBtn) analyzeMergeBtn.addEventListener("click", analyzeMerge);

  const confirmMergeBtn = document.getElementById("confirmMergeBtn");
  if(confirmMergeBtn) confirmMergeBtn.addEventListener("click", downloadMergedBackup);

  const applyMergeBtn = document.getElementById("applyMergeBtn");
  if(applyMergeBtn) applyMergeBtn.addEventListener("click", applyMergedBackup);

  const clearSyncHistoryBtn = document.getElementById("clearSyncHistoryBtn");
  if(clearSyncHistoryBtn) clearSyncHistoryBtn.addEventListener("click", clearSyncHistory);

  // v0.7 - Módulo 9/10/11.
  const saveDeviceNameBtn = document.getElementById("saveDeviceNameBtn");
  if(saveDeviceNameBtn) saveDeviceNameBtn.addEventListener("click", saveDeviceNameSetting);

  const checkOtherComputersBtn = document.getElementById("checkOtherComputersBtn");
  if(checkOtherComputersBtn) checkOtherComputersBtn.addEventListener("click", checkOtherComputersNow);

  // v0.8 - Módulo 3/4/5: sub-abas dentro de Análises.
  document.querySelectorAll("#analisesTab .subtab").forEach(tab => {
    tab.addEventListener("click", () => switchAnalysisView(tab.dataset.view));
  });

  // v0.9 - Módulo 14/15 e venda manual.
  const clearActionHistoryBtn = document.getElementById("clearActionHistoryBtn");
  if(clearActionHistoryBtn) clearActionHistoryBtn.addEventListener("click", clearActionHistory);

  const finishManualSaleBtn = document.getElementById("finishManualSaleBtn");
  if(finishManualSaleBtn) finishManualSaleBtn.addEventListener("click", finishManualSale);

  const manualDiscountInput = document.getElementById("manualDiscountPercent");
  if(manualDiscountInput) manualDiscountInput.addEventListener("input", renderManualSaleCart);

  document.querySelectorAll("#reportsTab [data-export]").forEach(btn => {
    btn.addEventListener("click", () => exportSalesReport(btn.dataset.export));
  });

  // v1.0 - Módulo 16: importação em massa de produtos.
  const analyzeImportBtn = document.getElementById("analyzeImportBtn");
  if(analyzeImportBtn) analyzeImportBtn.addEventListener("click", analyzeProductImportFromTextarea);

  const confirmImportBtn = document.getElementById("confirmImportBtn");
  if(confirmImportBtn) confirmImportBtn.addEventListener("click", confirmProductImport);

  const importProductsFile = document.getElementById("importProductsFile");
  if(importProductsFile) importProductsFile.addEventListener("change", loadImportFile);
}

function renderAll(){
  // v1.4: renderização por aba. Antes cada clique reconstruía todos os painéis,
  // incluindo históricos grandes de caixa/relatórios. Agora só renderiza a tela ativa.
  fillCategories();
  fillSellers();
  const activeTab = document.querySelector(".tab.active");
  const tab = activeTab ? activeTab.dataset.tab : "home";
  renderTab(tab);
}

function renderTab(tab){
  switch(tab){
    case "home":
      renderHome(); renderCashierCashPanel(); renderProductsForCashier(); renderCart();
      break;
    case "dashboard":
      renderDashboard();
      break;
    case "sales":
      renderSales();
      renderManualSaleSellers();
      renderManualSaleProductPicker();
      renderManualSaleCart();
      break;
    case "cash":
      renderCash(); renderCashierCashPanel();
      break;
    case "products":
      renderAdminProducts(); renderManualSaleProductPicker();
      break;
    case "clients":
      renderClients();
      break;
    case "sellers":
      renderSellersAdmin(); renderManualSaleSellers();
      break;
    case "reports":
      renderReports();
      break;
    case "analises":
      renderAnalisesPeriodo(); renderResumosMensais(); renderResumoAnual();
      break;
    case "backup":
      renderCloudStatus(); renderDeviceInfo();
      break;
    case "sync":
      renderMobileStatus(); renderSyncHistory(); renderActionHistory();
      break;
    case "tools":
      renderManualSaleSellers(); renderManualSaleProductPicker(); renderManualSaleCart();
      break;
    case "config":
      renderConfig(); renderDeviceInfo();
      break;
    default:
      renderHome();
  }
  updatePaymentBoxes();
}

function fillCategories(){
  const options = db.categories.map(c => `<option value="${c}">${c}</option>`).join("");
  const sel = document.getElementById("prodCategory");
  if(sel) sel.innerHTML = options;

  const quickSel = document.getElementById("quickProdCategory");
  if(quickSel){
    quickSel.innerHTML = options;
    if(db.categories.includes("Outros")) quickSel.value = "Outros";
  }
}
function fillSellers(){
  const cards = document.getElementById("sellerCards");
  if(!cards) return;
  const activeSellers = db.sellers.filter(s => s.active !== false);
  const list = activeSellers.length ? activeSellers : db.sellers;
  if(!list.some(s => Number(s.number) === Number(selectedSellerNumber))){
    selectedSellerNumber = list[0] ? list[0].number : 1;
  }
  cards.innerHTML = list.map(s => `
    <button class="seller-card ${Number(s.number) === Number(selectedSellerNumber) ? "active" : ""}" onclick="selectSeller(${s.number})">
      <span class="seller-number">${s.number}</span>
      <strong>${escapeHTML(s.name)}</strong>
    </button>
  `).join("");
  const selected = getSelectedSeller();
  const badge = document.getElementById("selectedSellerBadge");
  if(badge) badge.textContent = `Vendedor ${selected.number}: ${selected.name}`;
  renderManualSaleSellers();
}
function selectSeller(number){
  selectedSellerNumber = Number(number);
  fillSellers();
}
function getSelectedSeller(){
  return db.sellers.find(s => Number(s.number) === Number(selectedSellerNumber)) || db.sellers[0] || {number:1, name:"Agustín"};
}

function getSaleDate(sale){
  if(sale.saleDate) return sale.saleDate;
  const raw = String(sale.createdAt || "");
  if(raw.includes(",")) return raw.split(",")[0].trim();
  const parts = raw.split(" ");
  return parts[0] || "";
}
function getSaleTime(sale){
  if(sale.saleTime) return sale.saleTime;
  const raw = String(sale.createdAt || "");
  if(raw.includes(",")) return raw.split(",").slice(1).join(",").trim();
  const parts = raw.split(" ");
  return parts.slice(1).join(" ") || "";
}
function saleCashAmount(sale){
  if(!sale || sale.cancelled) return 0;
  if(sale.payment === "dinheiro") return Number(sale.total || 0);
  if(sale.payment === "misto" && sale.mixed) return Number(sale.mixed.dinheiro || 0);
  return 0;
}
function currentCashSales(){
  const dateISO = db.cashOpen?.dateISO || todayISO();
  return db.sales.filter(s => !s.cancelled && s.dateISO === dateISO).reduce((sum, s) => sum + saleCashAmount(s), 0);
}
function currentManualCashMovements(){
  const sessionId = db.cashOpen?.id;
  const dateISO = db.cashOpen?.dateISO || todayISO();
  return db.cashHistory
    .filter(h => h.dateISO === dateISO)
    .filter(h => h.type === "entrada" || h.type === "retirada")
    .filter(h => !sessionId || !h.cashSessionId || h.cashSessionId === sessionId)
    .reduce((sum, h) => sum + (h.type === "entrada" ? Number(h.value || 0) : -Number(h.value || 0)), 0);
}
function expectedCashAmount(){
  if(!db.cashOpen) return 0;
  return Number(db.cashOpen.initial || db.cashOpen.openingAmount || 0) + currentCashSales() + currentManualCashMovements();
}

function renderProductsForCashier(){
  const q = document.getElementById("productSearch").value.toLowerCase();
  const list = document.getElementById("productList");
  const products = db.products.filter(p => [p.name,p.category,p.sku,p.supplier].join(" ").toLowerCase().includes(q));
  list.innerHTML = products.map(p => `
    <div class="product-card">
      <h3>${escapeHTML(p.name)}</h3>
      <small>${escapeHTML(p.category)} • ${p.type === "servico" ? "Serviço" : "Estoque: "}<span class="${p.type !== "servico" && Number(p.stock) < 0 ? "stock-negative" : ""}">${p.type === "servico" ? "" : p.stock}</span></small>
      <div class="price">${money(p.price)}</div>
      <button class="btn primary" onclick="addToCart('${p.id}')">Adicionar</button>
    </div>
  `).join("");
}
function addToCart(id){
  const p = db.products.find(x => x.id === id);
  if(!p) return;
  const item = cart.find(x => x.id === id);
  if(item){
    item.qty += 1;
  }else{
    cart.push({...p, qty:1});
  }
  renderCart();
}

function createQuickProduct(){
  const name = text("quickProdName");
  const price = num("quickProdPrice");
  const category = document.getElementById("quickProdCategory").value || "Outros";
  const stockInput = document.getElementById("quickProdStock").value;
  const stock = stockInput === "" ? 1 : Math.max(1, Number(stockInput || 1));
  const note = text("quickProdNote");
  const seller = getSelectedSeller();

  if(!name){
    alert("Informe o nome do produto.");
    return;
  }
  if(!price || price <= 0){
    alert("Informe o preço final de venda.");
    return;
  }

  const product = {
    id: uid("p"),
    name,
    category,
    type: "produto",
    cost: 0,
    price,
    stock,
    sku: "",
    supplier: "",
    note: note || "Produto criado pelo Caixa. Pendente de revisão pelo administrador.",
    pendingReview: true,
    createdBySellerNumber: seller.number,
    createdBySellerName: seller.name,
    createdAt: nowText()
  };

  db.products.unshift(product);
  saveProductToFirestore(product);
  saveDB();

  document.getElementById("quickProdName").value = "";
  document.getElementById("quickProdPrice").value = "";
  document.getElementById("quickProdStock").value = "";
  document.getElementById("quickProdNote").value = "";

  addToCart(product.id);
  renderAll();
  alert("Produto rápido criado e adicionado ao carrinho. O administrador deverá completar os dados depois.");
}
function removeCart(id){
  cart = cart.filter(i => i.id !== id);
  renderCart();
}
function setQty(id, value){
  const item = cart.find(i => i.id === id);
  if(!item) return;
  const product = db.products.find(p => p.id === id);
  const qty = Math.max(1, Number(value || 1));
  item.qty = qty;
  renderCart();
}
function getDiscountPercent(){
  const input = document.getElementById("discountPercent");
  if(!input) return 0;
  let value = Number(input.value || 0);
  if(isNaN(value)) value = 0;
  const max = Number(db.settings.maxDiscountPercent ?? 80);
  value = Math.max(0, Math.min(max, value));
  return value;
}
function sanitizeDiscountAndRender(){
  const input = document.getElementById("discountPercent");
  if(input){
    let value = Number(input.value || 0);
    if(isNaN(value)) value = 0;
    const max = Number(db.settings.maxDiscountPercent ?? 80);
    if(value < 0) value = 0;
    if(value > max) value = max;
    input.value = value;
  }
  renderCart();
}

function cartTotals(){
  const subtotal = cart.reduce((a,i)=>a + i.price*i.qty,0);
  const cost = cart.reduce((a,i)=>a + i.cost*i.qty,0);
  const discountPercent = getDiscountPercent();
  const discountAmount = subtotal * discountPercent / 100;
  const total = Math.max(0, subtotal - discountAmount);
  const pay = document.getElementById("paymentSelect").value;
  const feePercent = (pay === "credito" || pay === "debito") ? num("cardFee") : 0;
  const fee = total * feePercent / 100;
  const profit = total - cost - fee;
  return {subtotal, discountPercent, discountAmount, total, cost, fee, profit};
}
function renderCart(){
  const list = document.getElementById("cartList");
  if(!cart.length){
    list.innerHTML = `<div class="cart-empty">Nenhum produto adicionado.</div>`;
  }else{
    list.innerHTML = cart.map(i => `
      <div class="cart-item">
        <div class="cart-item-top">
          <div>
            <strong>${escapeHTML(i.name)}</strong><br>
            <small>${money(i.price)} cada</small>
          </div>
          <button class="btn ghost" onclick="removeCart('${i.id}')">Remover</button>
        </div>
        <div class="qty-row">
          <span>Qtd.</span>
          <input class="input" type="number" min="1" value="${i.qty}" onchange="setQty('${i.id}', this.value)" />
          <strong>${money(i.price*i.qty)}</strong>
        </div>
      </div>
    `).join("");
  }
  const totals = cartTotals();
  const subtotalEl = document.getElementById("cartSubtotal");
  const discountEl = document.getElementById("cartDiscount");
  const totalEl = document.getElementById("cartTotal");
  if(subtotalEl) subtotalEl.textContent = money(totals.subtotal);
  if(discountEl) discountEl.textContent = "- " + money(totals.discountAmount) + " (" + totals.discountPercent + "%)";
  if(totalEl) totalEl.textContent = money(totals.total);
  document.getElementById("cashierTodayTotal").textContent = money(totalsToday().total);
}
function updatePaymentBoxes(){
  const pay = document.getElementById("paymentSelect").value;
  document.getElementById("creditBox").classList.toggle("hidden", pay !== "credito");
  document.getElementById("feeBox").classList.toggle("hidden", pay !== "credito" && pay !== "debito");
  document.getElementById("mixedBox").classList.toggle("hidden", pay !== "misto");
  renderCart();
}
function finishSale(){
  if(!cart.length){
    alert("Adicione produtos ao carrinho.");
    return;
  }

  const pay = document.getElementById("paymentSelect").value;
  const t = cartTotals();

  const mixed = {
    dinheiro: num("mixDinheiro"),
    pix: num("mixPix"),
    debito: num("mixDebito"),
    credito: num("mixCredito"),
    transferencia: num("mixTransferencia")
  };
  const mixedTotal = Object.values(mixed).reduce((a,b)=>a+b,0);
  if(pay === "misto" && Math.abs(mixedTotal - t.total) > 0.01){
    alert("No pagamento misto, a soma dos valores precisa fechar com o total da venda.");
    return;
  }

  const saleDateObj = new Date();
  const sale = {
    id: uid("sale"),
    createdAt: saleDateObj.toLocaleString("pt-BR"),
    saleDate: saleDateObj.toLocaleDateString("pt-BR"),
    saleTime: saleDateObj.toLocaleTimeString("pt-BR"),
    dateISO: todayISO(),
    sellerNumber: getSelectedSeller().number,
    sellerName: getSelectedSeller().name,
    seller: getSelectedSeller().name,
    deviceName: getDeviceName(),
    customer: text("customerName"),
    phone: text("customerPhone"),
    payment: pay,
    mixed: pay === "misto" ? mixed : null,
    installments: pay === "credito" ? Number(document.getElementById("installments").value) : 1,
    cardFeePercent: num("cardFee"),
    subtotal: t.subtotal,
    discountPercent: t.discountPercent,
    discountAmount: t.discountAmount,
    total: t.total,
    cost: t.cost,
    fee: t.fee,
    profit: t.profit,
    note: text("saleNote"),
    items: cart.map(i => ({id:i.id, name:i.name, qty:i.qty, price:i.price, cost:i.cost})),
    cancelled: false
  };

  sale.items.forEach(item => {
    const product = db.products.find(p => p.id === item.id);
    if(product && product.type === "produto"){
      product.stock = Number(product.stock || 0) - Number(item.qty);
    }
  });

  db.sales.unshift(sale);
  saveSaleToFirestore(sale);
  saveDB();
  cart = [];
  ["customerName","customerPhone","saleNote","mixDinheiro","mixPix","mixDebito","mixCredito","mixTransferencia"].forEach(id => document.getElementById(id).value = "");
  const discountInput = document.getElementById("discountPercent");
  if(discountInput) discountInput.value = 0;
  renderAll();

  // Backup automático silencioso: não muda o botão de finalizar venda.
  // Se a pasta Google Drive já foi configurada pelo Administrador, a venda recém-finalizada fica respaldada.
  autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática");

  alert("Venda registrada com sucesso.");
}

function renderDashboard(){
  const t = totalsToday();
  const sales = todaySales();
  const m = computeDashboardMetrics(sales, t);

  document.getElementById("adminTodaySales").textContent = money(t.total);
  document.getElementById("adminTodayProfit").textContent = money(t.profit);
  document.getElementById("adminProductsCount").textContent = db.products.length;

  const costEl = document.getElementById("adminTodayCost");
  if(costEl) costEl.textContent = money(m.costToday);

  const cashEl = document.getElementById("adminCashStatus");
  const cashSubEl = document.getElementById("adminCashSub");
  if(cashEl){
    if(db.cashOpen){
      cashEl.textContent = money(expectedCashAmount());
      if(cashSubEl) cashSubEl.textContent = "Caixa aberto - valor esperado";
    }else{
      cashEl.textContent = "Fechado";
      if(cashSubEl) cashSubEl.textContent = "Nenhum caixa aberto agora";
    }
  }

  const lowStockEl = document.getElementById("adminLowStockCount");
  if(lowStockEl) lowStockEl.textContent = m.lowStockItems.length;

  const bestSellerEl = document.getElementById("adminBestSeller");
  if(bestSellerEl){
    bestSellerEl.textContent = m.bestSeller ? `${m.bestSeller.name}` : "-";
  }
  const bestSellerSubEl = document.getElementById("adminBestSellerSub");
  if(bestSellerSubEl){
    bestSellerSubEl.textContent = m.bestSeller ? `${money(m.bestSeller.total)} em vendas hoje` : "Nenhuma venda hoje ainda";
  }

  const commissionEl = document.getElementById("adminCommissionToday");
  if(commissionEl) commissionEl.textContent = money(m.commissionToday);

  const cancelledEl = document.getElementById("adminCancelledToday");
  if(cancelledEl) cancelledEl.textContent = `${m.cancelledCount} (${money(m.cancelledTotal)})`;

  const ticketEl = document.getElementById("adminTicketAvg");
  if(ticketEl) ticketEl.textContent = money(m.ticketAvgToday);
  const ticketSubEl = document.getElementById("adminTicketAvgSub");
  if(ticketSubEl) ticketSubEl.textContent = `${t.count} venda(s) hoje`;

  const dailyAvgEl = document.getElementById("adminDailyAvg");
  if(dailyAvgEl) dailyAvgEl.textContent = money(m.dailyAvg30);

  const monthlyAvgEl = document.getElementById("adminMonthlyAvg");
  if(monthlyAvgEl) monthlyAvgEl.textContent = money(m.monthlyAvgAll);

  const summary = {dinheiro:0,pix:0,debito:0,credito:0,transferencia:0,misto:0};
  sales.forEach(s => summary[s.payment] += s.total);
  document.getElementById("paymentSummary").innerHTML = Object.entries(summary).map(([k,v]) => `
    <div class="summary-row"><span>${labelPayment(k)}</span><strong>${money(v)}</strong></div>
  `).join("");

  document.getElementById("lowStockList").innerHTML = m.lowStockItems.length ? m.lowStockItems.map(p => `
    <div class="summary-row"><span>${escapeHTML(p.name)}</span><strong>${p.stock}</strong></div>
  `).join("") : `<p class="muted">Nenhum produto com estoque baixo.</p>`;

  const sellerTodayBox = document.getElementById("sellerTodaySummary");
  if(sellerTodayBox){
    sellerTodayBox.innerHTML = sellerSummary(sales).map(row => `
      <div class="summary-row">
        <span>Vendedor ${row.number}: ${escapeHTML(row.name)}<br><small>${row.count} venda(s)</small></span>
        <strong>${money(row.total)}</strong>
      </div>
    `).join("") || `<p class="muted">Nenhuma venda hoje.</p>`;
  }
  renderProductsSoldToday(sales);
}

// v0.5 - Módulo 1: cálculos do Dashboard profissional.
function computeDashboardMetrics(sales, totalsTodayObj){
  const costToday = sales.reduce((a,s) => a + Number(s.cost || 0), 0);

  const lowStockItems = db.products.filter(p => p.type === "produto" && Number(p.stock) <= Number(db.settings.lowStockAlert));

  const sellersToday = sellerSummary(sales).filter(r => r.total > 0);
  const bestSeller = sellersToday.length ? sellersToday.reduce((a,b) => b.total > a.total ? b : a) : null;

  let commissionToday = 0;
  sellersToday.forEach(row => {
    const seller = db.sellers.find(s => Number(s.number) === Number(row.number));
    const pct = seller ? Number(seller.commissionPercent || 0) : 0;
    commissionToday += row.total * pct / 100;
  });

  const cancelledToday = db.sales.filter(s => s.dateISO === todayISO() && s.cancelled);
  const cancelledCount = cancelledToday.length;
  const cancelledTotal = cancelledToday.reduce((a,s) => a + Number(s.total || 0), 0);

  const ticketAvgToday = totalsTodayObj.count ? totalsTodayObj.total / totalsTodayObj.count : 0;

  const dailyAvg30 = averageByDay(30);
  const monthlyAvgAll = averageByMonth();

  return {costToday, lowStockItems, bestSeller, commissionToday, cancelledCount, cancelledTotal, ticketAvgToday, dailyAvg30, monthlyAvgAll};
}
function averageByDay(daysWindow){
  const cutoff = dateAtStartOfDay(new Date());
  cutoff.setDate(cutoff.getDate() - (daysWindow - 1));
  const totalsByDay = new Map();
  db.sales.forEach(s => {
    if(s.cancelled) return;
    const dt = parseSaleDateTime(s);
    if(dt < cutoff) return;
    const key = s.dateISO || localISODate(dt);
    totalsByDay.set(key, (totalsByDay.get(key) || 0) + Number(s.total || 0));
  });
  const days = Array.from(totalsByDay.values());
  if(!days.length) return 0;
  return days.reduce((a,b) => a+b, 0) / days.length;
}
function averageByMonth(){
  const totalsByMonth = new Map();
  db.sales.forEach(s => {
    if(s.cancelled) return;
    const dt = parseSaleDateTime(s);
    const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
    totalsByMonth.set(key, (totalsByMonth.get(key) || 0) + Number(s.total || 0));
  });
  const months = Array.from(totalsByMonth.values());
  if(!months.length) return 0;
  return months.reduce((a,b) => a+b, 0) / months.length;
}

// v0.5 - Início: resumo rápido e atalhos.
function renderHome(){
  const box = document.getElementById("homeQuickMetrics");
  if(!box) return;
  const t = totalsToday();
  const cashLabel = db.cashOpen ? money(expectedCashAmount()) : "Fechado";
  box.innerHTML = `
    <div class="metric"><span>Vendas hoje</span><strong>${money(t.total)}</strong></div>
    <div class="metric"><span>Lucro hoje</span><strong>${money(t.profit)}</strong></div>
    <div class="metric"><span>Caixa</span><strong>${cashLabel}</strong></div>
    <div class="metric"><span>Produtos cadastrados</span><strong>${db.products.length}</strong></div>
  `;
}

// v0.5 - Módulo 2: Clientes (construído a partir das vendas já registradas).
function buildClientsData(){
  const map = new Map();
  let unidentifiedCount = 0;
  let unidentifiedTotal = 0;

  db.sales.forEach(s => {
    if(s.cancelled) return;
    const name = (s.customer || "").trim();
    const phone = (s.phone || "").trim();
    if(!name && !phone){
      unidentifiedCount += 1;
      unidentifiedTotal += Number(s.total || 0);
      return;
    }
    const key = phone || ("nome:" + name.toLowerCase());
    if(!map.has(key)) map.set(key, {name: name || "Não informado", phone, total:0, count:0, lastPurchase:null});
    const row = map.get(key);
    if(name) row.name = name;
    if(phone) row.phone = phone;
    row.total += Number(s.total || 0);
    row.count += 1;
    const dt = parseSaleDateTime(s);
    if(!row.lastPurchase || dt > row.lastPurchase) row.lastPurchase = dt;
  });

  const clients = Array.from(map.values()).sort((a,b) => b.total - a.total);
  return {clients, unidentifiedCount, unidentifiedTotal};
}
function renderClients(){
  const box = document.getElementById("clientsList");
  if(!box) return;
  const {clients, unidentifiedCount, unidentifiedTotal} = buildClientsData();

  if(!clients.length){
    box.innerHTML = `<p class="muted">Nenhum cliente identificado ainda. Preencha nome ou telefone na venda para começar a lista.</p>`;
    return;
  }

  box.innerHTML = clients.map(c => `
    <div class="summary-row">
      <span>
        <strong>${escapeHTML(c.name)}</strong>${c.phone ? " · " + escapeHTML(c.phone) : ""}<br>
        <small>${c.count} compra(s) · ticket médio ${money(c.total / c.count)} · última compra ${c.lastPurchase ? c.lastPurchase.toLocaleDateString("pt-BR") : "-"}</small>
      </span>
      <strong>${money(c.total)}</strong>
    </div>
  `).join("") + (unidentifiedCount ? `
    <div class="summary-row">
      <span><strong>Vendas sem cliente identificado</strong><br><small>${unidentifiedCount} venda(s) sem nome nem telefone</small></span>
      <strong>${money(unidentifiedTotal)}</strong>
    </div>` : "");
}

// v0.5 - Módulo 2: Vendedores (cadastro e comissão local).
function renderSellersAdmin(){
  const box = document.getElementById("sellersAdminList");
  if(!box) return;
  const todaySummary = new Map(sellerSummary(todaySales()).map(r => [r.number, r]));
  box.innerHTML = db.sellers.map(s => {
    const today = todaySummary.get(Number(s.number)) || {total:0, count:0};
    return `
    <div class="summary-row ${s.active === false ? "cancelled" : ""}">
      <span>
        <strong>Vendedor ${s.number}: ${escapeHTML(s.name)}</strong> ${s.active === false ? '<span class="badge">Inativo</span>' : ""}<br>
        <small>Comissão local: ${Number(s.commissionPercent || 0)}% · Hoje: ${today.count} venda(s), ${money(today.total)}</small>
      </span>
      <span>
        <button class="btn ghost" onclick="editSeller(${s.number})">Editar</button>
        <button class="btn ghost" onclick="toggleSellerActive(${s.number})">${s.active === false ? "Ativar" : "Desativar"}</button>
      </span>
    </div>`;
  }).join("") || `<p class="muted">Nenhum vendedor cadastrado.</p>`;
}
function clearSellerForm(){
  document.getElementById("sellerNumber").value = "";
  document.getElementById("sellerName").value = "";
  document.getElementById("sellerCommission").value = "0";
}
function editSeller(number){
  const seller = db.sellers.find(s => Number(s.number) === Number(number));
  if(!seller) return;
  document.getElementById("sellerNumber").value = seller.number;
  document.getElementById("sellerName").value = seller.name;
  document.getElementById("sellerCommission").value = Number(seller.commissionPercent || 0);
}
function saveSeller(){
  const name = text("sellerName");
  if(!name){
    alert("Informe o nome do vendedor.");
    return;
  }
  let commission = Number(document.getElementById("sellerCommission").value || 0);
  if(isNaN(commission)) commission = 0;
  commission = Math.max(0, Math.min(100, commission));

  const numberField = document.getElementById("sellerNumber").value;
  if(numberField){
    const seller = db.sellers.find(s => Number(s.number) === Number(numberField));
    if(seller){
      seller.name = name;
      seller.commissionPercent = commission;
      logAction("Vendedor editado", `Vendedor ${seller.number}: ${name}`);
    }
  }else{
    const nextNumber = db.sellers.length ? Math.max(...db.sellers.map(s => Number(s.number))) + 1 : 1;
    db.sellers.push({number: nextNumber, name, commissionPercent: commission, active: true});
    logAction("Vendedor criado", `Vendedor ${nextNumber}: ${name}`);
  }
  saveDB();
  clearSellerForm();
  renderAll();
}
function toggleSellerActive(number){
  const seller = db.sellers.find(s => Number(s.number) === Number(number));
  if(!seller) return;
  const activating = seller.active === false;
  if(!activating && !confirm("Desativar este vendedor? Ele deixa de aparecer no Caixa, mas o histórico de vendas dele continua intacto.")) return;
  seller.active = activating ? true : false;
  saveDB();
  logAction(activating ? "Vendedor reativado" : "Vendedor desativado", `Vendedor ${seller.number}: ${seller.name}`);
  renderAll();
}

// v0.5 - Módulo 2: Configurações (segurança e regras, antes só editáveis no código).
function renderConfig(){
  const lowStockInput = document.getElementById("cfgLowStock");
  if(lowStockInput && document.activeElement !== lowStockInput) lowStockInput.value = db.settings.lowStockAlert;
  const maxDiscountInput = document.getElementById("cfgMaxDiscount");
  if(maxDiscountInput && document.activeElement !== maxDiscountInput) maxDiscountInput.value = db.settings.maxDiscountPercent;
  applyDiscountSettingsToUI();

  const userEmailEl = document.getElementById("currentUserEmail");
  if(userEmailEl){
    const email = (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.email : (db.currentUser?.email || "Não conectado");
    userEmailEl.textContent = email;
  }

  const deviceNameInput = document.getElementById("cfgDeviceName");
  if(deviceNameInput && document.activeElement !== deviceNameInput) deviceNameInput.value = getDeviceName() === "Computador sem nome" ? "" : getDeviceName();
}
function saveDeviceNameSetting(){
  const name = text("cfgDeviceName");
  if(!name){
    alert("Dê um nome para este computador (por exemplo: Caixa 1 - Frente).");
    return;
  }
  setDeviceName(name);
  renderAll();
  alert("Nome deste computador salvo.");
}
function renderDeviceInfo(){
  const box = document.getElementById("deviceInfoBox");
  if(!box) return;
  box.innerHTML = `
    <div class="summary-row">
      <span>Nome deste computador</span>
      <strong>${escapeHTML(getDeviceName())}</strong>
    </div>
  `;
}
function applyDiscountSettingsToUI(){
  const max = Number(db.settings.maxDiscountPercent ?? 80);
  const discountInput = document.getElementById("discountPercent");
  if(discountInput) discountInput.max = max;
  const hint = document.getElementById("discountHint");
  if(hint) hint.textContent = `Permitido de 0% até ${max}%. Padrão: 0%.`;
}
function saveRuleSettings(){
  let lowStock = Number(document.getElementById("cfgLowStock").value || 0);
  if(isNaN(lowStock) || lowStock < 0) lowStock = 0;
  let maxDiscount = Number(document.getElementById("cfgMaxDiscount").value || 0);
  if(isNaN(maxDiscount) || maxDiscount < 0) maxDiscount = 0;
  if(maxDiscount > 100) maxDiscount = 100;

  db.settings.lowStockAlert = lowStock;
  db.settings.maxDiscountPercent = maxDiscount;
  saveDB();
  logAction("Regras alteradas", `Estoque baixo: ${lowStock} un. · Desconto máximo: ${maxDiscount}%`);
  renderAll();
  alert("Regras atualizadas com sucesso.");
}

function renderAdminProducts(){
  const list = document.getElementById("adminProductList");
  list.innerHTML = db.products.map(p => {
    const margin = Number(p.price) > 0 ? ((Number(p.price) - Number(p.cost)) / Number(p.price) * 100) : 0;
    return `
    <div class="admin-product-row">
      <div>
        <strong>${escapeHTML(p.name)}</strong> <span class="badge">${p.type === "servico" ? "Serviço" : "Produto"}</span> ${p.pendingReview ? '<span class="badge warn-badge">Pendente revisão</span>' : ''}<br>
        <small>${escapeHTML(p.category)} | Custo: ${money(p.cost)} | Venda: ${money(p.price)} | Margem: ${margin.toFixed(1)}% | Estoque: ${p.type === "servico" ? "serviço" : p.stock}</small>
        ${p.pendingReview ? `<br><small> Criado pelo vendedor ${p.createdBySellerNumber || "-"}: ${escapeHTML(p.createdBySellerName || "")}. Complete o custo para corrigir lucro e comissão.</small>` : ""}
      </div>
      <div class="product-actions">
        <button class="btn ghost" onclick="editProduct('${p.id}')">Editar</button>
        <button class="btn danger" onclick="deleteProduct('${p.id}')">Eliminar</button>
      </div>
    </div>
  `;
  }).join("");
}
function deleteProduct(id){
  const product = db.products.find(p => p.id === id);
  if(!product) return;

  const message = `Você está eliminando de forma permanente o produto "${product.name}". Deseja continuar?\n\nAs vendas realizadas anteriormente com este produto NÃO serão apagadas.`;
  if(!confirm(message)) return;

  db.products = db.products.filter(p => p.id !== id);
  deleteProductFromFirestore(id);
  saveDB();
  logAction("Produto excluído", product.name);
  renderAll();
  autoBackupAfterSale();
  syncMobilePanel(true, "produto eliminado pelo administrador");
  alert("Produto eliminado com sucesso. As vendas anteriores foram mantidas no histórico.");
}

// v1.0 - Módulo 16: importação em massa de produtos. Aceita texto colado ou arquivo CSV,
// separado por ; ou , com cabeçalho na primeira linha. Se o SKU já existir, atualiza o
// produto (upsert); senão, cria um novo. Nunca apaga produtos que não estejam na lista.
function normalizeHeaderKey(key){
  return String(key).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function parseImportCSV(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if(!lines.length) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delimiter).map(h => normalizeHeaderKey(h));
  return lines.slice(1).map(line => {
    const cells = line.split(delimiter).map(c => c.trim());
    const obj = {};
    header.forEach((h, i) => obj[h] = (cells[i] ?? "").trim());
    return obj;
  });
}
function analyzeProductImport(text){
  const rows = parseImportCSV(text);
  const toCreate = [];
  const toUpdate = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const get = (...keys) => {
      for(const k of keys){ if(row[k]) return row[k]; }
      return "";
    };
    const name = get("nome", "produto", "name", "descricao");
    if(!name){
      errors.push(`Linha ${idx + 2}: sem nome, ignorada.`);
      return;
    }
    const category = get("categoria", "category") || db.categories[0] || "Outros";
    const typeRaw = get("tipo", "type").toLowerCase();
    const type = typeRaw.startsWith("serv") ? "servico" : "produto";
    const cost = Number(get("custo", "cost").replace(",", ".")) || 0;
    const price = Number(get("preco", "price", "venda").replace(",", ".")) || 0;
    const stock = Number(get("estoque", "stock", "qtd", "quantidade").replace(",", ".")) || 0;
    const sku = get("sku", "codigo");
    const supplier = get("fornecedor", "supplier");
    const note = get("observacoes", "observacao", "nota", "note");

    if(price <= 0){
      errors.push(`Linha ${idx + 2}: "${escapeHTML(name)}" sem preço de venda válido, ignorada.`);
      return;
    }

    const existing = sku
      ? db.products.find(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase())
      : db.products.find(p => p.name.toLowerCase() === name.toLowerCase());

    const record = {name, category, type, cost, price, stock: type === "servico" ? 0 : stock, sku, supplier, note};
    if(existing) toUpdate.push({id: existing.id, ...record});
    else toCreate.push(record);
  });

  return {toCreate, toUpdate, errors};
}
let pendingProductImport = null;
function analyzeProductImportFromTextarea(){
  const text = document.getElementById("importProductsText").value;
  if(!text.trim()){
    alert("Cole os dados ou selecione um arquivo CSV primeiro.");
    return;
  }
  const result = analyzeProductImport(text);
  pendingProductImport = result;
  const box = document.getElementById("importAnalysis");
  box.innerHTML = `
    <div class="panel inner-panel">
      <div class="summary-row"><span>Produtos novos</span><strong>${result.toCreate.length}</strong></div>
      <div class="summary-row"><span>Produtos que serão atualizados (SKU já existente)</span><strong>${result.toUpdate.length}</strong></div>
      ${result.errors.length ? `<p class="muted">${result.errors.map(e => escapeHTML(e)).join("<br>")}</p>` : ""}
    </div>`;
  const confirmBtn = document.getElementById("confirmImportBtn");
  confirmBtn.classList.toggle("hidden", !(result.toCreate.length || result.toUpdate.length));
}
function confirmProductImport(){
  if(!pendingProductImport) return;
  const {toCreate, toUpdate} = pendingProductImport;
  toCreate.forEach(p => {
    const newProd = {id: uid("prod"), ...p};
    db.products.unshift(newProd);
    saveProductToFirestore(newProd);
  });
  toUpdate.forEach(u => {
    const p = db.products.find(x => x.id === u.id);
    if(p){
      Object.assign(p, {name: u.name, category: u.category, type: u.type, cost: u.cost, price: u.price, stock: u.stock, sku: u.sku, supplier: u.supplier, note: u.note});
      saveProductToFirestore(p);
    }
  });
  saveDB();
  logAction("Importação em massa de produtos", `${toCreate.length} novo(s), ${toUpdate.length} atualizado(s)`);
  pendingProductImport = null;
  document.getElementById("importProductsText").value = "";
  document.getElementById("importAnalysis").innerHTML = "";
  document.getElementById("confirmImportBtn").classList.add("hidden");
  renderAll();
  alert("Importação concluída com sucesso.");
}
function loadImportFile(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("importProductsText").value = reader.result;
  };
  reader.readAsText(file);
}

function saveProduct(){
  const id = document.getElementById("prodId").value;
  const oldProduct = id ? db.products.find(p => p.id === id) : null;
  const product = {
    id: id || uid("p"),
    name: text("prodName"),
    category: document.getElementById("prodCategory").value,
    type: document.getElementById("prodType").value,
    cost: num("prodCost"),
    price: num("prodPrice"),
    stock: num("prodStock"),
    sku: text("prodSku"),
    supplier: text("prodSupplier"),
    note: text("prodNote"),
    pendingReview: false
  };
  if(!product.name || !product.price){
    alert("Nome e preço de venda são obrigatórios.");
    return;
  }
  if(id){
    db.products = db.products.map(p => p.id === id ? product : p);
    if(oldProduct && oldProduct.pendingReview && Number(oldProduct.cost || 0) === 0 && Number(product.cost || 0) > 0){
      updatePendingSaleCosts(product.id, Number(product.cost));
    }
    logAction("Produto editado", product.name);
  }else{
    db.products.unshift(product);
    logAction("Produto criado", product.name);
  }
  saveProductToFirestore(product);
  saveDB();
  clearProductForm();
  renderAll();
}
function updatePendingSaleCosts(productId, newCost){
  db.sales.forEach(sale => {
    let changed = false;
    sale.items.forEach(item => {
      if(item.id === productId && Number(item.cost || 0) === 0){
        item.cost = newCost;
        changed = true;
      }
    });
    if(changed){
      sale.cost = sale.items.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.qty || 0), 0);
      sale.profit = Number(sale.total || 0) - Number(sale.cost || 0) - Number(sale.fee || 0);
    }
  });
}

function editProduct(id){
  const p = db.products.find(x => x.id === id);
  if(!p) return;
  document.getElementById("prodId").value = p.id;
  document.getElementById("prodName").value = p.name;
  document.getElementById("prodCategory").value = p.category;
  document.getElementById("prodType").value = p.type;
  document.getElementById("prodCost").value = p.cost;
  document.getElementById("prodPrice").value = p.price;
  document.getElementById("prodStock").value = p.stock;
  document.getElementById("prodSku").value = p.sku || "";
  document.getElementById("prodSupplier").value = p.supplier || "";
  document.getElementById("prodNote").value = p.note || "";
  document.querySelector('[data-tab="products"]').click();
}
function clearProductForm(){
  ["prodId","prodName","prodCost","prodPrice","prodStock","prodSku","prodSupplier","prodNote"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("prodCategory").value = db.categories[0];
  document.getElementById("prodType").value = "produto";
}

function renderSales(){
  const list = document.getElementById("salesList");
  if(!db.sales.length){
    list.innerHTML = `<p class="muted">Nenhuma venda registrada.</p>`;
    return;
  }
  list.innerHTML = db.sales.map(s => `
    <div class="sale-row ${s.cancelled ? "cancelled" : ""}">
      <div>
        <strong>${money(s.total)}</strong> <span class="badge">${labelPayment(s.payment)}</span> ${s.manualEntry ? '<span class="badge">Manual</span>' : ''} ${s.cancelled ? '<span class="badge">Cancelada</span>' : ''}<br>
        <small>${s.createdAt} | Vendedor ${s.sellerNumber || "-"}: ${escapeHTML(s.sellerName || s.seller)} | Cliente: ${escapeHTML(s.customer || "Não informado")}</small><br>
        <small>Subtotal: ${money(s.subtotal || s.total || 0)} | Desconto: ${money(s.discountAmount || 0)} (${s.discountPercent || 0}%)</small><br>
        <small>Custo: ${money(s.cost)} | Taxa: ${money(s.fee)} | Lucro: ${money(s.profit)} ${s.items.some(i => Number(i.cost || 0) === 0) ? " | Atenção: possível custo pendente" : ""}</small><br>
        <small>${s.items.map(i => `${i.qty}x ${escapeHTML(i.name)}`).join(" • ")}</small>
      </div>
      ${s.cancelled ? "" : `<button class="btn ghost" onclick="cancelSale('${s.id}')">Cancelar</button>`}
    </div>
  `).join("");
}
function cancelSale(id){
  if(!confirm("Cancelar esta venda? Esta ação deve ser feita apenas pelo administrador.")) return;
  const sale = db.sales.find(s => s.id === id);
  if(!sale || sale.cancelled) return;
  sale.cancelled = true;
  sale.items.forEach(item => {
    const p = db.products.find(x => x.id === item.id);
    if(p && p.type === "produto") p.stock = Number(p.stock) + Number(item.qty);
  });
  cancelSaleInFirestore(id);
  saveDB();
  logAction("Venda cancelada", `${money(sale.total)} de ${sale.saleDate || sale.createdAt} - ${escapeHTML(sale.customer || "cliente não identificado")}`);
  renderAll();
}

function renderCashierCashPanel(){
  const box = document.getElementById("cashierCashPanel");
  if(!box) return;
  if(db.cashOpen){
    const expected = expectedCashAmount();
    box.classList.add("cashier-cash-open");
    box.classList.remove("cashier-cash-closed");
    box.innerHTML = `
      <div class="cashier-cash-grid">
        <div>
          <h2>Caixa do dia aberto</h2>
          <p class="muted">Abertura: <strong>${escapeHTML(db.cashOpen.openedAt || "")}</strong> | Valor inicial: <strong>${money(db.cashOpen.initial || db.cashOpen.openingAmount || 0)}</strong></p>
          <p class="muted">Dinheiro esperado no caixa: <strong>${money(expected)}</strong> <small>(fundo inicial + vendas em dinheiro + entradas/retiradas)</small></p>
        </div>
        <div class="cashier-cash-actions">
          <input id="cashierCloseValue" class="input" type="number" step="0.01" placeholder="Valor contado no fechamento" />
          <button class="btn primary" onclick="closeCashFromCashier()">Fechar caixa</button>
        </div>
      </div>`;
  }else{
    box.classList.remove("cashier-cash-open");
    box.classList.add("cashier-cash-closed");
    box.innerHTML = `
      <div class="cashier-cash-grid">
        <div><h2>Abrir caixa do dia</h2><p class="muted">Antes de começar as vendas, informe quanto dinheiro há no caixa.</p></div>
        <div class="cashier-cash-actions">
          <input id="cashierOpenValue" class="input" type="number" step="0.01" placeholder="Valor de abertura" />
          <button class="btn primary" onclick="openCashFromCashier()">Abrir caixa</button>
        </div>
      </div>`;
  }
}
function openCashFromCashier(){
  const input = document.getElementById("cashierOpenValue");
  const value = Number(input?.value || 0);
  const seller = getSelectedSeller();
  const session = { id: uid("cash"), openedAt: nowText(), dateISO: todayISO(), initial: value, openingAmount: value, openedBySellerNumber: seller.number, openedBySellerName: seller.name, closedAt: null };
  db.cashOpen = session;
  const moveOpen = { id: uid("cashlog"), type: "abertura", value, note: `Abertura pelo Caixa - Vendedor ${seller.number}: ${seller.name}`, createdAt: nowText(), dateISO: todayISO(), cashSessionId: session.id, sellerNumber: seller.number, sellerName: seller.name };
  db.cashHistory.unshift(moveOpen);
  saveCashMoveToFirestore(moveOpen);
  saveDB(); renderAll(); autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática"); alert("Caixa aberto com sucesso.");
}
function closeCashFromCashier(){
  if(!db.cashOpen){ alert("Nenhum caixa aberto."); return; }
  const input = document.getElementById("cashierCloseValue");
  const closingAmount = Number(input?.value || 0);
  if(input && input.value === ""){ alert("Informe o valor contado no fechamento."); return; }
  const seller = getSelectedSeller();
  const expected = expectedCashAmount();
  const difference = closingAmount - expected;
  const session = { ...db.cashOpen, closedAt: nowText(), closingAmount, cashSales: currentCashSales(), manualMovements: currentManualCashMovements(), expectedCash: expected, difference, closedBySellerNumber: seller.number, closedBySellerName: seller.name };
  db.cashSessions.unshift(session);
  const moveClose = { id: uid("cashlog"), type: "fechamento", value: closingAmount, note: `Fechamento pelo Caixa - Vendedor ${seller.number}: ${seller.name}. Esperado: ${money(expected)}. Diferença: ${money(difference)}.`, createdAt: nowText(), dateISO: todayISO(), cashSessionId: session.id, sellerNumber: seller.number, sellerName: seller.name, expectedCash: expected, difference };
  db.cashHistory.unshift(moveClose);
  db.cashOpen = null;
  saveCashSessionToFirestore(session);
  saveCashMoveToFirestore(moveClose);
  saveDB(); renderAll(); autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática"); alert("Caixa fechado com sucesso.");
}

function renderCash(){
  const box = document.getElementById("cashStatus");
  if(db.cashOpen){
    box.innerHTML = `
      <div class="summary-row">
        <p>Caixa aberto em: <strong>${db.cashOpen.openedAt}</strong></p>
        <p>Fundo inicial: <strong>${money(db.cashOpen.initial)}</strong></p>
        <p>Vendas de hoje: <strong>${money(totalsToday().total)}</strong></p>
        <button class="btn primary" onclick="closeCash()">Fechar caixa</button>
      </div>
    `;
  }else{
    box.innerHTML = `
      <input id="cashInitial" class="input" type="number" step="0.01" placeholder="Fundo inicial do caixa" />
      <button class="btn primary full" onclick="openCash()">Abrir caixa</button>
    `;
  }
  document.getElementById("cashHistory").innerHTML = db.cashHistory.length ? db.cashHistory.map(h => `
    <div class="cash-row">
      <strong>${h.type}</strong> — ${money(h.value)}<br>
      <small>${h.createdAt} | ${escapeHTML(h.note || "")}</small>
    </div>
  `).join("") : `<p class="muted">Nenhum movimento de caixa registrado.</p>`;
}
function openCash(){
  const value = Number(document.getElementById("cashInitial").value || 0);
  const session = {id:uid("cash"), openedAt:nowText(), dateISO:todayISO(), initial:value, openingAmount:value, openedBySellerNumber:null, openedBySellerName:"Administrador", closedAt:null};
  db.cashOpen = session;
  const moveAdminOpen = {id:uid("cashlog"), type:"abertura", value, note:"Fundo inicial aberto pelo Administrador", createdAt:nowText(), dateISO:todayISO(), cashSessionId:session.id};
  db.cashHistory.unshift(moveAdminOpen);
  saveCashMoveToFirestore(moveAdminOpen);
  saveDB(); renderAll(); autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática");
}
function closeCash(){
  if(!db.cashOpen) return;
  const typed = prompt("Informe o valor final contado no caixa:", "");
  if(typed === null) return;
  const closingAmount = Number(String(typed).replace(",", ".") || 0);
  const expected = expectedCashAmount();
  const difference = closingAmount - expected;
  const session = { ...db.cashOpen, closedAt: nowText(), closingAmount, cashSales: currentCashSales(), manualMovements: currentManualCashMovements(), expectedCash: expected, difference, closedBySellerNumber: null, closedBySellerName: "Administrador" };
  db.cashSessions.unshift(session);
  const moveAdminClose = {id:uid("cashlog"), type:"fechamento", value:closingAmount, note:`Fechamento do caixa pelo Administrador. Esperado: ${money(expected)}. Diferença: ${money(difference)}.`, createdAt:nowText(), dateISO:todayISO(), cashSessionId:session.id, expectedCash:expected, difference};
  db.cashHistory.unshift(moveAdminClose);
  db.cashOpen = null;
  saveCashSessionToFirestore(session);
  saveCashMoveToFirestore(moveAdminClose);
  saveDB(); renderAll(); autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática");
}
function saveCashMovement(){
  const value = num("cashMoveValue");
  const type = document.getElementById("cashMoveType").value;
  const note = text("cashMoveNote");
  if(!value){
    alert("Informe o valor.");
    return;
  }
  const move = {id:uid("cashlog"), type, value, note, createdAt:nowText(), dateISO:todayISO(), cashSessionId:db.cashOpen?.id || null};
  db.cashHistory.unshift(move);
  document.getElementById("cashMoveValue").value = "";
  document.getElementById("cashMoveNote").value = "";
  saveCashMoveToFirestore(move);
  saveDB();
  renderAll();
  autoBackupAfterSale();
  syncMobilePanel(true, "atualização automática");
}

function renderReports(){
  const valid = db.sales.filter(s => !s.cancelled);
  const total = valid.reduce((a,s)=>a+s.total,0);
  const profit = valid.reduce((a,s)=>a+s.profit,0);
  const cost = valid.reduce((a,s)=>a+s.cost,0);
  document.getElementById("reportSummary").innerHTML = `
    <div class="metric"><span>Total geral</span><strong>${money(total)}</strong></div>
    <div class="metric"><span>Custo geral</span><strong>${money(cost)}</strong></div>
    <div class="metric"><span>Lucro geral</span><strong>${money(profit)}</strong></div>
    <div class="metric"><span>Vendas válidas</span><strong>${valid.length}</strong></div>`;

  const sellerBox = document.getElementById("sellerReportSummary");
  if(sellerBox){
    sellerBox.innerHTML = sellerSummary(valid).map(row => `
      <div class="summary-row"><span><strong>Vendedor ${row.number}: ${escapeHTML(row.name)}</strong><br><small>${row.count} venda(s) registrada(s) para cálculo de comissão</small></span><span><strong>${money(row.total)}</strong><br><small>Lucro: ${money(row.profit)}</small></span></div>`).join("") || `<p class="muted">Nenhuma venda válida.</p>`;
  }

  const salesDetail = document.getElementById("salesReportDetail");
  if(salesDetail){
    salesDetail.innerHTML = valid.length ? `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Data</th><th>Hora</th><th>Vendedor</th><th>Pagamento</th><th>Cliente</th><th>Total</th><th>Lucro</th></tr></thead><tbody>${valid.map(s => `<tr><td>${escapeHTML(getSaleDate(s))}</td><td>${escapeHTML(getSaleTime(s))}</td><td>${escapeHTML((s.sellerNumber ? s.sellerNumber + " - " : "") + (s.sellerName || s.seller || ""))}</td><td>${escapeHTML(labelPayment(s.payment))}</td><td>${escapeHTML(s.customer || "Não informado")}</td><td><strong>${money(s.total)}</strong></td><td>${money(s.profit)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nenhuma venda válida.</p>`;
  }

  const cashBox = document.getElementById("cashReportHistory");
  if(cashBox){
    const sessions = db.cashSessions || [];
    cashBox.innerHTML = sessions.length ? `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Data</th><th>Abertura</th><th>Fechamento</th><th>Valor inicial</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th>Fechado por</th></tr></thead><tbody>${sessions.map(c => `<tr><td>${escapeHTML(c.dateISO || "")}</td><td>${escapeHTML(c.openedAt || "")}</td><td>${escapeHTML(c.closedAt || "")}</td><td>${money(c.initial || c.openingAmount || 0)}</td><td>${money(c.expectedCash || 0)}</td><td><strong>${money(c.closingAmount || 0)}</strong></td><td class="${Number(c.difference || 0) >= 0 ? "diff-positive" : "diff-negative"}">${money(c.difference || 0)}</td><td>${escapeHTML(c.closedBySellerName || "Administrador")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nenhum fechamento de caixa registrado ainda.</p>`;
  }
}
function sellerSummary(sales){
  const map = new Map();
  db.sellers.forEach(s => map.set(Number(s.number), {number:Number(s.number), name:s.name, total:0, profit:0, count:0}));
  sales.forEach(s => {
    const n = Number(s.sellerNumber || 1);
    if(!map.has(n)) map.set(n, {number:n, name:s.sellerName || s.seller || "Vendedor", total:0, profit:0, count:0});
    const row = map.get(n);
    row.total += Number(s.total || 0);
    row.profit += Number(s.profit || 0);
    row.count += 1;
  });
  return Array.from(map.values()).sort((a,b) => a.number - b.number);
}

function salesReportRows(){
  const header = ["data","hora","data_hora","vendedor_numero","vendedor_nome","cliente","telefone","pagamento","parcelas","subtotal","desconto_percentual","desconto_valor","total","custo","taxa","lucro","cancelada"];
  const rows = db.sales.map(s => [
    getSaleDate(s), getSaleTime(s), s.createdAt, s.sellerNumber || "", s.sellerName || s.seller || "", s.customer, s.phone, labelPayment(s.payment), s.installments, s.subtotal || s.total || 0, s.discountPercent || 0, s.discountAmount || 0, s.total, s.cost, s.fee, s.profit, s.cancelled ? "sim" : "nao"
  ]);
  return {header, rows};
}
function buildSalesCSV(){
  const {header, rows} = salesReportRows();
  return header.join(";") + "\n" + rows.map(r => r.join(";")).join("\n");
}
function exportCSV(){
  downloadFile("vendas-luna-fem-finance-" + todayISO() + ".csv", buildSalesCSV(), "text/csv;charset=utf-8");
}

// v0.9 - Módulo 15: exportar relatórios em PDF, Excel, CSV e JSON, além do CSV que já existia.
// Excel usa uma tabela HTML salva com extensão .xls - técnica clássica que o Excel reconhece
// nativamente, sem precisar de nenhuma biblioteca externa (importante para um app que funciona
// offline). PDF usa a função de impressão do próprio navegador ("Salvar como PDF"), pelo mesmo
// motivo: zero dependências, funciona sem internet.
function slugify(value){
  return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function downloadRowsAsCSV(base, header, rows){
  const csv = header.join(";") + "\n" + rows.map(r => r.join(";")).join("\n");
  downloadFile(base + ".csv", csv, "text/csv;charset=utf-8");
  logAction("Relatório exportado", base + ".csv (CSV)");
}
function downloadRowsAsExcel(base, title, header, rows){
  const html = `<html><head><meta charset="UTF-8"></head><body>
    <table border="1">
      <tr><td colspan="${header.length}"><strong>${escapeHTML(title)}</strong></td></tr>
      <tr>${header.map(h => `<td><strong>${escapeHTML(String(h))}</strong></td>`).join("")}</tr>
      ${rows.map(r => `<tr>${r.map(c => `<td>${escapeHTML(String(c))}</td>`).join("")}</tr>`).join("")}
    </table>
  </body></html>`;
  downloadFile(base + ".xls", html, "application/vnd.ms-excel");
  logAction("Relatório exportado", base + ".xls (Excel)");
}
function downloadDataAsJSON(base, data){
  downloadFile(base + ".json", JSON.stringify(data, null, 2), "application/json");
  logAction("Relatório exportado", base + ".json (JSON)");
}
function printRowsAsPDF(title, header, rows){
  const area = document.getElementById("printArea");
  if(!area) return;
  area.innerHTML = `
    <h1>${escapeHTML(title)}</h1>
    <p>Luna Fem Finance · gerado em ${new Date().toLocaleString("pt-BR")}</p>
    <table>
      <thead><tr>${header.map(h => `<th>${escapeHTML(String(h))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHTML(String(c))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  window.print();
  logAction("Relatório exportado", title + " (PDF / impressão)");
}
function exportSalesReport(format){
  const {header, rows} = salesReportRows();
  const base = "vendas-luna-fem-finance-" + todayISO();
  const title = "Vendas - Luna Fem Finance";
  if(format === "excel") downloadRowsAsExcel(base, title, header, rows);
  else if(format === "json") downloadDataAsJSON(base, db.sales);
  else if(format === "pdf") printRowsAsPDF(title, header, rows);
}
// Linhas "Item / Valor" a partir de uma análise (mesmo formato usado no Dashboard e Análises).
function analysisReportRows(analysis, extras){
  extras = extras || {};
  const ticketAvg = analysis.count ? analysis.total / analysis.count : 0;
  const rows = [
    ["Vendas", money(analysis.total)],
    ["Lucro", money(analysis.profit)],
    ["Custo", money(analysis.cost)],
    ["Desconto total", money(analysis.discount)],
    ["Qtd. vendas", analysis.count],
    ["Ticket médio", money(ticketAvg)]
  ];
  if(extras.cancelled) rows.push(["Vendas canceladas", `${extras.cancelled.count} (${money(extras.cancelled.total)})`]);
  rows.push(["", ""]);
  rows.push(["Formas de pagamento", ""]);
  Object.entries(analysis.payments).forEach(([k,v]) => rows.push([labelPayment(k), money(v)]));
  rows.push(["", ""]);
  rows.push(["Vendedores", ""]);
  analysis.sellers.filter(s => s.count > 0).forEach(s => rows.push([s.name, `${s.count} venda(s) - ${money(s.total)}`]));
  if(extras.products && extras.products.length){
    rows.push(["", ""]);
    rows.push(["Produtos mais vendidos", ""]);
    extras.products.forEach(p => rows.push([p.name, `${p.qty} un. - ${money(p.revenue)}`]));
  }
  if(extras.cash && extras.cash.count){
    rows.push(["", ""]);
    rows.push(["Caixa", ""]);
    rows.push(["Fechamentos no período", extras.cash.count]);
    rows.push(["Diferença total", money(extras.cash.totalDifference)]);
  }
  return rows;
}
function analysisReportJSON(analysis, extras){
  extras = extras || {};
  return {
    periodo: analysis.label,
    vendas: analysis.total, lucro: analysis.profit, custo: analysis.cost, desconto: analysis.discount,
    qtdVendas: analysis.count, formasPagamento: analysis.payments,
    vendedores: analysis.sellers.filter(s => s.count > 0),
    produtosMaisVendidos: extras.products || [],
    canceladas: extras.cancelled || null,
    caixa: extras.cash || null
  };
}
function exportAnalysisPeriod(format){
  if(!currentAnalysisSnapshot) return;
  const {analysis, cash, cancelled, products, label, start, end} = currentAnalysisSnapshot;
  const base = "analise-" + slugify(label) + "-" + localISODate(start);
  const title = `Análise ${label} · ${start.toLocaleDateString("pt-BR")} até ${end.toLocaleDateString("pt-BR")}`;
  const rows = analysisReportRows(analysis, {cash, cancelled, products});
  if(format === "excel") downloadRowsAsExcel(base, title, ["Item","Valor"], rows);
  else if(format === "csv") downloadRowsAsCSV(base, ["Item","Valor"], rows);
  else if(format === "json") downloadDataAsJSON(base, analysisReportJSON(analysis, {cash, cancelled, products}));
  else if(format === "pdf") printRowsAsPDF(title, ["Item","Valor"], rows);
}

// v0.9 - Lançamento manual de venda pelo Administrador: mesmo formato de dados de uma
// venda normal (entra igual em Dashboard, Análises, Clientes, Relatórios), mas com data/hora
// e vendedor escolhidos à mão. Propositalmente mais simples que o carrinho do Caixa (sem
// pagamento misto/parcelamento) - é para lançar vendas esquecidas, não para o dia a dia.
let manualSaleItems = [];
function renderManualSaleSellers(){
  const select = document.getElementById("manualSaleSeller");
  if(!select) return;
  const dtInput = document.getElementById("manualSaleDateTime");
  if(dtInput && !dtInput.value){
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.max = now.toISOString().slice(0, 16);
    dtInput.value = now.toISOString().slice(0, 16);
  }
  const activeSellers = Array.isArray(db.sellers) ? db.sellers.filter(s => s.active !== false) : [];
  const list = activeSellers.length ? activeSellers : (db.sellers || []);
  const current = select.value;
  if(!list.length){
    select.innerHTML = `<option value="">Nenhum vendedor cadastrado</option>`;
    return;
  }
  select.innerHTML = list.map(s => `<option value="${s.number}">${s.number} - ${escapeHTML(s.name)}</option>`).join("");
  if(current && list.some(s => String(s.number) === String(current))){
    select.value = current;
  }else if(list[0]){
    select.value = String(list[0].number);
  }
}
function renderManualSaleProductPicker(){
  const input = document.getElementById("manualProductSearch");
  const list = document.getElementById("manualProductList");
  if(!input || !list) return;
  const q = input.value.toLowerCase();
  const products = db.products.filter(p => [p.name, p.category, p.sku].join(" ").toLowerCase().includes(q));
  list.innerHTML = products.slice(0, 30).map(p => `
    <button type="button" class="manual-product-pick" onclick="addToManualSale('${p.id}')">
      <span>${escapeHTML(p.name)}</span><strong>${money(p.price)}</strong>
    </button>
  `).join("") || `<p class="muted">Nenhum produto encontrado.</p>`;
}
function addToManualSale(id){
  const p = db.products.find(x => x.id === id);
  if(!p) return;
  const item = manualSaleItems.find(x => x.id === id);
  if(item) item.qty += 1;
  else manualSaleItems.push({id: p.id, name: p.name, qty: 1, price: Number(p.price), cost: Number(p.cost || 0)});
  renderManualSaleCart();
}
function removeManualSaleItem(id){
  manualSaleItems = manualSaleItems.filter(i => i.id !== id);
  renderManualSaleCart();
}
function setManualSaleQty(id, value){
  const item = manualSaleItems.find(i => i.id === id);
  if(!item) return;
  item.qty = Math.max(1, Number(value || 1));
  renderManualSaleCart();
}
function manualSaleTotals(){
  const subtotal = manualSaleItems.reduce((a,i) => a + i.price * i.qty, 0);
  const cost = manualSaleItems.reduce((a,i) => a + i.cost * i.qty, 0);
  let discountPercent = Number(document.getElementById("manualDiscountPercent")?.value || 0);
  if(isNaN(discountPercent)) discountPercent = 0;
  const max = Number(db.settings.maxDiscountPercent ?? 80);
  discountPercent = Math.max(0, Math.min(max, discountPercent));
  const discountAmount = subtotal * discountPercent / 100;
  const total = Math.max(0, subtotal - discountAmount);
  const profit = total - cost;
  return {subtotal, discountPercent, discountAmount, total, cost, profit};
}
function renderManualSaleCart(){
  const list = document.getElementById("manualCartList");
  if(!list) return;
  list.innerHTML = manualSaleItems.length ? manualSaleItems.map(i => `
    <div class="cart-item">
      <div class="cart-item-top">
        <div><strong>${escapeHTML(i.name)}</strong><br><small>${money(i.price)} cada</small></div>
        <button type="button" class="btn ghost" onclick="removeManualSaleItem('${i.id}')">Remover</button>
      </div>
      <div class="qty-row">
        <span>Qtd.</span>
        <input class="input" type="number" min="1" value="${i.qty}" onchange="setManualSaleQty('${i.id}', this.value)" />
        <strong>${money(i.price * i.qty)}</strong>
      </div>
    </div>
  `).join("") : `<div class="cart-empty">Nenhum produto adicionado.</div>`;

  const totalEl = document.getElementById("manualCartTotal");
  if(totalEl) totalEl.textContent = money(manualSaleTotals().total);
}
function finishManualSale(){
  if(!manualSaleItems.length){
    alert("Adicione ao menos um produto.");
    return;
  }
  const dtValue = document.getElementById("manualSaleDateTime").value;
  if(!dtValue){
    alert("Informe a data e hora da venda.");
    return;
  }
  const saleDateObj = new Date(dtValue);
  if(isNaN(saleDateObj.getTime())){
    alert("Data e hora inválidas.");
    return;
  }
  if(saleDateObj.getTime() > Date.now() + 60000){
    alert("Não é possível lançar uma venda no futuro.");
    return;
  }
  const sellerSelect = document.getElementById("manualSaleSeller");
  const sellerNumber = Number(sellerSelect ? sellerSelect.value : 0);
  const seller = (db.sellers || []).find(s => Number(s.number) === sellerNumber);
  if(!seller){
    alert("Selecione um vendedor.");
    return;
  }
  const pay = document.getElementById("manualSalePayment").value;
  const t = manualSaleTotals();

  const sale = {
    id: uid("sale"),
    createdAt: saleDateObj.toLocaleString("pt-BR"),
    saleDate: saleDateObj.toLocaleDateString("pt-BR"),
    saleTime: saleDateObj.toLocaleTimeString("pt-BR"),
    dateISO: localISODate(saleDateObj),
    sellerNumber: seller.number,
    sellerName: seller.name,
    seller: seller.name,
    deviceName: getDeviceName(),
    customer: text("manualCustomerName"),
    phone: text("manualCustomerPhone"),
    payment: pay,
    mixed: null,
    installments: 1,
    cardFeePercent: 0,
    subtotal: t.subtotal,
    discountPercent: t.discountPercent,
    discountAmount: t.discountAmount,
    total: t.total,
    cost: t.cost,
    fee: 0,
    profit: t.profit,
    note: text("manualSaleNote"),
    items: manualSaleItems.map(i => ({id: i.id, name: i.name, qty: i.qty, price: i.price, cost: i.cost})),
    cancelled: false,
    manualEntry: true
  };

  sale.items.forEach(item => {
    const product = db.products.find(p => p.id === item.id);
    if(product && product.type === "produto"){
      product.stock = Number(product.stock || 0) - Number(item.qty);
    }
  });

  db.sales.unshift(sale);
  saveSaleToFirestore(sale);
  saveDB();
  logAction("Venda manual lançada", `${money(sale.total)} em ${sale.saleDate} · vendedor ${seller.name}`);

  manualSaleItems = [];
  ["manualCustomerName","manualCustomerPhone","manualSaleNote","manualProductSearch"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = "";
  });
  const discountInput = document.getElementById("manualDiscountPercent");
  if(discountInput) discountInput.value = 0;
  const dtInput = document.getElementById("manualSaleDateTime");
  if(dtInput) dtInput.value = "";

  renderAll();
  autoBackupAfterSale();
  syncMobilePanel(true, "venda manual lançada pelo administrador");
  alert("Venda manual registrada com sucesso.");
}

// v1.2 - Backup liviano
function buildLightBackup(){
  return {backupFormat:"LUNA_FEM_FINANCE_LIGHT_V1",backupType:"light",generatedAt:new Date().toISOString(),included:["settings","sellers","categories","products","sales"],omitted:["cashHistory","cashSessions","syncHistory","actionHistory","currentUser","cashOpen"],stats:{products:Array.isArray(db.products)?db.products.length:0,sales:Array.isArray(db.sales)?db.sales.length:0,sellers:Array.isArray(db.sellers)?db.sellers.length:0},settings:structuredClone(db.settings||{}),sellers:structuredClone(db.sellers||[]),categories:structuredClone(db.categories||[]),products:structuredClone(db.products||[]),sales:structuredClone(db.sales||[])};
}
function buildFullBackup(){ return structuredClone(db); }
function lightBackupFileName(){ const stamp=new Date().toISOString().replace(/[:]/g,"-").slice(0,19); return "backup-luna-fem-finance-light-"+stamp+".json"; }
function fullBackupFileName(){ const stamp=new Date().toISOString().replace(/[:]/g,"-").slice(0,19); return "backup-luna-fem-finance-full-"+stamp+".json"; }
function downloadLightBackup(){ const payload=buildLightBackup(); downloadFile(lightBackupFileName(),JSON.stringify(payload),"application/json"); logSyncEvent("Backup local ligero","sucesso","Backup liviano descargado por el Administrador."); }
function downloadFullBackup(){ downloadFile(fullBackupFileName(),JSON.stringify(buildFullBackup()),"application/json"); logSyncEvent("Backup local completo","sucesso","Backup completo descargado por el Administrador."); }
function downloadBackup(){ downloadLightBackup(); }

// v0.6 - Módulo 8: Histórico de sincronização (backups, Drive, Painel Mobile, fusões).
function logSyncEvent(tipo, resultado, detalhe){
  const now = new Date();
  db.syncHistory.unshift({
    id: uid("sync"),
    dateISO: todayISO(),
    dateText: now.toLocaleDateString("pt-BR"),
    timeText: now.toLocaleTimeString("pt-BR"),
    tipo,
    usuario: db.currentUser?.name || "Sistema",
    resultado,
    detalhe: detalhe || ""
  });
  // Mantém no máximo 200 registros para o histórico não crescer sem limite.
  if(db.syncHistory.length > 200) db.syncHistory.length = 200;
  saveDB();
}
function renderSyncHistory(){
  const box = document.getElementById("syncHistoryList");
  if(!box) return;
  const entries = db.syncHistory.slice(0, 50);
  box.innerHTML = entries.length ? entries.map(e => `
    <div class="summary-row sync-row ${e.resultado === "erro" ? "cancelled" : ""}">
      <span>
        <strong>${escapeHTML(e.tipo)}</strong> ${e.resultado === "erro" ? '<span class="badge badge-error">Erro</span>' : '<span class="badge badge-ok">Sucesso</span>'}<br>
        <small>${e.dateText} ${e.timeText} · ${escapeHTML(e.usuario)}</small>
        ${e.detalhe ? `<br><small>${escapeHTML(e.detalhe)}</small>` : ""}
      </span>
    </div>
  `).join("") : `<p class="muted">Nenhuma sincronização ou backup registrado ainda.</p>`;
}
function clearSyncHistory(){
  if(!confirm("Limpar todo o histórico de sincronização? Isso não afeta backups nem vendas, só a lista de registros.")) return;
  db.syncHistory = [];
  saveDB();
  renderAll();
}
// v0.9 - Módulo 14: histórico de ações. Registra mudanças sensíveis (produtos, vendas
// canceladas, vendedores, senhas, regras) para auditoria - separado do histórico de
// sincronização, que é só sobre backups/sync.
function logAction(action, detail){
  const now = new Date();
  db.actionHistory.unshift({
    id: uid("action"),
    dateISO: todayISO(),
    dateText: now.toLocaleDateString("pt-BR"),
    timeText: now.toLocaleTimeString("pt-BR"),
    usuario: db.currentUser?.name || "Sistema",
    action,
    detail: detail || ""
  });
  if(db.actionHistory.length > 300) db.actionHistory.length = 300;
  saveDB();
}
function renderActionHistory(){
  const box = document.getElementById("actionHistoryList");
  if(!box) return;
  const entries = db.actionHistory.slice(0, 60);
  box.innerHTML = entries.length ? entries.map(e => `
    <div class="summary-row sync-row">
      <span>
        <strong>${escapeHTML(e.action)}</strong><br>
        <small>${e.dateText} ${e.timeText} · ${escapeHTML(e.usuario)}</small>
        ${e.detail ? `<br><small>${escapeHTML(e.detail)}</small>` : ""}
      </span>
    </div>
  `).join("") : `<p class="muted">Nenhuma ação registrada ainda.</p>`;
}
function clearActionHistory(){
  if(!confirm("Limpar todo o histórico de ações? Isso não afeta produtos, vendas nem vendedores, só a lista de registros.")) return;
  db.actionHistory = [];
  saveDB();
  renderAll();
}
// Para eventos automáticos/silenciosos (uma venda a cada poucos minutos): registra no máximo
// uma vez por dia por tipo+resultado, para o histórico não virar uma lista gigante e inútil.
function logSyncEventThrottled(tipo, resultado, detalhe){
  const today = todayISO();
  const already = db.syncHistory.find(e => e.tipo === tipo && e.resultado === resultado && e.dateISO === today);
  if(already) return;
  logSyncEvent(tipo, resultado, detalhe);
}

function driveSupported(){
  return "showDirectoryPicker" in window;
}
function openHandleDB(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRIVE_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRIVE_HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveStoredDirectoryHandle(handle){
  const database = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DRIVE_HANDLE_STORE, "readwrite");
    tx.objectStore(DRIVE_HANDLE_STORE).put(handle, DRIVE_HANDLE_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function getStoredDirectoryHandle(){
  const database = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DRIVE_HANDLE_STORE, "readonly");
    const request = tx.objectStore(DRIVE_HANDLE_STORE).get(DRIVE_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function clearStoredDirectoryHandle(){
  const database = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DRIVE_HANDLE_STORE, "readwrite");
    tx.objectStore(DRIVE_HANDLE_STORE).delete(DRIVE_HANDLE_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function verifyPermission(handle, readWrite){
  if(!handle) return false;
  const options = readWrite ? {mode:"readwrite"} : {};
  if((await handle.queryPermission(options)) === "granted") return true;
  if((await handle.requestPermission(options)) === "granted") return true;
  return false;
}
async function chooseDriveFolder(){
  if(!driveSupported()){
    alert("Seu navegador não permite escolher uma pasta diretamente. Use Google Chrome ou Microsoft Edge atualizado.");
    return;
  }
  try{
    const handle = await window.showDirectoryPicker({
      id: "luna-fem-finance-backups",
      mode: "readwrite"
    });
    const allowed = await verifyPermission(handle, true);
    if(!allowed){
      alert("Permissão negada para gravar nesta pasta.");
      return;
    }
    await saveStoredDirectoryHandle(handle);
    renderCloudStatus();
    logSyncEvent("Configuração da pasta do Drive", "sucesso", `Pasta selecionada: ${handle.name}`);

    // Teste imediato: grava um backup leve verificável assim que a pasta é escolhida.
    // Isso evita que a aplicação fique com uma pasta configurada mas sem um primeiro
    // arquivo de backup válido.
    try{
      await writeLightBackupPair(buildLightBackup(), false);
      logSyncEvent("Backup inicial Google Drive (leve)", "sucesso", "Primeiro backup leve salvo e verificado ao configurar a pasta.");
    }catch(backupError){
      logSyncEvent("Backup inicial Google Drive (leve)", "erro", backupError.message);
      console.warn("Não foi possível criar o backup inicial após escolher a pasta:", backupError);
    }

    // v0.6 - Módulo 7: sincronização inteligente. Antes de seguir, verifica se já existe
    // um backup nesta pasta (por exemplo, salvo por outro computador) para nunca sobrescrever
    // informação sem avisar o Administrador.
    await checkExistingDriveBackup(handle);

    alert("Pasta do Google Drive configurada com sucesso.");
  }catch(error){
    if(error && error.name !== "AbortError"){
      alert("Não foi possível configurar a pasta: " + error.message);
      logSyncEvent("Configuração da pasta do Drive", "erro", error.message);
    }
  }
}
// v0.6 - Módulo 7: descobre se a pasta já tem um backup de outra máquina e oferece fundir
// em vez de simplesmente sobrescrever na próxima vez que este computador salvar ali.
async function checkExistingDriveBackup(handle){
  try{
    const fileHandle = await handle.getFileHandle("ultimo-backup-luna-fem-finance.json", {create:false});
    const file = await fileHandle.getFile();
    const remoteRaw = JSON.parse(await file.text());
    if(!remoteRaw.sales || !remoteRaw.products) return false;

    const remote = migrateDB(structuredClone(remoteRaw));
    const localSaleIds = new Set(db.sales.map(s => s.id));
    const newSalesFromRemote = remote.sales.filter(s => !localSaleIds.has(s.id));

    if(newSalesFromRemote.length){
      const wantsMerge = confirm(
        `Encontramos um backup nesta pasta com ${newSalesFromRemote.length} venda(s) que não estão neste computador ` +
        `(provavelmente salvo por outra máquina). Deseja fundir automaticamente essas informações agora, sem perder nada? Recomendado: Sim.`
      );
      if(wantsMerge){
        const {merged, report} = mergeBackups(db, remote);
        db = merged;
        saveDB();
        renderAll();
        logSyncEvent("Sincronização inteligente (Drive)", "sucesso", `${report.salesAdded} venda(s) incorporada(s) da pasta do Drive.`);
        alert(`Fusão concluída: ${report.salesAdded} venda(s) incorporada(s).`);
      }else{
        logSyncEvent("Sincronização inteligente (Drive)", "sucesso", `${newSalesFromRemote.length} venda(s) divergente(s) encontrada(s); Administrador optou por não fundir agora.`);
      }
      return true;
    }
    return false;
  }catch(error){
    // Se o arquivo ainda não existir (primeira vez usando esta pasta), não há nada para comparar.
    if(error.name !== "NotFoundError"){
      console.warn("Não foi possível comparar com backup existente na pasta:", error);
    }
    return false;
  }
}
// v0.7 - Módulo 10: verificação sob demanda, não só na hora de escolher a pasta.
// É o botão que dá a um dono de loja com várias caixas uma forma simples de reconciliar
// os computadores sempre que quiser, sem esperar reconfigurar a pasta do zero.
async function checkOtherComputersNow(){
  if(!driveSupported()){
    alert("Seu navegador não permite acessar pastas diretamente. Use Google Chrome ou Microsoft Edge atualizado.");
    return;
  }
  const handle = await getStoredDirectoryHandle();
  if(!handle){
    alert("Primeiro escolha a pasta do Google Drive em Sincronização.");
    return;
  }
  const allowed = await verifyPermission(handle, true);
  if(!allowed){
    alert("Permissão negada. Escolha a pasta novamente.");
    return;
  }
  const found = await checkExistingDriveBackup(handle);
  if(!found){
    alert("Nenhuma novidade encontrada. Este computador já está em dia com o backup desta pasta.");
  }
}
async function writeTextFileToDrive(filename, content){
  const handle = await getStoredDirectoryHandle();
  if(!handle){
    alert("Primeiro escolha a pasta do Google Drive.");
    return false;
  }
  const allowed = await verifyPermission(handle, true);
  if(!allowed){
    alert("Permissão negada. Escolha a pasta novamente.");
    return false;
  }
  const fileHandle = await handle.getFileHandle(filename, {create:true});
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}
function backupFileName(){
  const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  return "backup-luna-fem-finance-" + stamp + ".json";
}
function csvFileName(){
  const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  return "relatorio-vendas-luna-fem-finance-" + stamp + ".csv";
}
// v1.5 - Backup leve Google Drive: gravação verificável, arquivo diário + ponteiro "último".
// O backup diário continua pequeno e não carrega histórico pesado de caixa/auditoria.
let driveBackupInProgress = false;

async function verifyDriveBackupFile(handle, filename, expectedStats){
  const fh = await handle.getFileHandle(filename, {create:false});
  const file = await fh.getFile();
  const text = await file.text();
  const parsed = JSON.parse(text);
  if(parsed.backupFormat !== "LUNA_FEM_FINANCE_LIGHT_V1" || parsed.backupType !== "light") {
    throw new Error("O arquivo foi salvo, mas o formato do backup leve não pôde ser validado.");
  }
  if(expectedStats && (parsed.stats?.sales !== expectedStats.sales || parsed.stats?.products !== expectedStats.products)){
    throw new Error("O backup foi salvo, mas a validação encontrou uma quantidade diferente de vendas/produtos.");
  }
  return true;
}

async function writeLightBackupPair(payload, includeTimestamp=true){
  const content = JSON.stringify(payload);
  const dailyFile = "auto-backup-luna-fem-finance-light-" + todayISO() + ".json";
  const latestFile = "ultimo-backup-luna-fem-finance-light.json";
  const manualFile = includeTimestamp ? lightBackupFileName() : null;
  const targets = includeTimestamp ? [manualFile, latestFile] : [dailyFile, latestFile];
  const handle = await getStoredDirectoryHandle();
  if(!handle) throw new Error("Nenhuma pasta do Google Drive foi configurada.");
  if(!(await verifyPermission(handle, true))) throw new Error("O acesso de gravação à pasta do Google Drive não está autorizado.");

  for(const filename of targets){
    const fh = await handle.getFileHandle(filename, {create:true});
    const writable = await fh.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch(error){
      try { await writable.abort(); } catch(_) {}
      throw error;
    }
    await verifyDriveBackupFile(handle, filename, payload.stats);
  }
  return {handle, targets};
}

async function saveBackupToDrive(silent=false){
  if(driveBackupInProgress) return false;
  driveBackupInProgress = true;
  try{
    const payload = buildLightBackup();
    await writeLightBackupPair(payload, true);
    localStorage.setItem(LAST_BACKUP_KEY, todayISO());
    localStorage.setItem(LAST_AUTO_BACKUP_KEY, new Date().toLocaleString("pt-BR"));
    renderCloudStatus();
    logSyncEvent("Backup Google Drive (leve)", "sucesso", `Backup leve verificado: ${payload.stats.products} produto(s), ${payload.stats.sales} venda(s).`);
    if(!silent){
      alert("Backup leve salvo e verificado no Google Drive.\n\nProdutos: " + payload.stats.products + "\nVendas: " + payload.stats.sales + "\n\nTambém foi atualizado o arquivo de último backup.");
    }
    return true;
  }catch(error){
    console.error("Erro ao salvar backup leve no Drive:", error);
    if(!silent){
      alert("Não foi possível salvar o backup no Google Drive.\n\n" + error.message);
      logSyncEvent("Backup Google Drive (leve)", "erro", error.message);
    }
    return false;
  }finally{
    driveBackupInProgress = false;
  }
}

async function saveFullBackupToDrive(){
  if(driveBackupInProgress){ alert("Já existe um backup em andamento. Aguarde terminar."); return; }
  driveBackupInProgress = true;
  try{
    const content = JSON.stringify(buildFullBackup());
    const ok = await writeTextFileToDrive(fullBackupFileName(), content);
    if(ok){
      alert("Backup completo salvo no Google Drive.");
      logSyncEvent("Backup Google Drive (completo)", "sucesso", "Backup completo de emergência salvo com sucesso.");
      return true;
    }
    return false;
  }catch(error){
    alert("Erro ao salvar backup completo: " + error.message);
    logSyncEvent("Backup Google Drive (completo)", "erro", error.message);
    return false;
  }finally{
    driveBackupInProgress = false;
  }
}

async function autoBackupAfterSale(retryCount=0){
  if(driveBackupInProgress){
    if(retryCount < 2){
      setTimeout(() => autoBackupAfterSale(retryCount + 1), 1200);
    }
    return false;
  }
  try{
    if(!driveSupported()) return false;
    const handle = await getStoredDirectoryHandle();
    if(!handle) return false;

    // O navegador pode devolver "prompt"/"denied" após reiniciar a aplicação.
    // Em vez de simplesmente abandonar o backup automático, tentamos renovar a
    // autorização da pasta. Quando a função é chamada a partir da venda, o
    // navegador ainda pode preservar o gesto do usuário e permitir o pedido.
    const allowed = await verifyPermission(handle, true);
    if(!allowed){
      logSyncEventThrottled(
        "Backup automático Google Drive (leve)",
        "aviso",
        "A pasta de backup precisa ser autorizada novamente. Use 'Salvar backup agora' uma vez para renovar a permissão."
      );
      return false;
    }

    driveBackupInProgress = true;
    const payload = buildLightBackup();
    await writeLightBackupPair(payload, false);

    // Além do arquivo do dia e do ponteiro 'último', mantém um pequeno espelho
    // local no IndexedDB para que a última cópia leve continue disponível mesmo
    // se o Google Drive estiver temporariamente inacessível.
    try{
      localStorage.setItem(LAST_BACKUP_KEY, todayISO());
      localStorage.setItem(LAST_AUTO_BACKUP_KEY, new Date().toLocaleString("pt-BR"));
    }catch(_){}

    renderCloudStatus();
    logSyncEventThrottled(
      "Backup automático Google Drive (leve)",
      "sucesso",
      `Backup leve diário salvo e verificado após venda (${payload.stats.sales} venda(s), ${payload.stats.products} produto(s)).`
    );
    return true;
  }catch(error){
    console.warn("Auto backup leve não realizado:", error);
    logSyncEventThrottled("Backup automático Google Drive (leve)", "erro", error.message);
    if(retryCount < 2){
      setTimeout(() => autoBackupAfterSale(retryCount + 1), 1500);
    }
    return false;
  }finally{
    driveBackupInProgress = false;
  }
}

async function saveReportToDrive(){
  try{
    const ok = await writeTextFileToDrive(csvFileName(), buildSalesCSV());
    if(ok){
      alert("Relatório CSV salvo na pasta do Google Drive com sucesso.");
      logSyncEvent("Relatório CSV (Drive)", "sucesso", "Relatório salvo manualmente.");
    }
  }catch(error){
    alert("Erro ao salvar relatório: " + error.message);
    logSyncEvent("Relatório CSV (Drive)", "erro", error.message);
  }
}
async function clearDriveFolder(){
  if(!confirm("Remover a pasta configurada do Google Drive?")) return;
  await clearStoredDirectoryHandle();
  renderCloudStatus();
  logSyncEvent("Configuração da pasta do Drive", "sucesso", "Pasta removida pelo Administrador.");
}
function lastBackupToday(){
  return localStorage.getItem(LAST_BACKUP_KEY) === todayISO();
}
async function renderCloudStatus(){
  const status = document.getElementById("driveStatus");
  const reminder = document.getElementById("backupReminderBox");
  if(!status || !reminder) return;

  if(!driveSupported()){
    status.className = "drive-status error";
    status.innerHTML = "<strong>Recurso indisponível.</strong><br>Use Google Chrome ou Microsoft Edge atualizado para salvar direto em uma pasta do Google Drive.";
    reminder.innerHTML = `<div class="drive-status warn">Enquanto isso, use o botão normal de backup e escolha manualmente a pasta do Google Drive.</div>`;
    return;
  }

  let handle = null;
  try{
    handle = await getStoredDirectoryHandle();
  }catch(e){}

  if(handle){
    status.className = "drive-status ok";
    status.innerHTML = `<strong>Pasta configurada:</strong><br>${escapeHTML(handle.name)}<br><small>Quando salvar aqui, o Google Drive para computador vai sincronizar com a nuvem.</small>`;
  }else{
    status.className = "drive-status warn";
    status.innerHTML = "<strong>Nenhuma pasta configurada.</strong><br>Escolha a pasta do Google Drive para salvar backups diretos.";
  }

  const autoStatus = document.getElementById("autoBackupStatus");
  if(autoStatus){
    const lastAuto = localStorage.getItem(LAST_AUTO_BACKUP_KEY);
    if(handle){
      autoStatus.className = "drive-status ok";
      autoStatus.innerHTML = `<strong>Backup automático do Caixa ativo.</strong><br>Cada venda finalizada tenta atualizar:<br><small>auto-backup-luna-fem-finance-${todayISO()}.json</small><br><small>Último backup automático: ${escapeHTML(lastAuto || "ainda não realizado hoje")}</small>`;
    }else{
      autoStatus.className = "drive-status warn";
      autoStatus.innerHTML = "<strong>Backup automático do Caixa ainda não está ativo.</strong><br>Configure primeiro a pasta do Google Drive.";
    }
  }

  if(lastBackupToday()){
    reminder.innerHTML = `<div class="drive-status ok"><strong>Backup de hoje realizado.</strong><br>Continue mantendo essa rotina todos os dias.</div>`;
  }else{
    reminder.innerHTML = `<div class="drive-status warn"><strong>Backup diário pendente.</strong><br>No fechamento da loja, salve o backup no Google Drive.</div>`;
  }
}
// v0.6 - Módulo 6: Fusionador Inteligente de Backups.
// Combina dois backups sem duplicar produtos, vendas, caixa, vendedores ou categorias.
// Sempre usa migrateDB() nos dois arquivos antes de comparar, então funciona mesmo
// combinando backups de versões diferentes (de v0.1 até hoje).
function mergeBackups(principalRaw, secundarioRaw){
  const principal = migrateDB(structuredClone(principalRaw));
  const secundario = migrateDB(structuredClone(secundarioRaw));
  const merged = structuredClone(principal);

  const report = {
    productsAdded: 0, productsConflicts: 0,
    salesAdded: 0, salesDuplicated: 0,
    cashHistoryAdded: 0, cashSessionsAdded: 0,
    sellersAdded: 0, sellersConflicts: 0,
    categoriesAdded: 0,
    settingsDiffer: false,
    cashOpenNote: null
  };

  secundario.products.forEach(p => {
    const existing = merged.products.find(x => x.id === p.id);
    if(!existing){
      merged.products.push(p);
      report.productsAdded++;
    }else{
      const differs = existing.name !== p.name || Number(existing.price) !== Number(p.price) ||
        Number(existing.cost) !== Number(p.cost) || existing.type !== p.type;
      if(differs) report.productsConflicts++;
    }
  });

  const salesIds = new Set(merged.sales.map(s => s.id));
  secundario.sales.forEach(s => {
    if(salesIds.has(s.id)){
      report.salesDuplicated++;
    }else{
      merged.sales.push(s);
      salesIds.add(s.id);
      report.salesAdded++;
    }
  });
  merged.sales.sort((a,b) => parseSaleDateTime(b) - parseSaleDateTime(a));

  const cashHistoryIds = new Set(merged.cashHistory.map(h => h.id));
  secundario.cashHistory.forEach(h => {
    if(!cashHistoryIds.has(h.id)){
      merged.cashHistory.push(h);
      cashHistoryIds.add(h.id);
      report.cashHistoryAdded++;
    }
  });

  const cashSessionIds = new Set(merged.cashSessions.map(c => c.id));
  secundario.cashSessions.forEach(c => {
    if(!cashSessionIds.has(c.id)){
      merged.cashSessions.push(c);
      cashSessionIds.add(c.id);
      report.cashSessionsAdded++;
    }
  });

  secundario.sellers.forEach(s => {
    const existing = merged.sellers.find(x => Number(x.number) === Number(s.number));
    if(!existing){
      merged.sellers.push(s);
      report.sellersAdded++;
    }else if(existing.name !== s.name){
      report.sellersConflicts++;
    }
  });

  secundario.categories.forEach(c => {
    if(!merged.categories.includes(c)){
      merged.categories.push(c);
      report.categoriesAdded++;
    }
  });

  report.settingsDiffer = JSON.stringify(principal.settings) !== JSON.stringify(secundario.settings);

  if(secundario.cashOpen && principal.cashOpen && secundario.cashOpen.id !== principal.cashOpen.id){
    report.cashOpenNote = "Os dois backups têm um caixa aberto diferente. Foi mantido o caixa aberto do Backup Principal - confira manualmente qual está correto.";
  }else if(secundario.cashOpen && !principal.cashOpen){
    report.cashOpenNote = "O Backup Secundário tinha um caixa aberto que não foi trazido. Se ele ainda estiver em uso na outra máquina, feche-o manualmente lá antes de continuar.";
  }

  const syncIds = new Set(merged.syncHistory.map(e => e.id));
  (secundario.syncHistory || []).forEach(e => {
    if(!syncIds.has(e.id)){
      merged.syncHistory.push(e);
      syncIds.add(e.id);
    }
  });
  merged.syncHistory.sort((a,b) => (b.dateISO + b.timeText).localeCompare(a.dateISO + a.timeText));
  if(merged.syncHistory.length > 200) merged.syncHistory.length = 200;

  return {merged, report};
}
function readFileAsJSON(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try{ resolve(JSON.parse(reader.result)); }
      catch(e){ reject(new Error("Arquivo inválido ou corrompido.")); }
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file);
  });
}
let pendingMerge = null;
async function analyzeMerge(){
  const primaryFile = document.getElementById("mergePrimaryFile").files[0];
  const secondaryFile = document.getElementById("mergeSecondaryFile").files[0];
  const box = document.getElementById("mergeAnalysis");
  if(!primaryFile || !secondaryFile){
    alert("Selecione o Backup Principal e o Backup Secundário.");
    return;
  }
  try{
    const [principalRaw, secundarioRaw] = await Promise.all([readFileAsJSON(primaryFile), readFileAsJSON(secondaryFile)]);
    if(!principalRaw.products || !principalRaw.sales || !secundarioRaw.products || !secundarioRaw.sales){
      alert("Um dos arquivos não parece ser um backup válido do Luna Fem Finance.");
      return;
    }
    const {merged, report} = mergeBackups(principalRaw, secundarioRaw);
    pendingMerge = merged;

    box.innerHTML = `
      <div class="panel inner-panel">
        <h3>Resultado da análise</h3>
        <div class="summary-row"><span>Produtos novos incorporados</span><strong>${report.productsAdded}</strong></div>
        <div class="summary-row"><span>Produtos em conflito (mantido o Principal)</span><strong>${report.productsConflicts}</strong></div>
        <div class="summary-row"><span>Vendas novas incorporadas</span><strong>${report.salesAdded}</strong></div>
        <div class="summary-row"><span>Vendas já existentes (não duplicadas)</span><strong>${report.salesDuplicated}</strong></div>
        <div class="summary-row"><span>Movimentos de caixa novos</span><strong>${report.cashHistoryAdded}</strong></div>
        <div class="summary-row"><span>Sessões de caixa novas</span><strong>${report.cashSessionsAdded}</strong></div>
        <div class="summary-row"><span>Vendedores novos</span><strong>${report.sellersAdded}</strong></div>
        <div class="summary-row"><span>Vendedores em conflito (mantido o Principal)</span><strong>${report.sellersConflicts}</strong></div>
        <div class="summary-row"><span>Categorias novas</span><strong>${report.categoriesAdded}</strong></div>
        ${report.settingsDiffer ? `<p class="muted">As configurações (senhas, limites) dos dois backups são diferentes. Foram mantidas as do Backup Principal.</p>` : ""}
        ${report.cashOpenNote ? `<p class="muted">${report.cashOpenNote}</p>` : ""}
      </div>
    `;
    document.getElementById("confirmMergeBtn").classList.remove("hidden");
    document.getElementById("applyMergeBtn").classList.remove("hidden");
    logSyncEvent("Fusão de backups", "sucesso", `Análise concluída: ${report.salesAdded} venda(s) nova(s), ${report.productsAdded} produto(s) novo(s).`);
  }catch(error){
    alert("Erro ao analisar os backups: " + error.message);
    logSyncEvent("Fusão de backups", "erro", error.message);
  }
}
function mergedBackupFileName(){
  const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  return "backup-fusionado-luna-fem-finance-" + stamp + ".json";
}
function downloadMergedBackup(){
  if(!pendingMerge){
    alert("Analise dois backups primeiro.");
    return;
  }
  downloadFile(mergedBackupFileName(), JSON.stringify(pendingMerge, null, 2), "application/json");
  logSyncEvent("Fusão de backups", "sucesso", "Backup fusionado baixado.");
}
function applyMergedBackup(){
  if(!pendingMerge){
    alert("Analise dois backups primeiro.");
    return;
  }
  if(!confirm("Usar o backup fusionado como os dados atuais deste computador? Recomendamos baixar o backup fusionado antes, por segurança.")) return;
  const loggedInUser = db.currentUser;
  db = pendingMerge;
  db.currentUser = loggedInUser;
  saveDB();
  logSyncEvent("Fusão de backups", "sucesso", "Backup fusionado aplicado como dados atuais deste computador.");
  pendingMerge = null;
  document.getElementById("mergeAnalysis").innerHTML = "";
  document.getElementById("confirmMergeBtn").classList.add("hidden");
  document.getElementById("applyMergeBtn").classList.add("hidden");
  document.getElementById("mergePrimaryFile").value = "";
  document.getElementById("mergeSecondaryFile").value = "";
  renderAll();
  alert("Backup fusionado aplicado com sucesso.");
}

function restoreBackup(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const imported = JSON.parse(reader.result);
      if(!imported.products || !imported.sales){
        alert("Arquivo inválido.");
        return;
      }
      if(confirm("Restaurar este backup? Os dados atuais de productos/ventas/configuração serán reemplazados.")){
        const isLight=imported&&(imported.backupType==="light"||imported.backupFormat==="LUNA_FEM_FINANCE_LIGHT_V1");
        if(isLight){
          const preserved={cashHistory:Array.isArray(db.cashHistory)?db.cashHistory:[],cashSessions:Array.isArray(db.cashSessions)?db.cashSessions:[],syncHistory:Array.isArray(db.syncHistory)?db.syncHistory:[],actionHistory:Array.isArray(db.actionHistory)?db.actionHistory:[],cashOpen:db.cashOpen||null};
          db=migrateDB(imported); db.cashHistory=preserved.cashHistory; db.cashSessions=preserved.cashSessions; db.syncHistory=preserved.syncHistory; db.actionHistory=preserved.actionHistory; db.cashOpen=preserved.cashOpen;
        }else{ db=migrateDB(imported); }
        saveDB(); renderAll(); logSyncEvent("Restaurar backup","sucesso",isLight?"Backup JSON ligero restaurado; históricos locales preservados.":"Backup JSON restaurado pelo Administrador."); alert("Backup restaurado com sucesso.");
      }
    }catch(e){
      alert("Não foi possível ler o arquivo.");
    }
  };
  reader.readAsText(file);
}
function downloadFile(filename, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function parseSaleDateTime(sale){
  if(sale.dateISO){
    const time = getSaleTime(sale) || "00:00:00";
    return new Date(sale.dateISO + "T" + String(time).slice(0,8));
  }
  const date = getSaleDate(sale);
  const time = getSaleTime(sale) || "00:00:00";
  if(date && date.includes("/")){
    const parts = date.split("/");
    if(parts.length === 3) return new Date(parts[2] + "-" + parts[1] + "-" + parts[0] + "T" + String(time).slice(0,8));
  }
  return new Date();
}
function dateAtStartOfDay(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  return d;
}
function dateAtEndOfDay(date){
  const d = new Date(date);
  d.setHours(23,59,59,999);
  return d;
}
function localISODate(date){
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function rangeAnalysis(label, type, start, end){
  const startDate = dateAtStartOfDay(start);
  const endDate = dateAtEndOfDay(end);
  const sales = db.sales.filter(s => {
    if(s.cancelled) return false;
    const dt = parseSaleDateTime(s);
    return dt >= startDate && dt <= endDate;
  });

  return {
    label,
    type,
    startISO: localISODate(startDate),
    endISO: localISODate(endDate),
    count: sales.length,
    subtotal: sales.reduce((sum, s) => sum + Number(s.subtotal || s.total || 0), 0),
    discount: sales.reduce((sum, s) => sum + Number(s.discountAmount || 0), 0),
    total: sales.reduce((sum, s) => sum + Number(s.total || 0), 0),
    cost: sales.reduce((sum, s) => sum + Number(s.cost || 0), 0),
    fee: sales.reduce((sum, s) => sum + Number(s.fee || 0), 0),
    profit: sales.reduce((sum, s) => sum + Number(s.profit || 0), 0),
    payments: paymentSummaryForSales(sales),
    sellers: sellerSummary(sales)
  };
}
function buildAllAnalyses(){
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const weekStart = new Date(now);
  const weekday = weekStart.getDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  weekStart.setDate(weekStart.getDate() - diff);

  const firstQuinzenaStart = new Date(year, month, 1);
  const firstQuinzenaEnd = new Date(year, month, 15, 23, 59, 59, 999);
  const secondQuinzenaStart = new Date(year, month, 16);
  const secondQuinzenaEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const quarterStartMonth = Math.floor(month / 3) * 3;
  const quarterStart = new Date(year, quarterStartMonth, 1);
  const quarterEnd = new Date(year, quarterStartMonth + 3, 0, 23, 59, 59, 999);

  const semesterStartMonth = month < 6 ? 0 : 6;
  const semesterStart = new Date(year, semesterStartMonth, 1);
  const semesterEnd = new Date(year, semesterStartMonth + 6, 0, 23, 59, 59, 999);

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

  return [
    rangeAnalysis("Semanal", "semana", weekStart, now),
    rangeAnalysis("1ª Quinzena (1–15)", "quinzena_1", firstQuinzenaStart, firstQuinzenaEnd),
    rangeAnalysis("2ª Quinzena (16–fim)", "quinzena_2", secondQuinzenaStart, secondQuinzenaEnd),
    rangeAnalysis("Mensal", "mes", monthStart, monthEnd),
    rangeAnalysis("Trimestral", "trimestre", quarterStart, quarterEnd),
    rangeAnalysis("Semestral", "semestre", semesterStart, semesterEnd),
    rangeAnalysis("Anual", "ano", yearStart, yearEnd)
  ];
}

// v0.8 - Módulo 3/4/5: motor de períodos para as Análises dentro do app.
// Propositalmente uma implementação separada de buildAllAnalyses() (que alimenta o
// Google Sheets) - mesma matemática de datas, mas sem tocar no que já está em produção
// no Painel Mobile. Duplicar aqui é mais seguro do que arriscar mudar os números que a
// planilha já usa para calcular comissão.
const PERIOD_TYPES = [
  {key:"dia", navLabel:"Diário"},
  {key:"semana", navLabel:"Semanal"},
  {key:"quinzena_1", navLabel:"1ª Quinzena"},
  {key:"quinzena_2", navLabel:"2ª Quinzena"},
  {key:"mes", navLabel:"Mensal"},
  {key:"trimestre", navLabel:"Trimestral"},
  {key:"semestre", navLabel:"Semestral"},
  {key:"ano", navLabel:"Anual"}
];
function computePeriodRange(type, refDate){
  const ref = new Date(refDate);
  const year = ref.getFullYear();
  const month = ref.getMonth();

  if(type === "dia"){
    return {start: dateAtStartOfDay(ref), end: dateAtEndOfDay(ref), label: "Diário"};
  }
  if(type === "semana"){
    const weekStart = new Date(ref);
    const weekday = weekStart.getDay();
    const diff = weekday === 0 ? 6 : weekday - 1;
    weekStart.setDate(weekStart.getDate() - diff);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return {start: dateAtStartOfDay(weekStart), end: dateAtEndOfDay(weekEnd), label: "Semanal"};
  }
  if(type === "quinzena_1"){
    return {start: new Date(year, month, 1), end: new Date(year, month, 15, 23, 59, 59, 999), label: "1ª Quinzena (1–15)"};
  }
  if(type === "quinzena_2"){
    return {start: new Date(year, month, 16), end: new Date(year, month + 1, 0, 23, 59, 59, 999), label: "2ª Quinzena (16–fim)"};
  }
  if(type === "mes"){
    return {start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59, 999), label: "Mensal"};
  }
  if(type === "trimestre"){
    const qStartMonth = Math.floor(month / 3) * 3;
    return {start: new Date(year, qStartMonth, 1), end: new Date(year, qStartMonth + 3, 0, 23, 59, 59, 999), label: "Trimestral"};
  }
  if(type === "semestre"){
    const sStartMonth = month < 6 ? 0 : 6;
    return {start: new Date(year, sStartMonth, 1), end: new Date(year, sStartMonth + 6, 0, 23, 59, 59, 999), label: "Semestral"};
  }
  return {start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999), label: "Anual"};
}
function shiftReferenceDate(type, refDate, direction){
  const d = new Date(refDate);
  if(type === "dia") d.setDate(d.getDate() + direction);
  else if(type === "semana") d.setDate(d.getDate() + direction * 7);
  else if(type === "quinzena_1") d.setMonth(d.getMonth() + direction, 5);
  else if(type === "quinzena_2") d.setMonth(d.getMonth() + direction, 20);
  else if(type === "mes") d.setMonth(d.getMonth() + direction, 1);
  else if(type === "trimestre") d.setMonth(d.getMonth() + direction * 3, 1);
  else if(type === "semestre") d.setMonth(d.getMonth() + direction * 6, 1);
  else d.setFullYear(d.getFullYear() + direction, 0, 1);
  return d;
}
// Produtos mais vendidos no período (por receita). Funciona com produtos cadastrados
// e com Produto Rápido (que não tem id fixo, então agrupamos pelo nome nesse caso).
function topProducts(sales, limit){
  const map = new Map();
  sales.forEach(s => {
    if(s.cancelled) return;
    (s.items || []).forEach(item => {
      const key = item.id || ("nome:" + String(item.name || "").toLowerCase());
      if(!map.has(key)) map.set(key, {name: item.name || "Produto", qty: 0, revenue: 0});
      const row = map.get(key);
      row.qty += Number(item.qty || 0);
      row.revenue += Number(item.qty || 0) * Number(item.price || 0);
    });
  });
  return Array.from(map.values()).sort((a,b) => b.revenue - a.revenue).slice(0, limit || 5);
}
// Resumo de caixa do período: quantos fechamentos e a diferença total (sobra/falta).
function cashSummaryForRange(startDate, endDate){
  const startISO = localISODate(startDate);
  const endISO = localISODate(endDate);
  const sessions = (db.cashSessions || []).filter(c => c.dateISO >= startISO && c.dateISO <= endISO);
  return {
    count: sessions.length,
    totalExpected: sessions.reduce((a,c) => a + Number(c.expectedCash || 0), 0),
    totalCounted: sessions.reduce((a,c) => a + Number(c.closingAmount || 0), 0),
    totalDifference: sessions.reduce((a,c) => a + Number(c.difference || 0), 0)
  };
}
// Vendas canceladas no período (rangeAnalysis já exclui as canceladas do total principal).
function cancelledSummaryForRange(startDate, endDate){
  const start = dateAtStartOfDay(startDate);
  const end = dateAtEndOfDay(endDate);
  const cancelled = db.sales.filter(s => {
    if(!s.cancelled) return false;
    const dt = parseSaleDateTime(s);
    return dt >= start && dt <= end;
  });
  return {count: cancelled.length, total: cancelled.reduce((a,s) => a + Number(s.total || 0), 0)};
}

// v0.8 - bloco de HTML reutilizado pelas 3 telas de análise (por período, mensal, anual)
// para nunca haver divergência de layout ou de cálculo entre elas.
function renderAnalysisBlock(analysis, extras){
  extras = extras || {};
  const cash = extras.cash;
  const cancelled = extras.cancelled;
  const products = extras.products || [];
  const comparisonPct = extras.comparisonPct;
  const ticketAvg = analysis.count ? analysis.total / analysis.count : 0;

  const comparisonHtml = (comparisonPct === null || comparisonPct === undefined) ? "" : `
    <div class="metric"><span>Vs. período anterior</span><strong class="${comparisonPct >= 0 ? "diff-positive" : "diff-negative"}">${comparisonPct >= 0 ? "+" : ""}${comparisonPct.toFixed(1)}%</strong></div>`;

  return `
    <div class="metrics">
      <div class="metric"><span>Vendas</span><strong>${money(analysis.total)}</strong></div>
      <div class="metric"><span>Lucro</span><strong>${money(analysis.profit)}</strong></div>
      <div class="metric"><span>Custo</span><strong>${money(analysis.cost)}</strong></div>
      <div class="metric"><span>Desconto total</span><strong>${money(analysis.discount)}</strong></div>
      <div class="metric"><span>Qtd. vendas</span><strong>${analysis.count}</strong></div>
      <div class="metric"><span>Ticket médio</span><strong>${money(ticketAvg)}</strong></div>
      ${cancelled ? `<div class="metric"><span>Vendas canceladas</span><strong>${cancelled.count} (${money(cancelled.total)})</strong></div>` : ""}
      ${comparisonHtml}
    </div>
    <div class="grid two">
      <div class="panel inner-panel">
        <h3>Formas de pagamento</h3>
        ${Object.entries(analysis.payments).map(([k,v]) => `<div class="summary-row"><span>${labelPayment(k)}</span><strong>${money(v)}</strong></div>`).join("")}
      </div>
      <div class="panel inner-panel">
        <h3>Vendedores</h3>
        ${analysis.sellers.filter(s => s.count > 0).map(s => `<div class="summary-row"><span>${escapeHTML(s.name)}<br><small>${s.count} venda(s)</small></span><strong>${money(s.total)}</strong></div>`).join("") || `<p class="muted">Nenhuma venda no período.</p>`}
      </div>
    </div>
    <div class="grid two">
      <div class="panel inner-panel">
        <h3>Produtos mais vendidos</h3>
        ${products.length ? products.map(p => `<div class="summary-row"><span>${escapeHTML(p.name)}<br><small>${p.qty} unidade(s)</small></span><strong>${money(p.revenue)}</strong></div>`).join("") : `<p class="muted">Nenhum produto vendido no período.</p>`}
      </div>
      <div class="panel inner-panel">
        <h3>Caixa</h3>
        ${cash ? (cash.count ? `
          <div class="summary-row"><span>Fechamentos no período</span><strong>${cash.count}</strong></div>
          <div class="summary-row"><span>Diferença total</span><strong class="${cash.totalDifference >= 0 ? "diff-positive" : "diff-negative"}">${money(cash.totalDifference)}</strong></div>
        ` : `<p class="muted">Sem fechamentos de caixa no período.</p>`) : ""}
      </div>
    </div>`;
}

// v0.8 - Módulo 3: Análises por período, com navegação para períodos anteriores.
let currentAnalysisType = "mes";
let currentAnalysisRef = new Date();
let currentAnalysisSnapshot = null;
function setAnalysisPeriodType(type){
  currentAnalysisType = type;
  currentAnalysisRef = new Date();
  renderAnalisesPeriodo();
}
function shiftAnalysisPeriod(direction){
  currentAnalysisRef = shiftReferenceDate(currentAnalysisType, currentAnalysisRef, direction);
  renderAnalisesPeriodo();
}
function renderAnalisesPeriodo(){
  const navBox = document.getElementById("analysisPeriodTypes");
  const container = document.getElementById("analysisPeriodContent");
  if(!navBox || !container) return;

  navBox.innerHTML = PERIOD_TYPES.map(p => `
    <button class="btn ${p.key === currentAnalysisType ? "primary" : "ghost"}" onclick="setAnalysisPeriodType('${p.key}')">${p.navLabel}</button>
  `).join("");

  const {start, end, label} = computePeriodRange(currentAnalysisType, currentAnalysisRef);
  const analysis = rangeAnalysis(label, currentAnalysisType, start, end);
  const cash = cashSummaryForRange(start, end);
  const cancelled = cancelledSummaryForRange(start, end);
  const startB = dateAtStartOfDay(start), endB = dateAtEndOfDay(end);
  const sales = db.sales.filter(s => !s.cancelled && parseSaleDateTime(s) >= startB && parseSaleDateTime(s) <= endB);
  const products = topProducts(sales, 5);

  const prevRef = shiftReferenceDate(currentAnalysisType, currentAnalysisRef, -1);
  const prevRange = computePeriodRange(currentAnalysisType, prevRef);
  const prevAnalysis = rangeAnalysis(prevRange.label, currentAnalysisType, prevRange.start, prevRange.end);
  const comparisonPct = prevAnalysis.total > 0 ? ((analysis.total - prevAnalysis.total) / prevAnalysis.total * 100) : null;

  currentAnalysisSnapshot = {analysis, cash, cancelled, products, label, start, end};

  container.innerHTML = `
    <div class="period-nav-row">
      <button class="btn ghost" onclick="shiftAnalysisPeriod(-1)">‹ Anterior</button>
      <div class="period-nav-label"><strong>${label}</strong><br><small>${start.toLocaleDateString("pt-BR")} até ${end.toLocaleDateString("pt-BR")}</small></div>
      <button class="btn ghost" onclick="shiftAnalysisPeriod(1)">Próximo ›</button>
    </div>
    <div class="export-row">
      <span class="export-label">Exportar este período:</span>
      <button class="btn ghost" onclick="exportAnalysisPeriod('pdf')">PDF</button>
      <button class="btn ghost" onclick="exportAnalysisPeriod('excel')">Excel</button>
      <button class="btn ghost" onclick="exportAnalysisPeriod('csv')">CSV</button>
      <button class="btn ghost" onclick="exportAnalysisPeriod('json')">JSON</button>
    </div>
    ${renderAnalysisBlock(analysis, {cash, cancelled, products, comparisonPct})}`;
}

// v0.8 - Módulo 4: Resumos Mensais, um card por mês com vendas, o mais novo sempre em cima.
const MONTH_NAMES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
function monthsWithSales(){
  const map = new Map();
  db.sales.forEach(s => {
    if(s.cancelled) return;
    const dt = parseSaleDateTime(s);
    const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
    if(!map.has(key)) map.set(key, {year: dt.getFullYear(), month: dt.getMonth()});
  });
  return Array.from(map.entries()).map(([key, v]) => ({key, ...v})).sort((a,b) => b.key.localeCompare(a.key));
}
function renderResumosMensais(){
  const box = document.getElementById("monthlySummaryList");
  if(!box) return;
  const months = monthsWithSales();
  if(!months.length){
    box.innerHTML = `<p class="muted">Nenhuma venda registrada ainda.</p>`;
    return;
  }
  box.innerHTML = months.map((m, idx) => {
    const monthStart = new Date(m.year, m.month, 1);
    const monthEnd = new Date(m.year, m.month + 1, 0, 23, 59, 59, 999);
    const analysis = rangeAnalysis("Mensal", "mes", monthStart, monthEnd);
    const cash = cashSummaryForRange(monthStart, monthEnd);
    const cancelled = cancelledSummaryForRange(monthStart, monthEnd);
    const sales = db.sales.filter(s => !s.cancelled && parseSaleDateTime(s) >= monthStart && parseSaleDateTime(s) <= monthEnd);
    const products = topProducts(sales, 5);

    const q1 = rangeAnalysis("1ª Quinzena", "quinzena_1", monthStart, new Date(m.year, m.month, 15, 23, 59, 59, 999));
    const q2 = rangeAnalysis("2ª Quinzena", "quinzena_2", new Date(m.year, m.month, 16), monthEnd);

    return `
      <details class="month-accordion" ${idx === 0 ? "open" : ""}>
        <summary><strong>${MONTH_NAMES_PT[m.month]} de ${m.year}</strong><span>${money(analysis.total)}</span></summary>
        <div class="month-accordion-body">
          <div class="panel inner-panel">
            <h3>Quinzenas</h3>
            <div class="summary-row"><span>1ª Quinzena (1–15)</span><strong>${money(q1.total)}</strong></div>
            <div class="summary-row"><span>2ª Quinzena (16–fim)</span><strong>${money(q2.total)}</strong></div>
          </div>
          ${renderAnalysisBlock(analysis, {cash, cancelled, products})}
        </div>
      </details>`;
  }).join("");
}

// v0.8 - Módulo 5: Resumo Anual, um card por ano com todos os meses e comparação.
function yearsWithSales(){
  const set = new Set();
  db.sales.forEach(s => {
    if(s.cancelled) return;
    set.add(parseSaleDateTime(s).getFullYear());
  });
  return Array.from(set).sort((a,b) => b - a);
}
function renderResumoAnual(){
  const box = document.getElementById("annualSummaryList");
  if(!box) return;
  const years = yearsWithSales();
  if(!years.length){
    box.innerHTML = `<p class="muted">Nenhuma venda registrada ainda.</p>`;
    return;
  }
  box.innerHTML = years.map((year, idx) => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const analysis = rangeAnalysis("Anual", "ano", yearStart, yearEnd);
    const cash = cashSummaryForRange(yearStart, yearEnd);
    const cancelled = cancelledSummaryForRange(yearStart, yearEnd);
    const sales = db.sales.filter(s => !s.cancelled && parseSaleDateTime(s) >= yearStart && parseSaleDateTime(s) <= yearEnd);
    const products = topProducts(sales, 5);

    const prevAnalysis = rangeAnalysis("Anual", "ano", new Date(year - 1, 0, 1), new Date(year - 1, 11, 31, 23, 59, 59, 999));
    const comparisonPct = prevAnalysis.total > 0 ? ((analysis.total - prevAnalysis.total) / prevAnalysis.total * 100) : null;

    const monthsTable = MONTH_NAMES_PT.map((name, m) => {
      const mAnalysis = rangeAnalysis(name, "mes", new Date(year, m, 1), new Date(year, m + 1, 0, 23, 59, 59, 999));
      return `<div class="summary-row"><span>${name}</span><strong>${money(mAnalysis.total)}</strong></div>`;
    }).join("");

    return `
      <details class="month-accordion" ${idx === 0 ? "open" : ""}>
        <summary><strong>Resumo ${year} LFB</strong><span>${money(analysis.total)}</span></summary>
        <div class="month-accordion-body">
          <div class="panel inner-panel">
            <h3>Meses do ano</h3>
            ${monthsTable}
          </div>
          ${renderAnalysisBlock(analysis, {cash, cancelled, products, comparisonPct})}
        </div>
      </details>`;
  }).join("");
}
function switchAnalysisView(view){
  document.querySelectorAll("#analisesTab .subtab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll("#analisesTab .subtab-content").forEach(c => c.classList.remove("active"));
  const btn = document.querySelector(`#analisesTab .subtab[data-view="${view}"]`);
  const panel = document.getElementById(view + "View");
  if(btn) btn.classList.add("active");
  if(panel) panel.classList.add("active");
}

function mobileConfig(){
  return {
    url: localStorage.getItem(MOBILE_SCRIPT_URL_KEY) || "",
    secret: localStorage.getItem(MOBILE_SECRET_KEY) || ""
  };
}
function saveMobileConfig(){
  const url = document.getElementById("mobileScriptUrl")?.value.trim() || "";
  const secret = document.getElementById("mobileSecret")?.value.trim() || "";

  if(!url){
    alert("Cole a URL do Apps Script.");
    return;
  }
  if(!secret){
    alert("Informe a chave secreta.");
    return;
  }

  localStorage.setItem(MOBILE_SCRIPT_URL_KEY, url);
  localStorage.setItem(MOBILE_SECRET_KEY, secret);
  renderMobileStatus();
  alert("Configuração do Painel Mobile salva com sucesso.");
}
function renderMobileStatus(){
  const urlInput = document.getElementById("mobileScriptUrl");
  const secretInput = document.getElementById("mobileSecret");
  const status = document.getElementById("mobileSyncStatus");
  if(!status) return;

  const cfg = mobileConfig();
  if(urlInput) urlInput.value = cfg.url;
  if(secretInput) secretInput.value = cfg.secret;

  const last = localStorage.getItem(LAST_MOBILE_SYNC_KEY);
  if(cfg.url && cfg.secret){
    status.className = "drive-status mobile-ok";
    status.innerHTML = `<strong>Painel Mobile configurado.</strong><br><small>Última sincronização enviada: ${escapeHTML(last || "ainda não sincronizado")}</small><br><small>Depois de finalizar venda, a app tenta atualizar o Google Sheets automaticamente.</small>`;
  }else{
    status.className = "drive-status mobile-warn";
    status.innerHTML = "<strong>Painel Mobile ainda não configurado.</strong><br>Informe a URL do Apps Script e a chave secreta.";
  }
}
function paymentSummaryForSales(sales){
  const summary = {dinheiro:0, pix:0, debito:0, credito:0, transferencia:0, misto:0};
  sales.forEach(s => {
    if(s.payment === "misto" && s.mixed){
      summary.dinheiro += Number(s.mixed.dinheiro || 0);
      summary.pix += Number(s.mixed.pix || 0);
      summary.debito += Number(s.mixed.debito || 0);
      summary.credito += Number(s.mixed.credito || 0);
      summary.transferencia += Number(s.mixed.transferencia || 0);
      summary.misto += Number(s.total || 0);
    }else if(summary.hasOwnProperty(s.payment)){
      summary[s.payment] += Number(s.total || 0);
    }
  });
  return summary;
}
function buildMobilePayload(reason){
  const cfg = mobileConfig();
  const validToday = todaySales();
  const validAll = db.sales.filter(s => !s.cancelled);
  const todayCost = validToday.reduce((sum, s) => sum + Number(s.cost || 0), 0);

  const low = db.products.filter(p => p.type === "produto" && Number(p.stock) <= Number(db.settings.lowStockAlert));
  const pending = db.products.filter(p => p.pendingReview);

  const salesPayload = db.sales.map(s => ({
    id: s.id,
    date: getSaleDate(s),
    time: getSaleTime(s),
    createdAt: s.createdAt || "",
    sellerNumber: s.sellerNumber || "",
    sellerName: s.sellerName || s.seller || "",
    customer: s.customer || "",
    phone: s.phone || "",
    payment: labelPayment(s.payment),
    paymentKey: s.payment || "",
    mixed: s.mixed || null,
    installments: s.installments || "",
    subtotal: Number(s.subtotal || s.total || 0),
    discountPercent: Number(s.discountPercent || 0),
    discountAmount: Number(s.discountAmount || 0),
    total: Number(s.total || 0),
    cost: Number(s.cost || 0),
    fee: Number(s.fee || 0),
    profit: Number(s.profit || 0),
    cancelled: !!s.cancelled,
    itemsText: (s.items || []).map(i => `${i.qty}x ${i.name}`).join(" • "),
    items: (s.items || []).map(i => ({
      productId: i.productId || i.id || "",
      name: i.name || "",
      qty: Number(i.qty || 0),
      price: Number(i.price || 0),
      cost: Number(i.cost || 0)
    }))
  }));

  const cash = db.cashOpen ? {
    open: true,
    openedAt: db.cashOpen.openedAt || "",
    initial: Number(db.cashOpen.initial || db.cashOpen.openingAmount || 0),
    expectedCash: expectedCashAmount(),
    cashSales: currentCashSales(),
    manualMovements: currentManualCashMovements()
  } : {
    open: false,
    openedAt: "",
    initial: 0,
    expectedCash: 0,
    cashSales: 0,
    manualMovements: 0
  };

  return {
    secret: cfg.secret,
    storeName: "Luna Fem Finance",
    appVersion: APP_VERSION,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    sentAt: new Date().toLocaleString("pt-BR"),
    sentAtISO: new Date().toISOString(),
    reason: reason || "sincronização",
    sellers: (db.sellers || []).map(s => ({
      number: Number(s.number || 0),
      name: s.name || ""
    })),
    summary: {
      dateISO: todayISO(),
      total: validToday.reduce((sum, s) => sum + Number(s.total || 0), 0),
      profit: validToday.reduce((sum, s) => sum + Number(s.profit || 0), 0),
      cost: todayCost,
      count: validToday.length,
      payments: paymentSummaryForSales(validToday),
      sellers: sellerSummary(validToday),
      cash
    },
    sales: salesPayload,
    cashSessions: (db.cashSessions || []).map(c => ({
      dateISO: c.dateISO || "",
      openedAt: c.openedAt || "",
      closedAt: c.closedAt || "",
      initial: Number(c.initial || c.openingAmount || 0),
      cashSales: Number(c.cashSales || 0),
      manualMovements: Number(c.manualMovements || 0),
      expectedCash: Number(c.expectedCash || 0),
      closingAmount: Number(c.closingAmount || 0),
      difference: Number(c.difference || 0),
      openedBy: c.openedBySellerName || "Administrador",
      closedBy: c.closedBySellerName || "Administrador"
    })),
    pendingProducts: pending.map(p => ({
      createdAt: p.createdAt || "",
      name: p.name || "",
      category: p.category || "",
      price: Number(p.price || 0),
      createdBy: `${p.createdBySellerNumber || ""} ${p.createdBySellerName || ""}`.trim(),
      note: p.note || ""
    })),
    lowStock: low.map(p => ({
      name: p.name || "",
      category: p.category || "",
      stock: Number(p.stock || 0),
      price: Number(p.price || 0),
      sku: p.sku || ""
    })),
    analyses: buildAllAnalyses()
  };
}
async function syncMobilePanel(silent, reason){
  const cfg = mobileConfig();
  if(!cfg.url || !cfg.secret){
    if(!silent) alert("Configure primeiro o Painel Mobile com a URL do Apps Script e a chave secreta.");
    renderMobileStatus();
    return false;
  }

  try{
    const payload = buildMobilePayload(reason || "sincronização");

    await fetch(cfg.url, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    const stamp = new Date().toLocaleString("pt-BR");
    localStorage.setItem(LAST_MOBILE_SYNC_KEY, stamp);
    localStorage.removeItem(PENDING_MOBILE_SYNC_KEY);
    renderMobileStatus();

    if(!silent){
      alert("Sincronização enviada. Abra o Google Sheets no celular e confira se atualizou.");
      logSyncEvent("Painel Mobile / Sheets", "sucesso", `Enviado manualmente (${reason}). Sem confirmação do servidor (modo no-cors).`);
    }else{
      const wasPending = reason === "reconexão automática";
      logSyncEventThrottled("Painel Mobile / Sheets (automático)", "sucesso", wasPending ? "Conexão voltou - sincronização pendente enviada." : "Enviado automaticamente após ação no Caixa. Sem confirmação do servidor.");
    }
    return true;
  }catch(error){
    // v0.7 - Módulo 9: sem internet (ou Apps Script fora do ar) no momento da venda.
    // A venda já está salva localmente; marcamos para tentar de novo quando a conexão voltar.
    if(silent) localStorage.setItem(PENDING_MOBILE_SYNC_KEY, "1");
    if(!silent){
      alert("Erro ao sincronizar Painel Mobile: " + error.message);
      logSyncEvent("Painel Mobile / Sheets", "erro", error.message);
    }else{
      logSyncEventThrottled("Painel Mobile / Sheets (automático)", "erro", error.message);
    }
    return false;
  }
}

function labelPayment(key){
  return {
    dinheiro:"Dinheiro",
    pix:"PIX",
    debito:"Débito",
    credito:"Crédito",
    transferencia:"Transferência",
    misto:"Misto"
  }[key] || key;
}
function escapeHTML(str){
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
