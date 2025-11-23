import type { DocumentOptions } from "firebase-functions/firestore";

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

export interface TaskOptions extends Omit<DocumentOptions, "document"> {
  collectionPath: string;
}

export enum TaskStatus {
  Scheduled = "scheduled",
  Pending = "pending",
  Waiting = "waiting",
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
  /** Timestamp when step execution started (for detecting zombie steps) */
  startedAt?: number;
}

export enum StepStatus {
  Scheduled = "scheduled",
  Pending = "pending",
  Completed = "completed",
  Cancelled = "cancelled",
  Error = "error",
}

export interface FirequeueEvent {
  eventId: string;
  createdAt: number;
}

interface EventOptions {
  event: string;
  timeout?: TimeString;
}

export type TimeString =
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | `${number}d`
  | `${number}w`
  | `${number}mo`
  | `${number}yr`;

export interface StepFactory {
  run: <T>(id: string, run: () => Promise<T>) => Promise<T>;
  waitForEvent(opts: EventOptions): Promise<void>;
  waitForSingleEvent(opts: EventOptions): Promise<void>;
}

export interface Serializer {
  stringify(data: unknown): string;
  parse(str: string): unknown;
}

export const STEP_CREATED = Symbol("STEP_CREATED");
export const STEP_COMPLETED = Symbol("STEP_COMPLETED");
export const STEP_PENDING = Symbol("STEP_PENDING");
export const STEP_CANCELLED = Symbol("STEP_CANCELLED");
export const STEP_ERROR = Symbol("STEP_ERROR");

export const EVENT_NOT_TRIGGERED = Symbol("EVENT_NOT_TRIGGERED");
