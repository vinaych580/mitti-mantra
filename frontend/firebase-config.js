/* ================================================================
   Firebase Configuration
   Replace the placeholder values below with your project's config
   from: Firebase Console → Project Settings → General → Your apps

   NOTE: These client-side keys are safe to expose in public code
   (they only identify your project; security comes from Firestore /
   Auth rules).  If you need to revoke them, rotate via the Firebase
   Console.
   ================================================================ */
const firebaseConfig = {
  apiKey:            "AIzaSyCB6yuagKblAhgG_bzsYvADmmiI1WAeadc",
  authDomain:        "mitti-mantra-462ac.firebaseapp.com",
  projectId:         "mitti-mantra-462ac",
  storageBucket:     "mitti-mantra-462ac.firebasestorage.app",
  messagingSenderId: "742911471576",
  appId:             "1:742911471576:web:299a28ce8d128bf3080cad",
  measurementId:     "G-1S7FY8CX28"
};

// Guard: only initialise if the Firebase SDK is actually loaded.
// Auth has been removed (see auth.js stub), so this file is a no-op
// in production unless the SDK script tags are re-added.
if (typeof firebase !== 'undefined' && firebase.initializeApp) {
  firebase.initializeApp(firebaseConfig);
}

