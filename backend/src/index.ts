/**
 * Cyber Intel Marketplace — Backend API server (Member 2)
 *
 * Entry point. Boots a Fastify server with a health check.
 * Threat-intel endpoints, the service registry, metering, and the
 * x402 payment gate are added in later phases.
 */

import Fastify from "fastify";
import { listServices, seedServices, createService } from "./registry.js";
import type { ServicesListResponse,CreateServiceRequest } from "./types.js";
import { worldIdentity } from "./identity.js";
import { lookupIpReputation, checkHash } from "./intel.js";
import { paymentGate } from "./paymentGate.stub.js";
import { getServiceByEndpoint } from "./registry.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { status: "ok", service: "cyber-intel-backend" };
});

// Discovery: agents and the frontend call this to see available services.
app.get("/marketplace/services", async (): Promise<ServicesListResponse> => {
  return { services: listServices() };
});

// Publish a service. Gated by Selfie Check (stubbed until M4's identity.ts lands).
app.post("/marketplace/services", async (request,reply) => {
    const proof = request.headers["x-selfie-check-proof"];
    if (typeof proof !== "string") {
        return reply.code(401).send({
            error: "unauthorized",
            message: "Missing X-Selfie-Check-Proof header",
        });
    }

    const verified = await worldIdentity.verifySelfieCheck(proof);
    if (!verified) {
        return reply.code(401).send({
            error: "unauthorized",
            message: "Invalid Selfie Check proof",
        });
    }

    const body = request.body as CreateServiceRequest;
    if (!body?.name || !body?.endpoint || !body?.queryType || body?.priceHbar == null) {
        return reply.code(400).send({
            error: "validation_error",
            message: "name, endpoint, queryType, and priceHbar are required",
        });
    }

    if (body.queryType !== "ip" && body.queryType !== "hash") {
        return reply.code(400).send({
            error: "validation_error",
            message: 'queryType must be "ip" or "hash"',
        });
    }
    
    const service = createService(body, verified.providerId);
    return reply.code(201).send(service);
});

// Threat-intel services. These will be payment-gated by M1's paymentGate.
const priceFor = (resource: string) => getServiceByEndpoint(resource)?.priceHbar;

app.get("/api/ip-reputation", 
  { preHandler: paymentGate({ lookupPrice: priceFor, resource: "/api/ip-reputation" }) },
  async (request, reply) => {
  const ip = (request.query as { ip?: string }).ip;
  if (!ip) {
    return reply.code(400).send({ error: "validation_error", message: "query param 'ip' is required" });
  }
  return lookupIpReputation(ip);
});

app.get("/api/hash-check",
  { preHandler: paymentGate({ lookupPrice: priceFor, resource: "/api/hash-check" }) },
  async (request, reply) => {
  const hash = (request.query as { hash?: string }).hash;
  if (!hash) {
    return reply.code(400).send({ error: "validation_error", message: "query param 'hash' is required" });
  }
  return checkHash(hash);
});

async function main(): Promise<void> {
  try {
    seedServices();                       // populate registry before serving
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();