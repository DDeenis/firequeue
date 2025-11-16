import type { LogEntry, LogSeverity } from "firebase-functions/logger";
import { type Serializer } from "./types.js";
import * as firebaseLogger from "firebase-functions/logger";

export const removeTrailingSlash = (str: string) => str.replace(/\/+$/, "");

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
