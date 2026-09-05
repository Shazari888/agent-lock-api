import type { FastifyInstance } from "fastify";

export async function registerHealthRoute(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "agentlock-api"
  }));
}
