function parseJsonOutput(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (match) {
      return JSON.parse(match[1]);
    }

    throw error;
  }
}

async function callGroqJson(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const baseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const model = options.model || process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

  if (!apiKey) {
    const error = new Error('GROQ_API_KEY is required');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0,
      max_completion_tokens: options.maxCompletionTokens || 4096,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(responseBody?.error?.message || 'Groq request failed');
    error.statusCode = response.status;
    error.details = responseBody;
    throw error;
  }

  const content = responseBody?.choices?.[0]?.message?.content;

  if (!content) {
    const error = new Error('Groq response did not include message content');
    error.statusCode = 502;
    error.details = responseBody;
    throw error;
  }

  return {
    model,
    raw_content: content,
    json: parseJsonOutput(content),
  };
}

function getRetryDelayMs(error) {
  const message = error?.details?.error?.message || error?.message || '';
  const match = message.match(/try again in ([\d.]+)s/i);
  const seconds = match ? Number(match[1]) : 10;
  return Math.ceil((Number.isFinite(seconds) ? seconds : 10) * 1000) + 1000;
}

async function callGroqJsonWithRetry(messages, options = {}) {
  const attempts = options.attempts || 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callGroqJson(messages, options);
    } catch (error) {
      const isRetryableRateLimit =
        error.statusCode === 429 &&
        (error.details?.error?.code === 'rate_limit_exceeded' || error.details?.error?.type === 'tokens');

      if (!isRetryableRateLimit || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(error)));
    }
  }

  throw new Error('Groq retry failed unexpectedly');
}

module.exports = {
  callGroqJson,
  callGroqJsonWithRetry,
  parseJsonOutput,
};
