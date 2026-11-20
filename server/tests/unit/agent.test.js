const { runAgent, systemPrompt } = require('../../src/agent/agent');
const { createRegistry } = require('../../src/agent/registry');

const NOW = new Date('2025-11-18T06:00:00Z');
const customerCtx = { user: { _id: 'u1', name: 'Asha' }, role: 'customer', now: NOW };

function fakeLLM(script) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (req) => {
          calls.push(JSON.parse(JSON.stringify(req)));
          const next = script.shift();
          if (next instanceof Error) throw next;
          return { choices: [{ message: next }] };
        },
      },
    },
  };
}

const searchHandler = jest.fn(async (args) => ({ date: args.date, count: 1, trips: [{ tripId: 't1', pricePerSeat: 700 }] }));
const cancelHandler = jest.fn(async (args) => ({ proposed: true, action: { type: 'cancel_booking', payload: { pnr: args.pnr } } }));
const registry = createRegistry([
  {
    name: 'search_trips',
    description: 'search',
    roles: ['guest', 'customer'],
    parameters: { type: 'object', properties: {} },
    card: (res) => ({ type: 'trips', trips: res.trips }),
    handler: searchHandler,
  },
  { name: 'cancel_booking', description: 'cancel', roles: ['customer'], parameters: { type: 'object', properties: {} }, handler: cancelHandler },
]);
const listCities = async () => ['Delhi', 'Jaipur'];
const silent = { warn: () => {} };

beforeEach(() => {
  searchHandler.mockClear();
  cancelHandler.mockClear();
});

describe('agent runtime (LLM mode)', () => {
  test('runs the tool-calling loop and returns the final answer with UI cards', async () => {
    const llm = fakeLLM([
      {
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_trips', arguments: '{"source":"Delhi","destination":"Jaipur","date":"2025-11-19"}' } }],
      },
      { content: 'The cheapest option is ₹700.' },
    ]);
    const out = await runAgent({ messages: [{ role: 'user', content: 'Delhi to Jaipur tomorrow' }], ctx: customerCtx, llm, registry, listCities });

    expect(out.mode).toBe('llm');
    expect(out.reply).toBe('The cheapest option is ₹700.');
    expect(searchHandler).toHaveBeenCalledTimes(1);
    expect(out.cards).toEqual([{ type: 'trips', trips: [{ tripId: 't1', pricePerSeat: 700 }] }]);
    // second request contains the assistant tool call and the tool result
    const second = llm.calls[1].messages;
    expect(second[0].role).toBe('system');
    expect(second.at(-2).tool_calls[0].id).toBe('c1');
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(llm.calls[0].tools.map((t) => t.function.name)).toEqual(['search_trips', 'cancel_booking']);
  });

  test('destructive tools only produce a confirmation action', async () => {
    const llm = fakeLLM([
      { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'cancel_booking', arguments: '{"pnr":"BYTAAAAAA"}' } }] },
      { content: 'Press Confirm to cancel.' },
    ]);
    const out = await runAgent({ messages: [{ role: 'user', content: 'cancel BYTAAAAAA' }], ctx: customerCtx, llm, registry, listCities });
    expect(out.actions).toEqual([{ type: 'cancel_booking', payload: { pnr: 'BYTAAAAAA' } }]);
  });

  test('guests only see guest tools and malformed arguments are tolerated', async () => {
    const llm = fakeLLM([
      { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'cancel_booking', arguments: '{not json' } }] },
      { content: 'Please log in first.' },
    ]);
    const out = await runAgent({ messages: [{ role: 'user', content: 'cancel my trip' }], ctx: { role: 'guest', now: NOW }, llm, registry, listCities });
    expect(llm.calls[0].tools.map((t) => t.function.name)).toEqual(['search_trips']);
    expect(cancelHandler).not.toHaveBeenCalled();
    expect(llm.calls[1].messages.at(-1).content).toMatch(/log in/);
    expect(out.reply).toBe('Please log in first.');
  });

  test('stops after maxSteps to avoid infinite tool loops', async () => {
    const loop = { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'search_trips', arguments: '{}' } }] };
    const llm = fakeLLM([loop, loop, loop]);
    const out = await runAgent({ messages: [{ role: 'user', content: 'hi' }], ctx: customerCtx, llm, registry, listCities, maxSteps: 2 });
    expect(llm.calls).toHaveLength(2);
    expect(out.reply).toMatch(/could not finish/);
  });

  test('falls back to the offline planner when the LLM fails (quota, network)', async () => {
    const err = Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' });
    const llm = fakeLLM([err]);
    const out = await runAgent({
      messages: [{ role: 'user', content: 'buses from Delhi to Jaipur tomorrow' }],
      ctx: customerCtx,
      llm,
      registry,
      listCities,
      logger: silent,
    });
    expect(out.mode).toBe('offline');
    expect(out.notice).toMatch(/offline/);
    expect(searchHandler).toHaveBeenCalledWith(expect.objectContaining({ source: 'Delhi', destination: 'Jaipur', date: '2025-11-19' }), customerCtx);
  });

  test('handles empty LLM responses as failures', async () => {
    const llm = { chat: { completions: { create: async () => ({ choices: [] }) } } };
    const out = await runAgent({ messages: [{ role: 'user', content: 'hello' }], ctx: customerCtx, llm, registry, listCities, logger: silent });
    expect(out.mode).toBe('offline');
  });
});

describe('agent runtime (offline mode)', () => {
  test('runs without an LLM', async () => {
    const out = await runAgent({ messages: [{ role: 'user', content: 'hello' }], ctx: customerCtx, llm: null, registry, listCities });
    expect(out.mode).toBe('offline');
    expect(out.reply).toMatch(/I can help with/);
    expect(out.notice).toBeUndefined();
  });

  test('rejects empty input', async () => {
    const out = await runAgent({ messages: [{ role: 'assistant', content: 'hi' }], ctx: customerCtx, llm: null, registry, listCities });
    expect(out.reply).toBe('Please type a message.');
  });
});

describe('systemPrompt', () => {
  test('grounds the model in today\'s date, the user and the safety rules', () => {
    const p = systemPrompt(customerCtx);
    expect(p).toContain('2025-11-18 (Tuesday)');
    expect(p).toContain('Asha (role: customer)');
    expect(p).toMatch(/Never invent/);
    expect(systemPrompt({ role: 'guest', now: NOW })).toContain('guest');
  });
});
