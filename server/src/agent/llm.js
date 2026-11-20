/** LLM client factory. Any OpenAI-compatible endpoint works (OpenAI, Groq, Gemini, Ollama, ...). */
const config = require('../config');

let cached;

function createLLMClient() {
  if (cached !== undefined) return cached;
  if (!config.llm.apiKey) {
    cached = null;
    return cached;
  }
  // eslint-disable-next-line global-require
  const mod = require('openai');
  const OpenAI = mod.OpenAI || mod.default || mod;
  cached = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseURL, timeout: 20000, maxRetries: 1 });
  return cached;
}

module.exports = { createLLMClient };
