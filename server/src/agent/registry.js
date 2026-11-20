/**
 * Tool registry (Command + Registry pattern).
 *
 * Every capability the agent has is a declarative tool:
 *   { name, description, parameters (JSON schema), roles, card?, handler(args, ctx) }
 *
 * Guard rails enforced here - not in the prompt - so a jailbroken model still cannot:
 *   - call a tool outside the user's role,
 *   - act on another user's data (ctx.user comes from the verified JWT),
 *   - execute destructive actions (those tools only *propose*; the UI confirms).
 */
const MAX_TOOL_OUTPUT = 6000;

function createRegistry(tools) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  function forRole(role) {
    return tools.filter((t) => t.roles.includes(role));
  }

  function toOpenAITools(role) {
    return forRole(role).map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  /**
   * Execute a tool on behalf of ctx.user. Never throws: errors are returned
   * to the model as data so it can explain them to the user.
   * @param {{cards: any[], actions: any[], toolCalls: any[]}} state collected UI artefacts
   */
  async function execute(name, args, ctx, state) {
    const tool = byName.get(name);
    state.toolCalls.push({ name, args });
    if (!tool) return { error: `Unknown tool "${name}"` };
    if (!tool.roles.includes(ctx.role)) {
      return { error: ctx.role === 'guest' ? 'The user must log in to do this.' : 'This action is not available for your role.' };
    }
    try {
      const result = await tool.handler(args || {}, ctx);
      if (result && result.action) state.actions.push(result.action);
      if (tool.card && result && !result.error) {
        const card = tool.card(result, args);
        if (card) state.cards.push(card);
      }
      return result;
    } catch (err) {
      return { error: err.message || 'Tool failed', code: err.code };
    }
  }

  return { tools, forRole, toOpenAITools, execute, has: (n) => byName.has(n) };
}

function truncateForModel(value) {
  const text = JSON.stringify(value ?? null);
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}...(truncated)` : text;
}

module.exports = { createRegistry, truncateForModel, MAX_TOOL_OUTPUT };
