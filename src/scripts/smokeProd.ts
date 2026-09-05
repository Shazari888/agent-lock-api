type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function getRequired(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function requestJson<T extends JsonObject>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, init);
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new Error(`Non-JSON response from ${url}: status=${response.status}`);
  }

  if (!response.ok) {
    throw new Error(
      `Request failed for ${url}: status=${response.status} body=${JSON.stringify(data)}`
    );
  }
  return { status: response.status, data };
}

async function main() {
  const baseUrl = getRequired("AGENTLOCK_BASE_URL").replace(/\/+$/, "");
  const bootstrapToken = getRequired("BOOTSTRAP_TOKEN");
  const tenantId = process.env.TENANT_ID?.trim() || "tenant_demo";
  const policyId = process.env.POLICY_ID?.trim() || "policy_default";

  const health = await requestJson<{ status: string; service: string }>(`${baseUrl}/health`);

  const keyCreate = await requestJson<{
    api_key: string;
    key_id: string;
    key_prefix: string;
  }>(`${baseUrl}/v1/keys`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": bootstrapToken
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      name: "smoke-client",
      scopes: ["validate:write", "audit:read", "policies:read", "keys:write"]
    })
  });

  const authHeaders = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
    "x-api-key": keyCreate.data.api_key
  };

  const validateSingle = await requestJson<{
    decision: string;
    reason_codes: string[];
  }>(`${baseUrl}/v1/validate`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      policy_id: policyId,
      command: "echo hello",
      shell: "bash",
      context_trust: {
        declared: "trusted",
        observed: "trusted",
        verified: "trusted"
      },
      integrity: {}
    })
  });

  const validateBatch = await requestJson<{
    summary: { allow: number; block: number; review: number };
  }>(`${baseUrl}/v1/validate/batch`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      items: [
        {
          policy_id: policyId,
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
          policy_id: policyId,
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
    })
  });

  const audit = await requestJson<{ rows: JsonValue[] }>(`${baseUrl}/v1/audit?limit=5`, {
    method: "GET",
    headers: {
      "x-tenant-id": tenantId,
      "x-api-key": keyCreate.data.api_key
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        base_url: baseUrl,
        health: health.data,
        key_created: {
          key_id: keyCreate.data.key_id,
          key_prefix: keyCreate.data.key_prefix
        },
        validate_single: validateSingle.data,
        validate_batch_summary: validateBatch.data.summary,
        audit_rows_returned: audit.data.rows.length
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

