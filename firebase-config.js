// Configuración de Firebase para LunaFem Finance
const firebaseConfig = {
  apiKey: "AIzaSyBxuyx5sLhlDICt4Iasb1-axm9SmJozUes",
  authDomain: "luna-fem-finance.firebaseapp.com",
  projectId: "luna-fem-finance",
  storageBucket: "luna-fem-finance.firebasestorage.app",
  messagingSenderId: "674445961897",
  appId: "1:674445961897:web:fb521b154d1fcb0eb997b8",
  measurementId: "G-CMC3MEHYNK"
};

// Inicialización de Firebase
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
