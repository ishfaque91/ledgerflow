/**
 * TeleFlow Super Admin - Firebase project configuration.
 * Same Firebase project as the client-facing app — this panel just has
 * elevated access (via the superAdmins collection) to see every company.
 */

const firebaseConfig = {
    apiKey: "AIzaSyCpQtMlAB9mcoFdVBpSKMVszRkGrLWbl30",
    authDomain: "ledgerflow-df765.firebaseapp.com",
    projectId: "ledgerflow-df765",
    storageBucket: "ledgerflow-df765.firebasestorage.app",
    messagingSenderId: "467557800619",
    appId: "1:467557800619:web:eda2eeb95c36162ae2f5ee"
};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
fbDb.settings({ ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true });
