import type { FastifyInstance } from "fastify";

export async function registerHealthRoute(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      await app.repositories.ping();
      return {
        status: "ok",
        service: "agentlock-api"
      };
    } catch {
      return reply.code(503).send({
        status: "degraded",
        service: "agentlock-api",
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database is unavailable"
        }
      });
    }
  });
}
