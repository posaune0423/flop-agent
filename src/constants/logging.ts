export const LOG_LEVELS = ["ERROR", "WARN", "LOG", "INFO", "DEBUG"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = "INFO";
