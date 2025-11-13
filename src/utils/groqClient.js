require('dotenv').config();

let _client = null;

async function getGroqClient() {
  if (_client) return _client;

  const apiKey = process.env.GROQ_API_KEY;


  if (!apiKey) {
    console.warn('[GroqClient] Missing GROQ_API_KEY → using dummy client (fallback-local).');
    _client = {
      chat: {
        completions: {
          create: async (_payload, _opts) => ({
            id: 'dummy',
            object: 'chat.completion',
            created: Date.now() / 1000,
            model: 'dummy',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        },
      },
    };
    return _client;
  }


  const Groq = (await import('groq-sdk')).default;

  _client = new Groq({ apiKey });

  console.log('[GroqClient] Ready (groq-sdk)');
  return _client;
}

module.exports = { getGroqClient };

