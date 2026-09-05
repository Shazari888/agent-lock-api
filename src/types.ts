export type Decision = "ALLOW" | "BLOCK" | "REVIEW";

export type EnforcementMode = "OBSERVE" | "REVIEW" | "ENFORCE";

export type ReasonCode =
  | "MALFORMED_INPUT"
  | "AUTH_FAILED"
  | "PARSER_UNCERTAIN"
  | "INTERNAL_ERROR"
  | "POLICY_NOT_FOUND"
  | "POLICY_BLOCKED_COMMAND"
  | "POLICY_BLOCKED_PATTERN"
  | "CONTEXT_NOT_VERIFIED"
  | "MODE_OBSERVE_ESCALATION"
  | "MODE_REVIEW_REQUIRED"
  | "EMERGENCY_BYPASS_ACTIVE"
  | "REQUEST_EXPIRED"
  | "COMMAND_HASH_MISMATCH";

export type ContextTrustModel = {
  declared: "unknown" | "untrusted" | "trusted";
  observed: "unknown" | "untrusted" | "trusted";
  verified: "unknown" | "untrusted" | "trusted";
};

export type IntegrityFields = {
  command_hash?: string;
  expected_execution_hash?: string;
  identity_binding?: Record<string, string>;
  context_binding?: Record<string, string>;
  policy_version?: string;
  expires_at?: string;
  execution_status?: "pending" | "executed" | "rejected" | "unknown";
};

export type ValidateInput = {
  policy_id: string;
  command: string;
  shell: "bash" | "zsh";
  context_trust: ContextTrustModel;
  integrity: IntegrityFields;
};

export type ValidateResult = {
  decision: Decision;
  reason_codes: ReasonCode[];
  normalized_command: string;
  tokens: string[];
};

