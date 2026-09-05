export type CommandNormalization = {
  normalized: string;
  tokens: string[];
  uncertain: boolean;
};

function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function tokenizeShellCommand(command: string): CommandNormalization {
  const normalized = collapseWhitespace(command);
  if (!normalized) {
    return { normalized, tokens: [], uncertain: true };
  }

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;

    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === " ") {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (token.length > 0) {
    tokens.push(token);
  }

  const hasSuspiciousSubshell = normalized.includes("$(") || normalized.includes("`");
  const hasUnclosedQuote = quote !== null;
  const hasNoCommand = tokens.length === 0;

  return {
    normalized,
    tokens,
    uncertain: hasSuspiciousSubshell || hasUnclosedQuote || hasNoCommand
  };
}

