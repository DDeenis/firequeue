export interface Task {
  /** ID specified by the user */
  taskId: string;
  /** ID of a task instance */
  instanceId: string;
  status: TaskStatus;
  /** Error message */
  error?: string | null;
  serializedInputData: string | null;
}

export interface TaskOptions {
  collectionPath: string;
  concurrency?: number;
  secrets?: string[];
  timeoutSeconds?: number;
}

export enum TaskStatus {
  Scheduled = "scheduled",
  Pending = "pending",
  Completed = "completed",
  Cancelled = "cancelled",
  Error = "error",
}

export interface Step {
  /** ID provided by the user */
  stepId: string;
  /** Serialized result of a step execution */
  serializedResult: string | null;
  status: StepStatus;
  /** Error message */
  error?: string | null;
}

export enum StepStatus {
  Scheduled = "scheduled",
  Pending = "pending",
  Completed = "completed",
  Cancelled = "cancelled",
  Error = "error",
}

export interface StepFactory {
  run: <T>(id: string, run: () => Promise<T>) => Promise<T>;
}

export const STEP_CREATED = Symbol("step created");
export const STEP_COMPLETED = Symbol("step completed");
export const STEP_PENDING = Symbol("step pending");
export const STEP_CANCELLED = Symbol("step cancelled");
export const STEP_ERROR = Symbol("step error");

export const STEP_VAL_UNDEFINED = "@__FIREQUEUE_STEP_VAL_UNDEFINED__";
export const STEP_VAL_NULL = "@__FIREQUEUE_STEP_VAL_NULL__";
export const STEP_VAL_NAN = "@__FIREQUEUE_STEP_VAL_NAN__";
