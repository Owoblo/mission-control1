import * as Sentry from "@sentry/nextjs";

export async function register() {
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
