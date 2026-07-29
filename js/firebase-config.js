/**
 * LedgerFlow - Firebase project configuration.
 * Connects the app to your Firebase project (Firestore + Authentication).
 * Neither value here is secret — this is just an address, not a password;
 * Firestore Security Rules are what actually protect the data.
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
fbDb.settings({ ignoreUndefinedProperties: true });

// A second, independent Firebase app instance — used only to create a
// staff member's login (Firebase Auth normally signs you in as whoever
// you just created, which would otherwise kick the admin out of their
// own session while adding a new user).
const fbSecondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary');
const fbSecondaryAuth = fbSecondaryApp.auth();
