import {
  type DocumentOptions,
  onDocumentWritten,
} from "firebase-functions/firestore";
import {
  type Step,
  type StepFactory,
  type Task,
  type TaskOptions,
  StepStatus,
  TaskStatus,
} from "./types.js";
import * as logger from "firebase-functions/logger";
import {
  deSerializeResult,
  isStepExecutionResult,
  serializeResult,
  throwStepStatus,
} from "./step.js";
import { FirestoreTasksStorage } from "./storage.js";
import { removeTrailingSlash } from "./utils.js";

export function createFirequeue({
  firestore,
}: {
  firestore: FirebaseFirestore.Firestore;
}) {
  const storage = new FirestoreTasksStorage(firestore);

  /**
   * @returns a Firestore trigger that automatically handles tasks and steps execution
   */
  function createTask(
    taskId: string,
    taskOptions: TaskOptions,
    run: (params: {
      step: StepFactory;
      input: unknown | null;
      taskInstanceId: string;
    }) => Promise<void>
  ) {
    logger.debug(`[FireQueue] Creating task function for '${taskId}'`);

    const collectionPath = removeTrailingSlash(taskOptions.collectionPath);
    const documentPath = `${collectionPath}/{taskId}`;

    // TODO: add more options
    const functionOptions: DocumentOptions = {
      document: documentPath,
      concurrency: taskOptions.concurrency,
      secrets: taskOptions.secrets ?? [],
      timeoutSeconds: taskOptions.timeoutSeconds,
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
        case TaskStatus.Pending:
        case TaskStatus.Cancelled:
        case TaskStatus.Error: {
          logger.info(
            `[FireQueue] Task '${taskId}' execution skipped due to status: ${taskSnapshot.status}`
          );
          return;
        }

        case TaskStatus.Scheduled: {
          logger.info(
            `[FireQueue] Task '${taskId}' execution continued with status: ${taskSnapshot.status}`
          );
          break;
        }

        default: {
          const x = taskSnapshot.status;
          throw new Error(`Unchecked task status: ${x}`);
        }
      }

      let stepsExecuted = 0;

      const stepsFactory: StepFactory = {
        run: async (stepId, run) => {
          const step = await storage.getStep(taskDocumentPath, stepId);

          if (!step) {
            logger.info(
              `[FireQueue] Step '${stepId}' doesn't exist for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}), creating`
            );

            await storage.createStep(taskDocumentPath, stepId);
            throwStepStatus(stepId, StepStatus.Scheduled);
          }

          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) step '${step.stepId}' has status: ${step.status}`
          );

          switch (step.status) {
            case StepStatus.Scheduled: {
              try {
                stepsExecuted += 1;
                await storage.updateStep(taskDocumentPath, stepId, {
                  status: StepStatus.Pending,
                  error: null,
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
                  serializedResult: serializeResult(result),
                });
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
                throwStepStatus(stepId, StepStatus.Error);
              }

              // throw to re-run the task (successfull execution)
              throwStepStatus(stepId, StepStatus.Completed);
            }

            case StepStatus.Pending: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is pending, skipping`
              );

              throwStepStatus(stepId, StepStatus.Pending);
            }

            case StepStatus.Completed: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is completed, returning result`
              );

              return deSerializeResult(step.serializedResult) as any;
            }

            case StepStatus.Cancelled: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is cancelled, skipping`
              );

              throwStepStatus(stepId, StepStatus.Cancelled);
            }

            case StepStatus.Error: {
              logger.debug(
                `[FireQueue] Step '${step.stepId}' for task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) has errored, skipping`
              );

              throwStepStatus(stepId, StepStatus.Error);
            }

            default:
              const x = step.status;
              throw new Error(`Unsupported step status: ${x}`);
          }
        },
      };

      const deSerializedTaskInput = deSerializeResult(
        taskSnapshot.serializedInputData,
        { nullAsError: false }
      );

      try {
        await storage.updateTask(taskDocumentPath, {
          status: TaskStatus.Pending,
        });

        logger.debug(
          `[FireQueue] Executing task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId})`
        );

        await run({
          step: stepsFactory,
          input: deSerializedTaskInput,
          taskInstanceId: taskSnapshot.instanceId,
        });

        if (stepsExecuted === 0) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) executed no steps, marking as completed`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Completed,
          });
        }

        return;
      } catch (err) {
        if (isStepExecutionResult(err, StepStatus.Completed)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) step '${err.stepId}' finished executing step successfully`
          );

          logger.debug(
            `[FireQueue] Scheduting task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) to execute next step`
          );

          // schedule for next steps execution
          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Scheduled,
          });
        } else if (isStepExecutionResult(err, StepStatus.Scheduled)) {
          logger.debug(
            `[FireQueue] Scheduting task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) to execute a new step`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Scheduled,
            error: null,
          });
        } else if (isStepExecutionResult(err, StepStatus.Pending)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Pending due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Pending,
            error: null,
          });
        } else if (isStepExecutionResult(err, StepStatus.Cancelled)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Cancelled due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Cancelled,
            error: "Cancelled due to a step cancellation",
          });
        } else if (isStepExecutionResult(err, StepStatus.Error)) {
          logger.debug(
            `[FireQueue] Task '${taskSnapshot.taskId}' (instance ${taskSnapshot.instanceId}) is now Error due to step '${err.stepId}' status`
          );

          await storage.updateTask(taskDocumentPath, {
            status: TaskStatus.Error,
            error: "Stopped due to a step error",
          });
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

  function invokeTask({
    taskId,
    collectionPath,
    input,
  }: {
    taskId: string;
    collectionPath: string;
    input?: unknown;
  }) {
    logger.debug(`[FireQueue] Created task function '${taskId}'`);

    return storage.createTask({
      taskId,
      collectionPath,
      serializedInputData: serializeResult(input),
    });
  }

  function scheduleSteps(input: {
    taskInstanceId: string;
    collectionPath: string;
    stepIds: string[];
  }) {
    return storage.markStepsForExecution(input);
  }

  return { createTask, invokeTask, scheduleSteps };
}
