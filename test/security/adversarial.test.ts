import { describe, expect, it } from "vitest";
import { createTestApp, TEST_API_KEY, TEST_POLICY_ID, TEST_TENANT } from "../helpers/testApp.js";

describe("security adversarial tests", () => {
  it("fails closed on malformed payload", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/validate",
      headers: {
        "x-tenant-id": TEST_TENANT,
        "x-api-key": TEST_API_KEY
      },
      payload: {
        policy_id: TEST_POLICY_ID,
        command: "",
        shell: "bash",
        context_trust: {},
        integrity: {}
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MALFORMED_INPUT");
    await app.close();
  });

  it("fails closed on missing auth", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/validate",
      payload: {
        policy_id: TEST_POLICY_ID,
        command: "echo hello",
        shell: "bash",
        context_trust: {
          declared: "trusted",
          observed: "trusted",
          verified: "trusted"
        },
        integrity: {}
      }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_FAILED");
    await app.close();
  });

  it("fails closed on parser uncertainty", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/validate",
      headers: {
        "x-tenant-id": TEST_TENANT,
        "x-api-key": TEST_API_KEY
      },
      payload: {
        policy_id: TEST_POLICY_ID,
        command: "echo `whoami`",
        shell: "bash",
        context_trust: {
          declared: "trusted",
          observed: "trusted",
          verified: "trusted"
        },
        integrity: {}
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().decision).toBe("BLOCK");
    expect(response.json().reason_codes).toContain("PARSER_UNCERTAIN");
    await app.close();
  });
});

