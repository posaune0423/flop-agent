import { DEFAULT_LOG_LEVEL } from "./constants/logging.ts";

export const publicEnv = {
  LOG_LEVEL: DEFAULT_LOG_LEVEL,
} as const;
