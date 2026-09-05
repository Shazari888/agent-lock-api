import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/domain/policyEngine.js";
import { createSeedPolicy } from "../helpers/testApp.js";
import type { ValidateInput } from "../../src/types.js";

function makeInput(command: string): ValidateInput {
  return {
    policy_id: "policy_test_1",
    command,
    shell: "bash",
    context_trust: {
      declared: "trusted",
      observed: "trusted",
      verified: "trusted"
    },
    integrity: {}
  };
}

describe("policy engine", () => {
  it("blocks parser uncertainty", () => {
    const result = evaluatePolicy(makeInput("echo $(cat /etc/passwd)"), createSeedPolicy("ENFORCE"));
    expect(result.decision).toBe("BLOCK");
    expect(result.reason_codes).toContain("PARSER_UNCERTAIN");
  });

  it("enforces blocked command in enforce mode", () => {
    const result = evaluatePolicy(makeInput("rm -rf /tmp/demo"), createSeedPolicy("ENFORCE"));
    expect(result.decision).toBe("BLOCK");
    expect(result.reason_codes).toContain("POLICY_BLOCKED_COMMAND");
  });

  it("downgrades policy block to review in observe mode", () => {
    const result = evaluatePolicy(makeInput("rm -rf /tmp/demo"), createSeedPolicy("OBSERVE"));
    expect(result.decision).toBe("REVIEW");
    expect(result.reason_codes).toContain("MODE_OBSERVE_ESCALATION");
  });

  it("forces review in review mode", () => {
    const result = evaluatePolicy(makeInput("echo hello"), createSeedPolicy("REVIEW"));
    expect(result.decision).toBe("REVIEW");
    expect(result.reason_codes).toContain("MODE_REVIEW_REQUIRED");
  });

  it("keeps fail-closed reasons blocked even in review mode", () => {
    const result = evaluatePolicy(makeInput("echo `uname -a`"), createSeedPolicy("REVIEW"));
    expect(result.decision).toBe("BLOCK");
    expect(result.reason_codes).toContain("PARSER_UNCERTAIN");
  });
});

