/**
 * Cyber Intel Marketplace — Backend API server (Member 2)
 *
 * Entry point. Boots a Fastify server with a health check.
 * Threat-intel endpoints, the service registry, metering, and the
 * x402 payment gate are added in later phases.
 */

import Fastify from "fastify";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { status: "ok", service: "cyber-intel-backend" };
});

async function main(): Promise<void> {
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();