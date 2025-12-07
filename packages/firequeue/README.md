# Firequeue

A durable workflow orchestrator for Firebase Cloud Functions.

Firequeue lets you write multi-step workflows that persist state to Firestore. Each step runs exactly once, and workflows can pause and resume across function invocations.

## Table of Contents

- [Installation](#installation)
- [How It Works](#how-it-works)
  - [Execution Modes](#execution-modes)
  - [Task Statuses](#task-statuses)
  - [Step Statuses](#step-statuses)
- [Usage](#usage)
  - [Initialization](#initialization)
  - [Defining a Task](#defining-a-task)
  - [Invoking a Task](#invoking-a-task)
  - [Sending Events](#sending-events)
  - [Cancelling Tasks](#cancelling-tasks)
  - [Retrying Failed Steps](#retrying-failed-steps)
- [API Reference](#api-reference)
  - [`createFirequeue(options)`](#createfirequeueoptions)
  - [`firequeue.createTask(taskId, options, run)`](#firequeuecreatetasktaskid-options-run)
  - [`step.run(stepId, fn)`](#steprunstepid-fn)
  - [`step.waitForEvent(options)`](#stepwaitforeventoptions)
  - [`firequeue.invokeTask(options)`](#firequeueinvoketaskoptions)
  - [`firequeue.sendEvent(options)`](#firequeuesendeventoptions)
  - [`firequeue.cancelTask(options)`](#firequeuecanceltaskoptions)
  - [`firequeue.cancelSteps(options)`](#firequeuecancelstepsoptions)
  - [`firequeue.invalidateTask(options)`](#firequeueinvalidatetaskoptions)
- [Gotchas](#gotchas)
  - [Speculative Execution Can Timeout](#speculative-execution-can-timeout)
  - [Step IDs Must Be Unique Within a Task](#step-ids-must-be-unique-within-a-task)
  - [Step Results Must Be Serializable](#step-results-must-be-serializable)
  - [Conditional Steps Need Unique IDs](#conditional-steps-need-unique-ids)
  - [Events Must Be Sent After Task Starts Waiting](#events-must-be-sent-after-task-starts-waiting)
  - [Zombie Step Detection](#zombie-step-detection)
- [Firestore Structure](#firestore-structure)

## Installation

```bash
# pnpm
pnpm add @fireq/firequeue

# npm
npm install @fireq/firequeue

# yarn
yarn add @fireq/firequeue
```

## How It Works

1. **Invoke:** Call `firequeue.invokeTask()` to create a task document in Firestore.
2. **Trigger:** A Cloud Function created by `firequeue.createTask()` is triggered by the document write.
3. **Execute:** The function runs through your workflow. Each `step.run()` call:
   - Creates a step document in a subcollection (if it doesn't exist)
   - Executes the step function and saves the result
   - In default mode: stops execution and re-triggers the function for the next step
   - In speculative mode: continues to the next step until timeout approaches
4. **Resume:** On subsequent runs, completed steps return their saved result without re-executing.

### Execution Modes

| Mode | Behavior |
|------|----------|
| `serializable` (default) | Executes one step per function invocation, then re-triggers |
| `speculative` | Executes as many steps as possible until `timeoutSeconds - 5s` |

### Task Statuses

| Status | Description |
|--------|-------------|
| `scheduled` | Task is queued for execution |
| `running` | Task is currently executing |
| `waiting` | Task is waiting for an event via `step.waitForEvent()` |
| `completed` | All steps finished successfully |
| `cancelled` | Task was cancelled |
| `error` | A step failed |

### Step Statuses

| Status | Description |
|--------|-------------|
| `scheduled` | Step is ready to execute |
| `running` | Step is currently executing |
| `completed` | Step finished and result is saved |
| `cancelled` | Step was cancelled |
| `error` | Step execution failed |

## Usage

### Initialization

```typescript
// src/init.ts
import { createFirequeue } from "@fireq/firequeue";
import * as admin from "firebase-admin";

admin.initializeApp();

// Define your task input types
interface TaskRegistry {
  "order-processing": { orderId: string; customerId: string };
  "send-email": { to: string; subject: string };
}

export const firequeue = createFirequeue<TaskRegistry>({
  firestore: admin.firestore(),
  logLevel: "debug", // optional
});
```

### Defining a Task

```typescript
// src/functions.ts
import { firequeue } from "./init";

export const processOrder = firequeue.createTask(
  "order-processing",
  {
    collectionPath: "queue",
    timeoutSeconds: 120,
    executionMode: "speculative", // optional, defaults to "serializable"
  },
  async ({ step, input, taskInstanceId }) => {
    // Step 1
    const payment = await step.run("process-payment", async () => {
      return processPayment(input.orderId);
    });

    // Step 2
    await step.run("update-inventory", async () => {
      return updateInventory(input.orderId);
    });

    // Wait for external event (e.g., webhook confirmation)
    await step.waitForEvent({ event: "payment-confirmed" });

    // Step 3
    await step.run("send-confirmation", async () => {
      return sendEmail(input.customerId, payment);
    });
  }
);
```

### Invoking a Task

```typescript
import { firequeue } from "./init";

await firequeue.invokeTask({
  taskId: "order-processing",
  collectionPath: "queue",
  input: { orderId: "123", customerId: "456" },
});
```

### Sending Events

When a task is waiting for an event via `step.waitForEvent()`, send the event to resume execution:

```typescript
await firequeue.sendEvent({
  taskInstanceId: "abc123",
  collectionPath: "queue",
  event: "payment-confirmed",
});
```

### Cancelling Tasks

```typescript
// Cancel an entire task
await firequeue.cancelTask({
  taskInstanceId: "abc123",
  collectionPath: "queue",
});

// Cancel specific steps
await firequeue.cancelSteps({
  taskInstanceId: "abc123",
  collectionPath: "queue",
  stepIds: ["step-1", "step-2"],
});
```

### Retrying Failed Steps

Use `invalidateTask` to reschedule failed steps:

```typescript
await firequeue.invalidateTask({
  taskInstanceId: "abc123",
  collectionPath: "queue",
  stepIds: ["failed-step"],
  events: ["event-to-recreate"], // optional
});
```

## API Reference

### `createFirequeue(options)`

Creates a Firequeue instance.

| Option | Type | Description |
|--------|------|-------------|
| `firestore` | `FirebaseFirestore.Firestore` | Firestore instance from firebase-admin |
| `serializer` | `Serializer` | Optional. Custom serializer for step results. Default handles `undefined`, `null`, `NaN` |
| `logLevel` | `LogSeverity` | Optional. Log level (`debug`, `info`, `warn`, `error`) |

### `firequeue.createTask(taskId, options, run)`

Creates a Firestore-triggered Cloud Function.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `collectionPath` | `string` | Firestore collection path for task documents |
| `executionMode` | `"serializable" \| "speculative"` | Optional. Default: `"serializable"` |
| `timeoutSeconds` | `number` | Optional. Function timeout |
| `concurrency` | `number` | Optional. Max concurrent instances |
| `secrets` | `string[]` | Optional. Secret names to expose |

**Run function parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `step` | `StepFactory` | Step execution utilities |
| `input` | `T \| null` | Input data passed to `invokeTask` |
| `taskInstanceId` | `string` | Unique ID for this task instance |
| `event` | `FirestoreEvent` | The Firestore trigger event |

### `step.run(stepId, fn)`

Executes a durable step.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stepId` | `string` | Unique step identifier within the task |
| `fn` | `() => Promise<T>` | Async function to execute. Return value is persisted |

Returns the step result (from execution or cache).

### `step.waitForEvent(options)`

Pauses task execution until an event is received.

| Option | Type | Description |
|--------|------|-------------|
| `event` | `string` | Event name to wait for |
| `timeout` | `TimeString` | Optional. Timeout (e.g., `"5m"`, `"1h"`) |

### `firequeue.invokeTask(options)`

Starts a new task execution.

| Option | Type | Description |
|--------|------|-------------|
| `taskId` | `string` | Task identifier (must match `createTask`) |
| `collectionPath` | `string` | Collection path (must match `createTask`) |
| `input` | `T` | Optional. Input data for the task |

### `firequeue.sendEvent(options)`

Sends an event to a waiting task.

| Option | Type | Description |
|--------|------|-------------|
| `taskInstanceId` | `string` | Task instance ID |
| `collectionPath` | `string` | Collection path |
| `event` | `string` | Event name |

### `firequeue.cancelTask(options)`

Cancels a task.

| Option | Type | Description |
|--------|------|-------------|
| `taskInstanceId` | `string` | Task instance ID |
| `collectionPath` | `string` | Collection path |

### `firequeue.cancelSteps(options)`

Cancels specific steps and sets task status to `cancelled`.

| Option | Type | Description |
|--------|------|-------------|
| `taskInstanceId` | `string` | Task instance ID |
| `collectionPath` | `string` | Collection path |
| `stepIds` | `string[]` | Step IDs to cancel |

### `firequeue.invalidateTask(options)`

Reschedules steps for retry and sets task status to `scheduled`.

| Option | Type | Description |
|--------|------|-------------|
| `taskInstanceId` | `string` | Task instance ID |
| `collectionPath` | `string` | Collection path |
| `stepIds` | `string[]` | Step IDs to reschedule |
| `events` | `string[]` | Optional. Events to recreate |

## Gotchas

### Speculative Execution Can Timeout

In `speculative` mode, multiple steps run in a single function invocation. If the workflow takes longer than `timeoutSeconds`, the function will timeout and **the workflow will not automatically resume**. The task will be left in `running` status.

Use speculative execution only for short workflows where you want the step structure (idempotency, result caching) but don't need the reliability of per-step re-invocation.

```typescript
// Good: small workflow, steps are fast
firequeue.createTask("send-notification", {
  collectionPath: "queue",
  executionMode: "speculative",
}, async ({ step }) => {
  const user = await step.run("get-user", () => getUser());
  await step.run("send-email", () => sendEmail(user));
});

// Bad: long workflow with slow steps
firequeue.createTask("process-video", {
  collectionPath: "queue",
  executionMode: "speculative", // Don't do this
}, async ({ step }) => {
  await step.run("download", () => downloadVideo()); // 30s
  await step.run("transcode", () => transcodeVideo()); // 60s
  await step.run("upload", () => uploadVideo()); // 30s
});
```

### Step IDs Must Be Unique Within a Task

Each `step.run()` call must have a unique `stepId`. If you use the same ID twice, the second call will return the cached result from the first execution.

```typescript
// Wrong: both steps have the same ID
await step.run("process", () => processA());
await step.run("process", () => processB()); // Returns result of processA()

// Correct
await step.run("process-a", () => processA());
await step.run("process-b", () => processB());
```

### Step Results Must Be Serializable

Step return values are stored in Firestore as JSON. Functions, symbols, circular references, and other non-serializable values will cause errors or be lost.

```typescript
// Wrong: returning a function
await step.run("bad", () => {
  return { callback: () => {} }; // Will fail or be lost
});

// Correct: return plain data
await step.run("good", () => {
  return { id: "123", name: "test" };
});
```

If you need to serialize types that JSON doesn't support (e.g., `Date`, `BigInt`, custom classes), provide a custom serializer:

```typescript
import superjson from "superjson";

const firequeue = createFirequeue({
  firestore: admin.firestore(),
  serializer: {
    stringify: (data) => superjson.stringify(data),
    parse: (str) => superjson.parse(str),
  },
});
```

### Conditional Steps Need Unique IDs

If you have conditional logic, make sure step IDs are unique across all branches:

```typescript
// Wrong: step ID collision between branches
if (condition) {
  await step.run("send", () => sendEmail());
} else {
  await step.run("send", () => sendSms()); // ID collision!
}

// Correct
if (condition) {
  await step.run("send-email", () => sendEmail());
} else {
  await step.run("send-sms", () => sendSms());
}
```

### Events Must Be Sent After Task Starts Waiting

If you send an event before the task reaches `step.waitForEvent()`, the event will be consumed immediately. If the task hasn't started yet or is still on earlier steps, make sure your event sender waits for the appropriate state.

### Zombie Step Detection

If a step is in `running` status for longer than `timeoutSeconds + 10s`, it's marked as `error` (zombie detection). This handles cases where a function crashed mid-step without updating the status.

## Firestore Structure

```
{collectionPath}/
  {taskInstanceId}/           # Task document
    steps/
      {stepId}/               # Step documents
    events/
      {eventId}/              # Event documents
```
