import type { LogEntry, LogSeverity } from "firebase-functions/logger";
import { type Serializer, type TimeString } from "./types.js";
import * as firebaseLogger from "firebase-functions/logger";
import type { Expression } from "firebase-functions/params";
import type { RESET_VALUE } from "firebase-functions/options";

export const removeTrailingSlash = (str: string) => str.replace(/\/+$/, "");

// serializer

const VAL_UNDEFINED = () => "@__FIREQUEUE_VAL_UNDEFINED__" as const;
const VAL_NULL = () => "@__FIREQUEUE_VAL_NULL__" as const;
const VAL_NAN = () => "@__FIREQUEUE_VAL_NAN__" as const;

export const defaultSerializer: Serializer = {
  stringify: (data: unknown): string => {
    if (data === undefined) {
      return VAL_UNDEFINED();
    } else if (data === null) {
      return VAL_NULL();
    } else if (Number.isNaN(data)) {
      return VAL_NAN();
    }

    return JSON.stringify(data);
  },

  parse: (str: string): unknown => {
    if (str === VAL_UNDEFINED()) {
      return undefined;
    } else if (str === VAL_NULL()) {
      return null;
    } else if (str === VAL_NAN()) {
      return NaN;
    }

    return JSON.parse(str);
  },
};

// logger

type FirebaseLogger = typeof firebaseLogger.logger;

class Logger implements FirebaseLogger {
  private logSeverity: LogSeverity = "INFO";
  private logSeverityMap: Record<LogSeverity, number> = {
    DEBUG: 0,
    INFO: 1,
    NOTICE: 2,
    WARNING: 3,
    ERROR: 4,
    CRITICAL: 5,
    ALERT: 6,
    EMERGENCY: 7,
  };

  public setLogSeverity(severity: LogSeverity) {
    this.logSeverity = severity;
  }

  public write(entry: LogEntry) {
    firebaseLogger.write(entry);
  }

  public debug(...args: any[]) {
    if (this.logSeverityMap["DEBUG"] >= this.logSeverityMap[this.logSeverity]) {
      firebaseLogger.debug(...args);
    }
  }

  public log(...args: any[]) {
    if (this.logSeverityMap["INFO"] >= this.logSeverityMap[this.logSeverity]) {
      firebaseLogger.log(...args);
    }
  }

  public info(...args: any[]) {
    if (this.logSeverityMap["INFO"] >= this.logSeverityMap[this.logSeverity]) {
      firebaseLogger.info(...args);
    }
  }

  public warn(...args: any[]) {
    if (
      this.logSeverityMap["WARNING"] >= this.logSeverityMap[this.logSeverity]
    ) {
      firebaseLogger.warn(...args);
    }
  }

  public error(...args: any[]) {
    if (this.logSeverityMap["ERROR"] >= this.logSeverityMap[this.logSeverity]) {
      firebaseLogger.error(...args);
    }
  }
}

export const logger = new Logger();

// time string parser

export const timeStringToMs = (str: TimeString): number => {
  const match = str.match(/^(\d+)(ms|s|m|h|d|w|mo|yr)$/);
  if (!match) {
    throw new Error(`Invalid time string: ${str}`);
  }

  const numberMatch = match[1];

  if (!numberMatch && numberMatch !== "0") {
    throw new Error(`Invalid time string: ${str}`);
  }

  const value = parseInt(numberMatch, 10);
  const unit = match[2];

  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    case "mo":
      return value * 30 * 24 * 60 * 60 * 1000; // Approx 30 days
    case "yr":
      return value * 365 * 24 * 60 * 60 * 1000; // Approx 365 days
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
};

// firestore utils

export function unwrapFirestoreOptionsValue<
  T extends string | number | boolean | string[]
>(val: T | Expression<T> | typeof RESET_VALUE | undefined): T | undefined {
  if (typeof val !== "object" || Array.isArray(val)) {
    return val;
  }

  if ("value" in val) {
    return val.value();
  }

  return undefined;
}
