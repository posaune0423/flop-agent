import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { DEFAULT_LOG_LEVEL, LOG_LEVELS } from "./constants/logging.ts";

export function createPublicEnv(runtimeEnv: { LOG_LEVEL?: string }) {
  return createEnv({
    server: {
      LOG_LEVEL: z.enum(LOG_LEVELS).default(DEFAULT_LOG_LEVEL),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    onValidationError: (issues) => {
      throw new Error("Invalid environment variables", { cause: issues });
    },
  });
}

export const publicEnv = createPublicEnv({
  LOG_LEVEL: Deno.env.get("LOG_LEVEL"),
});
