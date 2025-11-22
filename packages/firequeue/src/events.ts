import {
  EVENT_NOT_TRIGGERED,
  type FirequeueEvent,
  type TimeString,
} from "./types.js";
import { timeStringToMs } from "./utils.js";

type EventThrowReason = typeof EVENT_NOT_TRIGGERED;

class EventExecutionResult {
  constructor(
    public readonly reason: EventThrowReason,
    public readonly eventId: string
  ) {}
}

export function throwEventResult(
  eventId: string,
  reason: EventThrowReason
): never {
  throw new EventExecutionResult(reason, eventId);
}

export function isEventExecutionResult(
  obj: unknown,
  reason: EventThrowReason
): obj is EventExecutionResult {
  return obj instanceof EventExecutionResult && reason === obj.reason;
}

export function isEventExpired(
  event: FirequeueEvent,
  timeout?: TimeString
): boolean {
  if (!timeout) return false;

  const timeoutMs = timeStringToMs(timeout);

  if (timeoutMs === 0) return true;

  return event.createdAt <= Date.now() + timeoutMs;
}
