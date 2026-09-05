import { sha256 } from "../lib/crypto.js";
import type { Decision, ReasonCode, ValidateInput, ValidateResult } from "../types.js";
import type { PolicyRecord } from "../repositories/interfaces.js";
import { tokenizeShellCommand } from "./normalizeCommand.js";

const FAIL_CLOSED_REASONS: ReadonlySet<ReasonCode> = new Set([
  "MALFORMED_INPUT",
  "AUTH_FAILED",
  "PARSER_UNCERTAIN",
  "INTERNAL_ERROR",
  "REQUEST_EXPIRED",
  "COMMAND_HASH_MISMATCH"
]);

function baseDecision(input: ValidateInput, policy: PolicyRecord): ValidateResult {
  const normalized = tokenizeShellCommand(input.command);
  if (normalized.uncertain) {
    return {
      decision: "BLOCK",
      reason_codes: ["PARSER_UNCERTAIN"],
      normalized_command: normalized.normalized,
      tokens: normalized.tokens
    };
  }

  if (input.integrity.expires_at) {
    const expiresAt = Date.parse(input.integrity.expires_at);
    if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
      return {
        decision: "BLOCK",
        reason_codes: ["REQUEST_EXPIRED"],
        normalized_command: normalized.normalized,
        tokens: normalized.tokens
      };
    }
  }

  if (input.integrity.command_hash) {
    const commandHash = sha256(normalized.normalized);
    if (commandHash !== input.integrity.command_hash) {
      return {
        decision: "BLOCK",
        reason_codes: ["COMMAND_HASH_MISMATCH"],
        normalized_command: normalized.normalized,
        tokens: normalized.tokens
      };
    }
  }

  const firstToken = normalized.tokens[0]?.toLowerCase() ?? "";
  const baseCommand = firstToken.split("/").at(-1) ?? firstToken;

  if (policy.blocked_commands.map((command) => command.toLowerCase()).includes(baseCommand)) {
    return {
      decision: "BLOCK",
      reason_codes: ["POLICY_BLOCKED_COMMAND"],
      normalized_command: normalized.normalized,
      tokens: normalized.tokens
    };
  }

  const normalizedLower = normalized.normalized.toLowerCase();
  if (policy.blocked_patterns.some((pattern) => normalizedLower.includes(pattern.toLowerCase()))) {
    return {
      decision: "BLOCK",
      reason_codes: ["POLICY_BLOCKED_PATTERN"],
      normalized_command: normalized.normalized,
      tokens: normalized.tokens
    };
  }

  if (policy.require_verified_context && input.context_trust.verified !== "trusted") {
    return {
      decision: "REVIEW",
      reason_codes: ["CONTEXT_NOT_VERIFIED"],
      normalized_command: normalized.normalized,
      tokens: normalized.tokens
    };
  }

  return {
    decision: "ALLOW",
    reason_codes: [],
    normalized_command: normalized.normalized,
    tokens: normalized.tokens
  };
}

function hasFailClosedReason(reasons: ReasonCode[]): boolean {
  return reasons.some((reason) => FAIL_CLOSED_REASONS.has(reason));
}

export function evaluatePolicy(input: ValidateInput, policy: PolicyRecord): ValidateResult {
  let result = baseDecision(input, policy);
  const failClosed = hasFailClosedReason(result.reason_codes);

  if (policy.emergency_bypass && result.decision === "BLOCK" && !failClosed) {
    result = {
      ...result,
      decision: "REVIEW",
      reason_codes: [...result.reason_codes, "EMERGENCY_BYPASS_ACTIVE"]
    };
  }

  if (policy.mode === "OBSERVE" && result.decision === "BLOCK" && !failClosed) {
    return {
      ...result,
      decision: "REVIEW",
      reason_codes: [...result.reason_codes, "MODE_OBSERVE_ESCALATION"]
    };
  }

  if (policy.mode === "REVIEW" && result.decision !== "BLOCK") {
    return {
      ...result,
      decision: "REVIEW",
      reason_codes: [...result.reason_codes, "MODE_REVIEW_REQUIRED"]
    };
  }

  if (policy.mode === "REVIEW" && result.decision === "BLOCK" && !failClosed) {
    return {
      ...result,
      decision: "REVIEW",
      reason_codes: [...result.reason_codes, "MODE_REVIEW_REQUIRED"]
    };
  }

  return result;
}

export function failClosed(reason: ReasonCode, normalized = "", tokens: string[] = []): ValidateResult {
  return {
    decision: "BLOCK" satisfies Decision,
    reason_codes: [reason],
    normalized_command: normalized,
    tokens
  };
}

