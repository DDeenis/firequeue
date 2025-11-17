import { createFirequeue } from "@fireq/firequeue";
import * as admin from "firebase-admin";

admin.initializeApp();

type FunctionsRegistry = {
  "test-task": never;
  "aggregate-product-reviews": {
    productId: string;
  };
};

export const firequeue = createFirequeue<FunctionsRegistry>({
  firestore: admin.firestore(),
  logLevel: "DEBUG",
});
