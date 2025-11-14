import {
  StepStatus,
  STEP_COMPLETED,
  STEP_PENDING,
  STEP_CANCELLED,
  STEP_ERROR,
  STEP_VAL_UNDEFINED,
  STEP_VAL_NULL,
  STEP_VAL_NAN,
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

export function serializeResult(result: unknown) {
  if (result === undefined) {
    return STEP_VAL_UNDEFINED;
  } else if (result === null) {
    return STEP_VAL_NULL;
  } else if (Number.isNaN(result)) {
    return STEP_VAL_NAN;
  }

  // TODO: handle null, undefined, and other types
  return JSON.stringify(result);
}

export function deSerializeResult(
  serializedResult: string | null,
  { nullAsError }: { nullAsError?: boolean } = { nullAsError: true }
): unknown {
  // null means that the value was not set
  if (serializedResult === null) {
    if (nullAsError) {
      throw new Error(`Tried to de-serialize an unset value`);
    }

    return null;
  }

  if (serializedResult === STEP_VAL_UNDEFINED) {
    return undefined;
  } else if (serializedResult === STEP_VAL_NULL) {
    return null;
  } else if (serializedResult === STEP_VAL_NAN) {
    return NaN;
  }

  // TODO: handle null, undefined, and other types
  return JSON.parse(serializedResult);
}
