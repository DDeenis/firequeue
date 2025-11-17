import { onRequest } from "firebase-functions/v2/https";
import { firequeue } from "./init";
import * as logger from "firebase-functions/logger";

export const invokeTestTask = onRequest(async (request, response) => {
  logger.info("HTTP trigger: Invoking test-task...");

  try {
    await firequeue.invokeTask({
      taskId: "test-task",
      collectionPath: "queue",
    });

    const message = "Successfully invoked test-task.";
    logger.info(message);
    response.send(message);
  } catch (error) {
    const message = "Failed to invoke test-task.";
    logger.error(message, error);
    response.status(500).send(message);
  }
});

export const invokeProductReviewAggregation = onRequest(
  async (request, response) => {
    logger.info("HTTP trigger: Invoking product-review-aggregation...");

    try {
      await firequeue.invokeTask({
        taskId: "aggregate-product-reviews",
        collectionPath: "products-queue",
        input: {
          productId: "eDq4pbPUKnNBI0p5lZ5Y",
        },
      });

      const message = "Successfully invoked product-review-aggregation.";
      logger.info(message);
      response.send(message);
    } catch (error) {
      const message = "Failed to invoke product-review-aggregation.";
      logger.error(message, error);
      response.status(500).send(message);
    }
  }
);
