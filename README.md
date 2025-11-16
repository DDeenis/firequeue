# 🔥 Firequeue

**A durable workflow orchestrator for Firebase Cloud Functions, inspired by Inngest.**

Firequeue allows you to write long-running, reliable, multi-step workflows (tasks) for Firebase that can pause and resume, surviving function timeouts and failures. It provides a simple, `async/await` API built on top of Cloud Functions and Firestore, enabling you to define complex, stateful processes with ease.

## Installation

```bash
# pnpm
pnpm add @fireq/firequeue

# npm
npm install @fireq/firequeue

# yarn
yarn add @fireq/firequeue
```

## Features

- **Durable Execution:** Workflows automatically pause and resume between steps, making them resilient to function timeouts and failures.
- **Simple, Inngest-like API:** Define complex workflows with a clean, `async/await` syntax using `step.run()`.
- **State Management:** Automatically manages task and step state (including results) in Firestore.
- **Concurrency Control:** Built-in support for Firebase Cloud Functions' concurrency settings.
- **Conditional Logic:** Easily implement conditional steps in your workflows.
- **Serverless:** Built entirely on Firebase Cloud Functions and Firestore.

## How It Works

Firequeue cleverly uses Firestore to persist the state of your workflows.

1.  **Invoke:** You start a workflow by calling `firequeue.invokeTask()`. This creates a new "task" document in a specified Firestore collection.
2.  **Trigger:** A Cloud Function, created by `firequeue.createTask()`, is triggered by the new task document.
3.  **Execute & Persist:** The function executes your workflow step-by-step.
    - When `step.run()` is called for the first time, it creates a "step" document in a subcollection within the task document.
    - It then executes the code inside your step and saves the result to the step's document in Firestore.
    - After the step completes, the Cloud Function execution is gracefully stopped and immediately re-triggered to process the next step.
4.  **Resume & Return:** On subsequent runs, when `step.run()` is called for a step that has already completed, it simply retrieves the saved result from Firestore and returns it without re-running the code.

This "pause and resume" mechanism ensures that each step runs exactly once, and the entire workflow can run for much longer than a single Cloud Function timeout allows.

## Creating a Workflow

Creating a workflow is a two-step process: define your workflow logic, and then trigger it.

### 1. Define the Workflow

`firequeue.createTask` is the equivalent of `inngest.createFunction`. You define a task that listens for invocations and use the `step` utility to define durable steps.

Each `step.run()` call encapsulates a single, distinct operation. This is crucial for long-running tasks, as Firequeue ensures that each step runs exactly once and its result is persisted. If a function times out or fails, Firequeue will resume from the last successfully completed step. Keep individual steps focused and relatively short to maximize resilience and avoid hitting Cloud Function timeouts within a step.

**`src/functions.ts`**

```typescript
import { firequeue } from "./init";
import { payments, inventory, shipping, email } from "./services"; // Hypothetical services

// The data our workflow receives
interface OrderData {
  orderId: string;
  customerId: string;
  items: { productId: string; quantity: number }[];
}

export const processOrderWorkflow = firequeue.createTask(
  "order-processing-flow",
  { collectionPath: "queue" },
  async ({ step, input }) => {
    const { orderId, customerId, items } = input as OrderData;

    // Step 1: Process the payment via a third-party gateway.
    const paymentDetails = await step.run("process-payment", async () => {
      console.log(`Processing payment for order: ${orderId}`);
      return payments.charge(customerId, orderId);
    });

    // Step 2: Update inventory levels in the database.
    await step.run("update-inventory", async () => {
      console.log(`Updating inventory for order: ${orderId}`);
      return inventory.decrementStock(items);
    });

    // Step 3: Create a shipment with a shipping provider API.
    const shipmentInfo = await step.run("create-shipment", async () => {
      console.log(`Creating shipment for order: ${orderId}`);
      return shipping.create(orderId, customerId);
    });

    // Step 4: Send a confirmation email to the customer.
    await step.run("send-confirmation-email", async () => {
      console.log(`Sending confirmation for order: ${orderId}`);
      return email.sendOrderConfirmation(customerId, {
        orderId,
        paymentDetails,
        shipmentInfo,
      });
    });

    console.log(`Order processing complete for: ${orderId}`);
  }
);
```

### 2. Trigger the Workflow

To trigger the workflow, call `firequeue.invokeTask()`. This is the equivalent of `inngest.send()`.

It's common to trigger a background workflow after a primary action, like an API request to create an order.

**`src/http-triggers.ts`**

```typescript
import { onRequest } from "firebase-functions/v2/https";
import { firequeue } from "./init";
import { db } from "./services"; // Hypothetical db service

export const createOrder = onRequest(async (req, res) => {
  const { customerId, items } = req.body;

  if (!customerId || !items) {
    res.status(400).send("Bad Request: Missing customerId or items.");
    return;
  }

  // 1. Create the initial order record in the database
  const orderRef = await db.collection("orders").add({
    customerId,
    items,
    status: "pending",
    createdAt: new Date(),
  });

  // 2. Trigger the long-running order fulfillment workflow
  await firequeue.invokeTask({
    taskId: "order-processing-flow",
    collectionPath: "queue",
    input: { orderId: orderRef.id, customerId, items },
  });

  res.status(201).send({
    orderId: orderRef.id,
    message: "Order received and processing started.",
  });
});
```

### 3. Don't Forget Initialization

Your workflows will need an initialized `firequeue` instance to work.

**`src/init.ts`**

```typescript
import { createFirequeue } from "@fireq/firequeue";
import * as admin from "firebase-admin";

admin.initializeApp();

export const firequeue = createFirequeue({
  firestore: admin.firestore(),
});
```

## API Reference

### `createFirequeue(options)`

Creates a new Firequeue instance.

- `options.firestore`: A `FirebaseFirestore.Firestore` instance from the `firebase-admin` SDK.
- `options.serializer` (optional): A custom serializer for handling data persistence. Defaults to a JSON-based serializer that handles `undefined`, `null`, and `NaN`.

### `firequeue.createTask(taskId, options, run)`

Creates a Cloud Function trigger that executes a workflow.

- `taskId` (string): A unique identifier for this task definition.
- `options` (TaskOptions):
  - `collectionPath` (string): The Firestore collection path where task documents will be created and listened for.
  - `concurrency?` (number): Sets the maximum number of concurrent function instances.
  - `secrets?` (string[]): Specifies any secrets the function needs access to.
  - `timeoutSeconds?` (number): The timeout for the underlying Cloud Function.
- `run({ step, input, taskInstanceId })`: The async function containing your workflow logic.
  - `step`: The step factory object.
  - `input`: The data payload passed to `invokeTask`.
  - `taskInstanceId`: The unique ID for the current workflow execution.

### `step.run(stepId, fn)`

Defines a durable step within a task.

- `stepId` (string): A unique identifier for this step _within the task_.
- `fn` (() => Promise<T>): An async function that contains the logic for the step. The return value will be persisted and made available to subsequent steps.

### `firequeue.invokeTask(options)`

Starts a new workflow execution.

- `options`:
  - `taskId` (string): The `taskId` of the workflow you want to run.
  - `collectionPath` (string): The collection path where the target task is listening. This must match the path defined in `createTask`.
  - `input?` (unknown): An optional data payload to pass to the workflow. The data must be serializable.

### `firequeue.cancelTask(options)`

Cancels a running task instance.

- `options`:
  - `taskInstanceId` (string): The unique ID of the task instance to cancel.
  - `collectionPath` (string): The collection path where the task is located.

### `firequeue.cancelSteps(options)`

Cancels specific steps within a task and sets the task status to `Cancelled`.

- `options`:
  - `taskInstanceId` (string): The unique ID of the task instance.
  - `collectionPath` (string): The collection path where the task is located.
  - `stepIds` (string[]): An array of step IDs to cancel.

### `firequeue.scheduleSteps(options)`

Reschedules specific steps within a task and sets the task status to `Scheduled`. This is useful for retrying failed steps.

- `options`:
  - `taskInstanceId` (string): The unique ID of the task instance.
  - `collectionPath` (string): The collection path where the task is located.
  - `stepIds` (string[]): An array of step IDs to reschedule.
