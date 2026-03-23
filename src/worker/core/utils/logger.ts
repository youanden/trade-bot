type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private context: Record<string, unknown>;
  private minLevel: LogLevel;

  constructor(
    context: Record<string, unknown> = {},
    minLevel: LogLevel = "info"
  ) {
    this.context = context;
    this.minLevel = minLevel;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra }, this.minLevel);
  }

  debug(msg: string, data?: Record<string, unknown>) {
    this.log("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>) {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>) {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>) {
    this.log("error", msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...this.context,
      ...data,
    };

    const output = JSON.stringify(entry);

    switch (level) {
      case "error":
        console.error(output);
        break;
      case "warn":
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }
}

export const logger = new Logger();
