import {
  Change,
  type DocumentOptions,
  type DocumentSnapshot,
  type FirestoreEvent,
  onDocumentWritten,
} from "firebase-functions/firestore";
import {
  type Serializer,
  type StepFactory,
  type Task,
  type TaskOptions,
  EVENT_NOT_TRIGGERED,
  STEP_CANCELLED,
  STEP_COMPLETED,
  STEP_CREATED,
  STEP_ERROR,
  STEP_PENDING,
  StepStatus,
  TaskStatus,
} from "./types.js";
import { isStepExecutionResult, throwStepResult } from "./steps.js";
import { FirestoreTasksStorage } from "./storage.js";
import {
  defaultSerializer,
  removeTrailingSlash,
  logger,
  unwrapFirestoreOptionsValue,
} from "./utils.js";
import type { LogSeverity } from "firebase-functions/logger";
import { isEventExecutionResult, throwEventResult } from "./events.js";

/**
 * Creates a new Firequeue instance.
 *
 * @param options - The configuration options for the Firequeue instance.
 * @param options.firestore - A `FirebaseFirestore.Firestore` instance from the `firebase-admin` SDK.
 * @param options.serializer - An optional custom serializer for handling data persistence.
 *   Defaults to a JSON-based serializer that handles `undefined`, `null`, and `NaN`.
 * @param options.logLevel - An optional log level.
 * @returns A Firequeue instance with methods for creating, invoking, and managing tasks.
 */
export function createFirequeue<
  FunctionsRegistry extends { [taskId: string]: unknown }
>(options: {
  firestore: FirebaseFirestore.Firestore;
  serializer?: Serializer;
  logLevel?: LogSeverity;
}) {
  const storage = new FirestoreTasksStorage(options.firestore);
  const serializer = options.serializer ?? defaultSerializer;

  if (options.logLevel) {
    logger.setLogSeverity(options.logLevel);
  }

  /**
   * Creates a Cloud Function trigger that executes a workflow.
   *
   * @param taskId - A unique identifier for this task definition.
   * @param taskOptions - The options for the task.
   * @param run - The async function containing the workflow logic.
   * @returns A Firestore trigger that automatically handles tasks and steps execution.
   */
  function createTask<TID extends Extract<keyof FunctionsRegistry, string>>(
    taskId: TID,
    taskOptions: TaskOptions,
    run: (params: {
      step: StepFactory;
      event: FirestoreEvent<
        Change<DocumentSnapshot> | undefined,
        Record<string, string>
      >;
      input: FunctionsRegistry[TID] | null;
      taskInstanceId: string;
    }) => Promise<void>
  ) {
    logger.debug(`[FireQueue] Creating task function for '${taskId}'`);

    const collectionPath = removeTrailingSlash(taskOptions.collectionPath);
    const documentPath = `${collectionPath}/{taskId}`;

    const functionOptions: DocumentOptions = {
      ...taskOptions,
      document: documentPath,
    };

    return onDocumentWritten(functionOptions, async (event) => {
      if (!event.data?.after.exists) {
        logger.debug(`[FireQueue] Task ${event.data?.before.id} is deleted`);
        return;
      }

      const taskDocumentPath = event.document || event.data.after.ref.path;
      const taskSnapshot = event.data?.after.data() as Task | undefined;

      logger.debug(`[FireQueue] Running task at '${taskDocumentPath}'`);

      if (!taskSnapshot) {
        logger.debug(`[FireQueue] Attempt to run an empty task`);
        return;
      }

      if (taskSnapshot.taskId !== taskId) {
        logger.debug(
          `[FireQueue] Expected task with id '${taskId}', received '${taskSnapshot.taskId}'`
        );
        return;
      }

      logger.debug(
        `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) status: ${taskSnapshot.status}`
      );

      switch (taskSnapshot.status) {
        case TaskStatus.Completed:
        case TaskStatus.Running:
        case TaskStatus.Cancelled:
        case TaskStatus.Error: {
          logger.info(
            `[FireQueue] Task '${taskId}' execution skipped due to status: ${taskSnapshot.status}`
          );
          return;
        }

        case TaskStatus.Waiting:
        case TaskStatus.Scheduled: {
          logger.info(
            `[FireQueue] Task '${taskId}' execution continued with status: ${taskSnapshot.status}`
          );
          break;
        }

        default: {
          const x: never = taskSnapshot.status;
          throw new Error(`Unchecked task status: ${x}`);
        }
      }

      // Calculate step timeout for zombie detection
      const DEFAULT_TIMEOUT_SECONDS = 60;
      const configuredTimeout = unwrapFirestoreOptionsValue(
        taskOptions.timeoutSeconds
      );
      const timeoutSeconds =
        configuredTimeout !== undefined
          ? configuredTimeout
          : DEFAULT_TIMEOUT_SECONDS;
      const STEP_TIMEOUT = timeoutSeconds + 10; // Timeout + buffer for zombie detection

      let stepExecuted = false;

      const stepsFactory: StepFactory = {
        run: async (stepId, run) => {
          // optimisation: re-schedule function only if it tries to execute more then one step at a time (there is more steps)
          if (stepExecuted) {
            // throw to re-run the task (successfull execution)
            throwStepResult(stepId, STEP_COMPLETED);
          }

          const step = await storage.getStep(taskDocumentPath, stepId);

          if (!step) {
            logger.info(
              `[FireQueue] Step '${stepId}' doesn't exist for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}), creating`
            );

            await storage.createStep(taskDocumentPath, stepId);
            throwStepResult(stepId, STEP_CREATED);
          }

          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) step '${step.stepId}' has status: ${step.status}`
          );

          switch (step.status) {
            case StepStatus.Scheduled: {
              try {
                stepExecuted = true;
                await storage.updateStep(taskDocumentPath, stepId, {
                  status: StepStatus.Running,
                  error: null,
                  startedAt: Date.now(),
                });

                logger.debug(
                  `[FireQueue] Executing step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId})`
                );

                const result = await run();

                logger.debug(
                  `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) executed successfully`
                );

                await storage.updateStep(taskDocumentPath, stepId, {
                  status: StepStatus.Completed,
                  serializedResult: serializer.stringify(result),
                });

                return result;
              } catch (error) {
                logger.error(
                  `[FireQueue] Failed to execute step '${stepId}' for task '${taskSnapshot.taskId}'`,
                  error
                );

                await storage.updateStep(taskDocumentPath, stepId, {
                  status: StepStatus.Error,
                  serializedResult: null,
                  error: (error as Error).message ?? undefined,
                });
                throwStepResult(stepId, STEP_ERROR);
              }
            }

            case StepStatus.Running: {
              // Check if step has been pending too long (zombie step detection)
              if (step.startedAt) {
                const pendingDuration = (Date.now() - step.startedAt) / 1000;
                if (pendingDuration > STEP_TIMEOUT) {
                  logger.error(
                    `[FireQueue] Step '${step.stepId}' has been pending for ${pendingDuration}s (timeout: ${STEP_TIMEOUT}s), marking as error`
                  );

                  await storage.updateStep(taskDocumentPath, stepId, {
                    status: StepStatus.Error,
                    error: `Step execution timed out after ${pendingDuration.toFixed(
                      0
                    )}s`,
                  });
                  throwStepResult(stepId, STEP_ERROR);
                }
              }

              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is pending, skipping`
              );

              throwStepResult(stepId, STEP_PENDING);
            }

            case StepStatus.Completed: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is completed, returning result`
              );

              if (step.serializedResult === null) {
                throw new Error(`Attempt to parse an unset serializedResult`);
              }

              return serializer.parse(step.serializedResult) as any;
            }

            case StepStatus.Cancelled: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is cancelled, skipping`
              );

              throwStepResult(stepId, STEP_CANCELLED);
            }

            case StepStatus.Error: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) has errored, skipping`
              );

              throwStepResult(stepId, STEP_ERROR);
            }

            default:
              const x: never = step.status;
              throw new Error(`Unsupported step status: ${x}`);
          }
        },

        waitForEvent: async (eventOptions) => {
          const consumedEvent = await storage.getAndConsumeEvent(
            taskDocumentPath,
            eventOptions.event
          );

          if (!consumedEvent) {
            logger.debug(
              `Event '${eventOptions.event}' was not received yet or has already expired`
            );

            throwEventResult(eventOptions.event, EVENT_NOT_TRIGGERED);
          }

          // continue execution
          return;
        },
      };

      const deSerializedTaskInput = taskSnapshot.serializedInputData
        ? serializer.parse(taskSnapshot.serializedInputData)
        : null;

      try {
        await storage.updateTask(taskDocumentPath, {
          status: TaskStatus.Running,
        });

        logger.debug(
          `[FireQueue] Executing task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId})`
        );

        await run({
          step: stepsFactory,
          event,
          input: deSerializedTaskInput as FunctionsRegistry[TID],
          taskInstanceId: taskSnapshot.instanceId,
        });

        if (stepExecuted === false) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) executed no steps, marking as completed`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Completed,
          });
        }

        return;
      } catch (err) {
        if (isStepExecutionResult(err, STEP_COMPLETED)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) step '${err.stepId}' finished executing step successfully`
          );

          logger.debug(
            `[FireQueue] Scheduling task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) to execute next step`
          );

          // schedule for next steps execution
          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Scheduled,
          });
        } else if (isStepExecutionResult(err, STEP_CREATED)) {
          logger.debug(
            `[FireQueue] Scheduling task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) to execute a new step`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Scheduled,
            error: null,
          });
        } else if (isStepExecutionResult(err, STEP_PENDING)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Pending due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Running,
            error: null,
          });
        } else if (isStepExecutionResult(err, STEP_CANCELLED)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Cancelled due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Cancelled,
            error: "Cancelled due to a step cancellation",
          });
        } else if (isStepExecutionResult(err, STEP_ERROR)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Error due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Error,
            error: "Stopped due to a step error",
          });
        } else if (isEventExecutionResult(err, EVENT_NOT_TRIGGERED)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is waiting for a '${err.eventId}' event`
          );

          if (taskSnapshot.status !== TaskStatus.Waiting) {
            await storage.updateTask(taskDocumentPath, {
              status: TaskStatus.Waiting,
            });
          }
        } else {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Error due to execution error`,
            err
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Error,
            error:
              (err as Error).message || "Stopped due to an unknown step error",
          });
        }
      }
    });
  }

  /**
   * Starts a new workflow execution.
   *
   * @param options - The options for invoking the task.
   * @param options.taskId - The `taskId` of the workflow to run.
   * @param options.collectionPath - The collection path where the target task is listening.
   *   This must match the path defined in `createTask`.
   * @param options.input - An optional data payload to pass to the workflow. The data must be serializable.
   * @returns A promise that resolves with the created task document.
   */
  async function invokeTask<
    TID extends Extract<keyof FunctionsRegistry, string>
  >({
    taskId,
    collectionPath,
    input,
  }: {
    taskId: TID;
    collectionPath: string;
    input?: FunctionsRegistry[TID];
  }) {
    logger.debug(`[FireQueue] Created task function '${taskId}'`);

    await storage.createTask({
      taskId,
      collectionPath,
      serializedInputData: serializer.stringify(input),
    });
  }

  /**
   * Cancels a running task instance.
   *
   * @param input - The options for canceling the task.
   * @param input.taskInstanceId - The unique ID of the task instance to cancel.
   * @param input.collectionPath - The collection path where the task is located.
   * @returns A promise that resolves when the task is cancelled.
   */
  async function cancelTask(input: {
    taskInstanceId: string;
    collectionPath: string;
  }) {
    await storage.updateTask(storage.getTaskDocumentPath(input), {
      status: TaskStatus.Cancelled,
    });
  }

  /**
   * Cancels specific steps within a task and sets the task status to Cancelled.
   *
   * @param input - The options for canceling the steps.
   * @param input.taskInstanceId - The unique ID of the task instance.
   * @param input.collectionPath - The collection path where the task is located.
   * @param input.stepIds - An array of step IDs to cancel.
   * @returns A promise that resolves when the steps and task are updated.
   */
  async function cancelSteps(input: {
    taskInstanceId: string;
    collectionPath: string;
    stepIds: string[];
  }) {
    await storage.markTaskEntitiesWithStatus({
      ...input,
      taskStatus: TaskStatus.Cancelled,
      stepsStatus: StepStatus.Cancelled,
    });
  }

  /**
   * Reschedules specific steps within a task and sets the task status to Scheduled.
   * This is useful for retrying failed steps.
   *
   * @param input - The options for scheduling the steps.
   * @param input.taskInstanceId - The unique ID of the task instance.
   * @param input.collectionPath - The collection path where the task is located.
   * @param input.stepIds - An array of step IDs to reschedule.
   * @param input.events - An array of events to recreate.
   * @returns A promise that resolves when the steps and task are updated.
   */
  async function invalidateTask(input: {
    taskInstanceId: string;
    collectionPath: string;
    stepIds: string[];
    events?: string[];
  }) {
    await storage.markTaskEntitiesWithStatus({
      ...input,
      taskStatus: TaskStatus.Scheduled,
      stepsStatus: StepStatus.Scheduled,
    });
  }

  async function sendEvent(input: {
    taskInstanceId: string;
    collectionPath: string;
    event: string;
  }) {
    await storage.createEvent(storage.getTaskDocumentPath(input), input.event);
    await storage.scheduleTaskIfNotRunning(storage.getTaskDocumentPath(input));
  }

  return {
    createTask,
    invokeTask,
    cancelTask,
    cancelSteps,
    invalidateTask,
    sendEvent,
  };
}
