import { firequeue } from "./init";
import * as admin from "firebase-admin";

/**
 * Defines the expected shape of the input data for our task.
 * The `unknown` type from the function signature will be cast to this.
 */
interface ProductReviewData {
  productId: string;
}

export const onProductReviewWritten = firequeue.createTask(
  "aggregate-product-reviews",
  { collectionPath: "products-queue" }, // Assuming tasks are written to a 'queue' collection
  async ({ step, input }) => {
    // Cast the 'unknown' input to our specific data type.
    const { productId } = input as ProductReviewData;

    const db = admin.firestore();
    const productRef = db.collection("products").doc(productId);
    const reviewsRef = productRef.collection("reviews");

    // Step 1: Fetch all reviews for the given product ID from Firestore.
    const reviews = await step.run("fetch-reviews", async () => {
      console.log(`Fetching reviews for product: ${productId}`);
      const snapshot = await reviewsRef.get();
      return snapshot.docs.map((doc) => doc.data() as { rating: number });
    });

    // Step 2: Calculate the aggregate values from the fetched reviews.
    const aggregates = await step.run("calculate-aggregates", async () => {
      if (reviews.length === 0) {
        return { reviewCount: 0, averageRating: 0 };
      }
      const reviewCount = reviews.length;
      const totalRating = reviews.reduce(
        (sum, review) => sum + review.rating,
        0
      );
      const averageRating = totalRating / reviewCount;

      return {
        reviewCount,
        averageRating: parseFloat(averageRating.toFixed(2)),
      };
    });

    const isTopRated =
      aggregates.averageRating >= 4.5 && aggregates.reviewCount >= 10;

    // Conditional Step: If the product has a high rating, log a message.
    // This step only runs when the condition is met.
    if (isTopRated) {
      await step.run("log-high-rating", async () => {
        console.log(
          `Product ${productId} has a high rating: ${aggregates.averageRating}`
        );
      });
    }

    // Step 3: Update the product document in Firestore with the new summary.
    await step.run("update-product-summary", async () => {
      const updatePayload = {
        ...aggregates,
        isTopRated,
      };

      console.log(
        `Updating product ${productId} with new summary:`,
        updatePayload
      );
      await productRef.update(updatePayload);
    });
  }
);
