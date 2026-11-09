import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.CRM_SYNTHETIC_PREVIEW === "1") {
    // Fail closed even if a future server component accidentally attempts I/O.
    if (process.env.NEXT_RUNTIME === "nodejs" && !globalThis.fetch.__crmSyntheticBlocked) {
      const blockedFetch = async () => { throw new Error("External network disabled in synthetic CRM preview"); };
      blockedFetch.__crmSyntheticBlocked = true;
      // Next patches fetch after register(). Keep the preview boundary in place
      // when framework instrumentation attempts to replace that function.
      Object.defineProperty(globalThis, "fetch", { configurable: false, get: () => blockedFetch, set: () => {} });
    }
    return;
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "development") {
      const ignoreClosedOutputPipe = (error) => {
        if (error?.code !== "EPIPE") throw error;
      };
      process.stdout.on("error", ignoreClosedOutputPipe);
      process.stderr.on("error", ignoreClosedOutputPipe);
    }
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
