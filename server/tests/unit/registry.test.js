const { createRegistry, truncateForModel, MAX_TOOL_OUTPUT } = require('../../src/agent/registry');

const tools = [
  {
    name: 'echo',
    description: 'echo',
    roles: ['guest', 'customer'],
    parameters: { type: 'object', properties: {} },
    card: (res) => ({ type: 'echo', value: res.value }),
    handler: async (args) => ({ value: args.value }),
  },
  {
    name: 'propose',
    description: 'propose',
    roles: ['customer'],
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ action: { type: 'do_it' } }),
  },
  {
    name: 'boom',
    description: 'fails',
    roles: ['customer'],
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const err = new Error('kaput');
      err.code = 'BOOM';
      throw err;
    },
  },
];

const state = () => ({ cards: [], actions: [], toolCalls: [] });

describe('agent/registry', () => {
  const registry = createRegistry(tools);

  test('filters tools by role and exports OpenAI tool schemas', () => {
    expect(registry.forRole('guest').map((t) => t.name)).toEqual(['echo']);
    const defs = registry.toOpenAITools('customer');
    expect(defs).toHaveLength(3);
    expect(defs[0]).toEqual({ type: 'function', function: { name: 'echo', description: 'echo', parameters: tools[0].parameters } });
    expect(registry.has('echo')).toBe(true);
  });

  test('executes tools and collects cards and actions', async () => {
    const s = state();
    expect(await registry.execute('echo', { value: 3 }, { role: 'customer' }, s)).toEqual({ value: 3 });
    await registry.execute('propose', {}, { role: 'customer' }, s);
    expect(s.cards).toEqual([{ type: 'echo', value: 3 }]);
    expect(s.actions).toEqual([{ type: 'do_it' }]);
    expect(s.toolCalls.map((c) => c.name)).toEqual(['echo', 'propose']);
  });

  test('enforces role permissions regardless of what the model asks for', async () => {
    const s = state();
    expect((await registry.execute('propose', {}, { role: 'guest' }, s)).error).toMatch(/log in/);
    expect((await registry.execute('propose', {}, { role: 'provider' }, s)).error).toMatch(/not available/);
    expect(s.actions).toHaveLength(0);
  });

  test('turns unknown tools and thrown errors into data', async () => {
    const s = state();
    expect((await registry.execute('nope', {}, { role: 'customer' }, s)).error).toMatch(/Unknown tool/);
    expect(await registry.execute('boom', null, { role: 'customer' }, s)).toEqual({ error: 'kaput', code: 'BOOM' });
  });

  test('truncates large tool output for the model', () => {
    const big = { text: 'x'.repeat(MAX_TOOL_OUTPUT * 2) };
    const out = truncateForModel(big);
    expect(out.length).toBeLessThan(MAX_TOOL_OUTPUT + 50);
    expect(out.endsWith('(truncated)')).toBe(true);
    expect(truncateForModel(undefined)).toBe('null');
  });
});
