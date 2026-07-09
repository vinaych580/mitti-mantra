/* ================================================================
   auth.js — STUB (authentication removed)
   Authentication has been removed. This file is kept as a no-op
   so any legacy references to window.mmAuth don't throw errors.
   ================================================================ */
window.mmAuth = {
  currentUser: function () { return null; },
  ready: function () { return true; },
  signInWithGoogle: function () { return Promise.reject(new Error('Auth removed')); },
  signInWithEmail: function () { return Promise.reject(new Error('Auth removed')); },
  signUpWithEmail: function () { return Promise.reject(new Error('Auth removed')); },
  signOut: function () { return Promise.resolve(); },
  onAuthStateChanged: function (cb) { cb(null); return function () {}; }
};
