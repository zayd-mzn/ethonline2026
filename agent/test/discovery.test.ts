/**
 * Tests for service discovery parsing.
 *
 * Exercises DiscoveryClient.listServices with an injected fake fetch so the
 * payload-validation logic (toService) is covered without a live backend.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ActivityEmitter } from "../src/activity.js";
import { DiscoveryClient, type FetchLike } from "../src/discovery.js";
import type { Service } from "../src/types.js";

/** A fetch stub that returns a fixed status + JSON body. */
function fakeFetch(status: number, body: unknown): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function validService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc-1",
    name: "IP Reputation",
    description: "Checks IP reputation",
    endpoint: "/api/ip-reputation",
    queryType: "ip",
    priceHbar: 0.02,
    providerId: "prov-1",
    createdAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

function newClient(fetchImpl: FetchLike): DiscoveryClient {
  return new DiscoveryClient({
    backendUrl: "http://localhost:3001",
    emitter: new ActivityEmitter(),
    fetchImpl,
  });
}

test("parses a well-formed services list", async () => {
  const services = [validService(), validService({ id: "svc-2", queryType: "hash" })];
  const client = newClient(fakeFetch(200, { services }));

  const result = await client.listServices();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "svc-1");
  assert.equal(result[1].queryType, "hash");
});

test("drops malformed service entries but keeps valid ones", async () => {
  const services = [
    validService(),
    { id: "bad", queryType: "dns" }, // invalid queryType
    { ...validService({ id: "svc-3" }), priceHbar: "free" }, // wrong type
    validService({ id: "svc-4" }),
  ];
  const client = newClient(fakeFetch(200, { services }));

  const result = await client.listServices();
  assert.deepEqual(
    result.map((s) => s.id),
    ["svc-1", "svc-4"],
  );
});

test("returns an empty list when services array is empty", async () => {
  const client = newClient(fakeFetch(200, { services: [] }));
  assert.deepEqual(await client.listServices(), []);
});

test("throws when the response lacks a services array", async () => {
  const client = newClient(fakeFetch(200, { nope: true }));
  await assert.rejects(client.listServices(), /missing a 'services' array/);
});

test("throws on a non-OK HTTP status", async () => {
  const client = newClient(fakeFetch(500, {}));
  await assert.rejects(client.listServices(), /status 500/);
});

test("emits a discover event with the service count", async () => {
  const emitter = new ActivityEmitter();
  const seen: { stage: string; detail: string }[] = [];
  emitter.subscribe((e) => seen.push({ stage: e.stage, detail: e.detail }));

  const client = new DiscoveryClient({
    backendUrl: "http://localhost:3001",
    emitter,
    fetchImpl: fakeFetch(200, { services: [validService()] }),
  });
  await client.listServices();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].stage, "discover");
  assert.match(seen[0].detail, /found 1 service/);
});
