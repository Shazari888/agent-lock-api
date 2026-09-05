import "fastify";
import type { Env } from "./env.js";
import type { RepositoryBundle } from "./repositories/interfaces.js";

declare module "fastify" {
  interface FastifyInstance {
    repositories: RepositoryBundle;
    env: Env;
  }
}

