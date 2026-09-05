import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySensible from "@fastify/sensible";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { Env } from "./env.js";
import type { RepositoryBundle } from "./repositories/interfaces.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerV1Routes } from "./routes/v1.js";
import { createLogger } from "./logger.js";

export function createApp(env: Env, repositories: RepositoryBundle) {
  const app = Fastify({
    logger: createLogger(env),
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    genReqId: () => randomUUID()
  });

  app.decorate("repositories", repositories);
  app.decorate("env", env);

  void app.register(fastifySensible);
  void app.register(fastifyRateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS
  });
  void app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "AgentLock API",
        version: "1.0.0"
      }
    }
  });
  void app.register(fastifySwaggerUi, {
    routePrefix: "/docs"
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled error");
    const isPrismaError =
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientValidationError;

    if (isPrismaError) {
      const prismaCode =
        error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "PRISMA_RUNTIME_ERROR";
      void reply.code(500).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["INTERNAL_ERROR"],
        error: {
          code: "DATABASE_ERROR",
          message: "Database operation failed",
          details: {
            prisma_code: prismaCode
          }
        }
      });
      return;
    }

    void reply.code(500).send({
      request_id: request.id,
      decision: "BLOCK",
      reason_codes: ["INTERNAL_ERROR"],
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      request_id: request.id,
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    });
  });

  void app.register(registerHealthRoute);
  void app.register(registerV1Routes);

  return app;
}
