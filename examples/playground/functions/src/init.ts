import { createFirequeue } from "@fireq/firequeue";
import * as admin from "firebase-admin";

admin.initializeApp();

export const firequeue = createFirequeue({
  firestore: admin.firestore(),
});
