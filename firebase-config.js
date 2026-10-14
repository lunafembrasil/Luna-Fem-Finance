// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxuyx5sLhlDICt4Iasb1-axm9SmJozUes",
  authDomain: "luna-fem-finance.firebaseapp.com",
  projectId: "luna-fem-finance",
  storageBucket: "luna-fem-finance.firebasestorage.app",
  messagingSenderId: "674445961897",
  appId: "1:674445961897:web:fb521b154d1fcb0eb997b8",
  measurementId: "G-CMC3MEHYNK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
