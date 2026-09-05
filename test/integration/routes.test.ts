import { describe, expect, it } from "vitest";
import {
  createTestApp,
  TEST_API_KEY,
  TEST_BOOTSTRAP_TOKEN,
  TEST_POLICY_ID,
  TEST_TENANT
} from "../helpers/testApp.js";

const headers = {
  "x-tenant-id": TEST_TENANT,
  "x-api-key": TEST_API_KEY
};

describe("v1 routes", () => {
  it("serves health endpoint", async () => {
    const app = createTestApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
    await app.close();
  });

  it("returns review when context is not verified", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/validate",
      headers,
      payload: {
        policy_id: TEST_POLICY_ID,
        command: "echo hello",
        shell: "bash",
        context_trust: {
          declared: "trusted",
          observed: "trusted",
          verified: "untrusted"
        },
        integrity: {}
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.decision).toBe("REVIEW");
    expect(body.reason_codes).toContain("CONTEXT_NOT_VERIFIED");
    await app.close();
  });

  it("returns policy via tenant-scoped endpoint", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/policies/${TEST_POLICY_ID}`,
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(TEST_POLICY_ID);
    await app.close();
  });

  it("writes audit and reads audit entries", async () => {
    const app = createTestApp();
    await app.inject({
      method: "POST",
      url: "/v1/validate",
      headers,
      payload: {
        policy_id: TEST_POLICY_ID,
        command: "rm -rf /tmp/demo",
        shell: "bash",
        context_trust: {
          declared: "trusted",
          observed: "trusted",
          verified: "trusted"
        },
        integrity: {}
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/audit?limit=10",
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rows.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns batch decision summary", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/validate/batch",
      headers,
      payload: {
        items: [
          {
            policy_id: TEST_POLICY_ID,
            command: "echo hello",
            shell: "bash",
            context_trust: {
              declared: "trusted",
              observed: "trusted",
              verified: "trusted"
            },
            integrity: {}
          },
          {
            policy_id: TEST_POLICY_ID,
            command: "rm -rf /tmp/demo",
            shell: "bash",
            context_trust: {
              declared: "trusted",
              observed: "trusted",
              verified: "trusted"
            },
            integrity: {}
          }
        ]
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.allow).toBe(1);
    expect(body.summary.block).toBe(1);
    expect(body.summary.review).toBe(0);
    await app.close();
  });

  it("allows bootstrap key creation when tenant has no keys", async () => {
    const app = createTestApp({ includeApiKey: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: {
        "x-bootstrap-token": TEST_BOOTSTRAP_TOKEN
      },
      payload: {
        tenant_id: TEST_TENANT,
        name: "bootstrap-key",
        scopes: ["validate:write"]
      }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.api_key).toMatch(/^alk_/);
    expect(body.key_prefix.length).toBeGreaterThan(5);
    await app.close();
  });
});
