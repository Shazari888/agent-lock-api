import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { createPrismaRepository } from "./repositories/prismaRepositories.js";

const env = loadEnv();
const prisma = new PrismaClient();
const repositories = createPrismaRepository(prisma);
const app = createApp(env, repositories);

const closeSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of closeSignals) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ port: env.PORT }, "AgentLock API started");
  })
  .catch(async (error) => {
    app.log.error({ err: error }, "Failed to start AgentLock API");
    await prisma.$disconnect();
    process.exit(1);
  });
