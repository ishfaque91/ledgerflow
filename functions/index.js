const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

async function isAuthorizedCaller(uid) {
    const callerDoc = await admin.firestore().collection("users").doc(uid).get();
    if (callerDoc.exists && callerDoc.data().role === "owner") return true;
    const superDoc = await admin.firestore().collection("superAdmins").doc(uid).get();
    return superDoc.exists;
}

exports.deleteAuthUser = onCall(async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");

    if (!(await isAuthorizedCaller(callerUid))) {
        throw new HttpsError("permission-denied", "Only the company owner or a super admin can delete auth accounts.");
    }

    const { uid, email } = request.data;

    try {
        let targetUid = uid;
        if (!targetUid && email) {
            const userRecord = await admin.auth().getUserByEmail(email);
            targetUid = userRecord.uid;
        }
        if (!targetUid) throw new HttpsError("invalid-argument", "Provide uid or email.");

        await admin.auth().deleteUser(targetUid);
        return { success: true };
    } catch (e) {
        if (e.code === "auth/user-not-found") return { success: true };
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", e.message);
    }
});
