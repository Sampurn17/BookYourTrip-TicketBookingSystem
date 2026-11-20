const config = require('../config');
const { Provider } = require('../models');
const { runAgent } = require('../agent/agent');
const { registry, listCities } = require('../agent/tools');
const { createLLMClient } = require('../agent/llm');

exports.chat = async (req, res) => {
  const user = req.user || null;
  const ctx = {
    user,
    role: user ? user.role : 'guest',
    provider: user && user.role === 'provider' ? await Provider.findOne({ userId: user._id }) : null,
    now: new Date(),
  };
  const result = await runAgent({
    messages: req.validated.body.messages,
    ctx,
    llm: createLLMClient(),
    registry,
    listCities,
    model: config.llm.model,
    maxSteps: config.llm.maxSteps,
  });
  res.json({ status: 'success', ...result });
};
