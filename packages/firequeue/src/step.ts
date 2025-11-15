import {
  StepStatus,
  STEP_COMPLETED,
  STEP_PENDING,
  STEP_CANCELLED,
  STEP_ERROR,
  STEP_CREATED,
} from "./types.js";

type StepThrowReason =
  | typeof STEP_CREATED
  | typeof STEP_COMPLETED
  | typeof STEP_PENDING
  | typeof STEP_CANCELLED
  | typeof STEP_ERROR;

type ThrowableStepStatus =
  | StepStatus.Scheduled
  | StepStatus.Pending
  | StepStatus.Completed
  | StepStatus.Cancelled
  | StepStatus.Error;

class StepExecutionResult<T extends ThrowableStepStatus> {
  private _ghost?: T;

  constructor(
    public readonly reason: StepThrowReason,
    public readonly stepId: string
  ) {}
}

const statusToReason: Record<ThrowableStepStatus, StepThrowReason> = {
  [StepStatus.Pending]: STEP_PENDING,
  [StepStatus.Completed]: STEP_COMPLETED,
  [StepStatus.Cancelled]: STEP_CANCELLED,
  [StepStatus.Error]: STEP_ERROR,
  [StepStatus.Scheduled]: STEP_CREATED,
};

export function throwStepStatus(
  stepId: string,
  status: ThrowableStepStatus
): never {
  const reason = statusToReason[status];

  if (!reason)
    throw new Error(
      `Attempted to throw '${status}' step status, but it's not supposed to be thrown`
    );

  throw new StepExecutionResult(reason, stepId);
}

export function isStepExecutionResult<T extends ThrowableStepStatus>(
  obj: unknown,
  status: T
): obj is StepExecutionResult<T> {
  return (
    obj instanceof StepExecutionResult && statusToReason[status] === obj.reason
  );
}
