import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { DEFAULT_LOG_LEVEL, LOG_LEVELS } from "./constants/logging.ts";

export const env = createEnv({
  server: {
    LOG_LEVEL: z.enum(LOG_LEVELS).default(DEFAULT_LOG_LEVEL),
  },
  runtimeEnv: {
    LOG_LEVEL: Deno.env.get("LOG_LEVEL"),
  },
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    throw new Error("Invalid environment variables", { cause: issues });
  },
});

export { env as publicEnv };
