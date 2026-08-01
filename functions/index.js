const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

exports.deleteAuthUser = onCall(async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "owner") {
        throw new HttpsError("permission-denied", "Only the company owner can delete auth accounts.");
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
