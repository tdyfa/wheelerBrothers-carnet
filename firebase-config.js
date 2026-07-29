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

if(!firebase.apps.length){
  firebase.initializeApp(FIREBASE_CONFIG);
}
const db = firebase.firestore();
const auth = firebase.auth();
auth.languageCode = 'fr';
