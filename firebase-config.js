// ============================================================================
//  FIREBASE CONFIG — Fruit Ninja Online
// ----------------------------------------------------------------------------
//  This Realtime Database is shared with an older project (PenDraw), which is
//  why the game works with zero setup. Rooms from both live under
//  rooms/{6-digit code} and are told apart by game:"ninja". Nothing here ever
//  enumerates or garbage-collects that tree, so the two cannot disturb each
//  other.
//
//  To move Fruit Ninja onto its own Firebase project later, edit ONLY this file:
//    1. https://console.firebase.google.com -> Add project (free)
//    2. Click the </> "Web" icon to register a web app, copy its config here
//    3. Realtime Database -> Create Database -> then publish firebase-rules.json
// ============================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBLY9smBzkX8CKGUQcpxKDKq0P7YcLYBAo",
  authDomain: "pendraw-e431d.firebaseapp.com",
  databaseURL: "https://pendraw-e431d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pendraw-e431d",
  storageBucket: "pendraw-e431d.firebasestorage.app",
  messagingSenderId: "969955762018",
  appId: "1:969955762018:web:6f5e70cd81cdaff108563b",
};

// ninja/net.js is the only module that imports the Firebase SDK — the pages talk
// to it, never to Firebase directly. That is what keeps the transport swappable.
