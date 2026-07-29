/* Configuration du projet Firebase WheelerBrothers. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyChDwjw_9MkJJtHatts6u6FKyRMofR-YHs",
  authDomain: "wheelerbrothers.firebaseapp.com",
  projectId: "wheelerbrothers",
  storageBucket: "wheelerbrothers.firebasestorage.app",
  messagingSenderId: "440186092210",
  appId: "1:440186092210:web:212818cf3776eed30f27ab"
};

/* URL publique prévue pour le nouveau dépôt GitHub Pages. */
const WB_CARNET_PUBLIC_URL = "https://tdyfa.github.io/wheelerBrothers-carnet/";

/*
   Instance Firebase nommée : elle isole la session WB Carnet de la session
   WheelerBrothers Atelier, même si les deux PWA sont hébergées sur tdyfa.github.io.
*/
const WB_CARNET_FIREBASE_APP_NAME = 'wbCarnet';
let wbCarnetFirebaseApp;
try{
  wbCarnetFirebaseApp = firebase.app(WB_CARNET_FIREBASE_APP_NAME);
}catch(_error){
  wbCarnetFirebaseApp = firebase.initializeApp(FIREBASE_CONFIG, WB_CARNET_FIREBASE_APP_NAME);
}
const db = wbCarnetFirebaseApp.firestore();
const auth = wbCarnetFirebaseApp.auth();
auth.languageCode = 'fr';
