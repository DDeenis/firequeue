import {
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

class StepExecutionResult {
  constructor(
    public readonly reason: StepThrowReason,
    public readonly stepId: string
  ) {}
}

export function throwStepResult(
  stepId: string,
  reason: StepThrowReason
): never {
  throw new StepExecutionResult(reason, stepId);
}

export function isStepExecutionResult(
  obj: unknown,
  reason: StepThrowReason
): obj is StepExecutionResult {
  return obj instanceof StepExecutionResult && reason === obj.reason;
}
