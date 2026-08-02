function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatTimestamp(value) {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toISOString();
}

function buildDashboardMarkdown({ generatedAt, userId, agents }) {
  const lines = [
    "# Agent Guard Dashboard",
    "",
    `- Generated: ${formatTimestamp(generatedAt)}`,
    `- User ID: ${userId}`,
    ""
  ];

  if (!agents.length) {
    lines.push("No agents found for this user.");
    return lines.join("\n");
  }

  lines.push("| Agent | Status | Kill Switch | Daily Budget | Today's Spend | Remaining | Last Pulse | Progress |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- | ---: |");

  for (const agent of agents) {
    const remainingBudget = Math.max(Number(agent.daily_budget || 0) - Number(agent.today_spend || 0), 0);
    const lastTask = agent.last_pulse ? agent.last_pulse.task : "N/A";
    const lastProgress = agent.last_pulse ? `${agent.last_pulse.progress}%` : "N/A";

    lines.push(
      `| ${agent.agent_name} | ${agent.status || "active"} | ${agent.kill_switch_command || "CONTINUE"} | ${formatCurrency(agent.daily_budget)} | ${formatCurrency(agent.today_spend)} | ${formatCurrency(remainingBudget)} | ${lastTask} | ${lastProgress} |`
    );
  }

  for (const agent of agents) {
    lines.push("");
    lines.push(`## ${agent.agent_name}`);
    lines.push("");
    lines.push(`- Agent ID: ${agent.id}`);
    lines.push(`- API Key Prefix: ${agent.api_key_prefix || "legacy-key"}`);
    lines.push(`- Status: ${agent.status || "active"}`);
    lines.push(`- Kill Switch: ${agent.kill_switch_command || "CONTINUE"}`);
    lines.push(`- Daily Budget: ${formatCurrency(agent.daily_budget)}`);
    lines.push(`- Today's Spend: ${formatCurrency(agent.today_spend)}`);
    lines.push(`- Last Used: ${formatTimestamp(agent.last_used_at)}`);
    lines.push(`- Updated At: ${formatTimestamp(agent.updated_at)}`);
    lines.push("");
    lines.push("### Last Pulse");
    lines.push("");

    if (agent.last_pulse) {
      lines.push(`- Task: ${agent.last_pulse.task}`);
      lines.push(`- Progress: ${agent.last_pulse.progress}%`);
      lines.push(`- Current Cost: ${formatCurrency(agent.last_pulse.current_cost)}`);
      lines.push(`- Timestamp: ${formatTimestamp(agent.last_pulse.timestamp)}`);
    } else {
      lines.push("- No pulse received yet.");
    }

    lines.push("");
    lines.push("### Saved State");
    lines.push("");
    lines.push(agent.state_summary || "No saved state snapshot.");
  }

  return lines.join("\n");
}

module.exports = {
  buildDashboardMarkdown
};
