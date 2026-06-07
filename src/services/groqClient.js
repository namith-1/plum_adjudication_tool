function stripJsonFences(content) {
  const text = String(content || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function extractBalancedJson(content) {
  const text = stripJsonFences(content);
  const start = text.search(/[\[{]/);

  if (start === -1) {
    return text;
  }

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) {
        break;
      }

      if (stack.length === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
}

function parseJsonOutput(content) {
  const jsonText = extractBalancedJson(content);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const parseError = new Error(
      error.message === 'Unexpected end of JSON input'
        ? 'AI returned incomplete JSON. Retry the request or reduce document size/pages.'
        : `AI returned invalid JSON: ${error.message}`
    );
    parseError.cause = error;
    parseError.raw_content_preview = String(content || '').slice(0, 1200);
    parseError.statusCode = 502;
    throw parseError;
  }
}

function dataUrlToInlineData(url) {
  const match = String(url || '').match(/^data:([^;,]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  };
}

function openAiPartToGeminiPart(part) {
  if (typeof part === 'string') {
    return { text: part };
  }

  if (part?.type === 'text') {
    return { text: part.text || '' };
  }

  if (part?.type === 'image_url') {
    const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    const inlineData = dataUrlToInlineData(imageUrl);

    if (inlineData) {
      return inlineData;
    }

    return {
      text: `Image URL provided but not embedded as base64 data URL: ${imageUrl || 'missing URL'}`,
    };
  }

  return { text: JSON.stringify(part || {}) };
}

function openAiMessagesToGemini(messages) {
  const systemTexts = [];
  const contents = [];

  for (const message of messages || []) {
    if (message.role === 'system') {
      systemTexts.push(typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
      continue;
    }

    const rawParts = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content || '' }];
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: rawParts.map(openAiPartToGeminiPart),
    });
  }

  return {
    systemInstruction: {
      parts: [
        {
          text: 'You must return only one complete valid JSON object. Do not include markdown, prose, comments, or explanations.',
        },
        ...systemTexts.map((text) => ({ text })),
      ],
    },
    contents,
  };
}

function getActiveProvider(options = {}) {
  if (options.provider) {
    return String(options.provider).toLowerCase();
  }

  if (process.env.AI_PROVIDER) {
    return String(process.env.AI_PROVIDER).toLowerCase();
  }

  if (process.env.GROQ_API_KEY) {
    return 'groq';
  }

  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }

  return 'gemini';
}

function getJsonSystemMessage() {
  return {
    role: 'system',
    content: 'You must return only one complete valid JSON object. Do not include markdown, prose, comments, or explanations.',
  };
}

function normalizeOpenAiMessages(messages) {
  const hasJsonSystemMessage = (messages || []).some(
    (message) => message.role === 'system' && String(message.content || '').includes('valid JSON')
  );

  return hasJsonSystemMessage ? messages : [getJsonSystemMessage(), ...(messages || [])];
}

async function callOpenAiJson(messages, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';

  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is required');
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
      messages: normalizeOpenAiMessages(messages),
      temperature: options.temperature ?? 0,
      max_completion_tokens: options.maxCompletionTokens || Number(process.env.AI_MAX_OUTPUT_TOKENS || 12000),
      response_format: { type: 'json_object' },
    }),
    signal: options.signal,
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(responseBody?.error?.message || 'OpenAI request failed');
    error.statusCode = response.status;
    error.details = responseBody;
    throw error;
  }

  const choice = responseBody?.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (!content) {
    const error = new Error(
      choice?.finish_reason === 'length'
        ? 'OpenAI stopped before returning JSON because max output tokens were reached.'
        : 'OpenAI response did not include message content'
    );
    error.statusCode = 502;
    error.details = responseBody;
    throw error;
  }

  try {
    return {
      model,
      raw_content: content,
      json: parseJsonOutput(content),
    };
  } catch (error) {
    error.details = {
      provider: 'openai',
      model,
      finishReason: choice?.finish_reason,
      raw_content_preview: error.raw_content_preview,
    };
    throw error;
  }
}

async function callGroqApiJson(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = options.model || process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const baseUrl = options.baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';

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
      messages: normalizeOpenAiMessages(messages),
      temperature: options.temperature ?? 0,
      max_completion_tokens: options.maxCompletionTokens || Number(process.env.AI_MAX_OUTPUT_TOKENS || 6000),
      response_format: { type: 'json_object' },
    }),
    signal: options.signal,
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(responseBody?.error?.message || 'Groq request failed');
    error.statusCode = response.status;
    error.details = responseBody;
    throw error;
  }

  const choice = responseBody?.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (!content) {
    const error = new Error(
      choice?.finish_reason === 'length'
        ? 'Groq stopped before returning JSON because max output tokens were reached.'
        : 'Groq response did not include message content'
    );
    error.statusCode = 502;
    error.details = responseBody;
    throw error;
  }

  try {
    return {
      model,
      raw_content: content,
      json: parseJsonOutput(content),
    };
  } catch (error) {
    error.details = {
      provider: 'groq',
      model,
      finishReason: choice?.finish_reason,
      raw_content_preview: error.raw_content_preview,
    };
    throw error;
  }
}

async function callGeminiJson(messages, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  const modelPath = String(model).startsWith('models/') ? String(model).slice('models/'.length) : model;
  const baseUrl =
    options.baseUrl ||
    process.env.GEMINI_BASE_URL ||
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelPath)}:generateContent`;

  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is required');
    error.statusCode = 500;
    throw error;
  }

  const geminiPayload = openAiMessagesToGemini(messages);
  const requestUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...geminiPayload,
      generationConfig: {
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxCompletionTokens || Number(process.env.AI_MAX_OUTPUT_TOKENS || 12000),
        responseMimeType: 'application/json',
      },
    }),
    signal: options.signal,
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(responseBody?.error?.message || 'Gemini request failed');
    error.statusCode = response.status;
    error.details = responseBody;
    throw error;
  }

  const candidate = responseBody?.candidates?.[0];
  const content = candidate?.content?.parts?.map((part) => part.text || '').join('').trim();

  if (!content) {
    const error = new Error(
      candidate?.finishReason === 'MAX_TOKENS'
        ? 'Gemini stopped before returning JSON because max output tokens were reached.'
        : 'Gemini response did not include message content'
    );
    error.statusCode = 502;
    error.details = responseBody;
    throw error;
  }

  try {
    return {
      model,
      raw_content: content,
      json: parseJsonOutput(content),
    };
  } catch (error) {
    error.details = {
      provider: 'gemini',
      model,
      finishReason: candidate?.finishReason,
      raw_content_preview: error.raw_content_preview,
    };
    throw error;
  }
}

async function callGroqJson(messages, options = {}) {
  const provider = getActiveProvider(options);

  if (provider === 'openai') {
    return callOpenAiJson(messages, options);
  }

  if (provider === 'groq' || provider === 'grok') {
    return callGroqApiJson(messages, options);
  }

  return callGeminiJson(messages, options);
}

function getRetryDelayMs(error) {
  const message = error?.details?.error?.message || error?.message || '';
  const match = message.match(/try again in ([\d.]+)s/i);
  const seconds = match ? Number(match[1]) : error?.statusCode === 503 ? 2 : 10;
  return Math.ceil((Number.isFinite(seconds) ? seconds : 10) * 1000) + 1000;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getGeminiModelFallbacks(options = {}) {
  const fallbackModels = String(
    options.fallbackModels ||
      process.env.GEMINI_FALLBACK_MODELS ||
      'gemini-2.5-flash-lite,gemini-3-flash-preview,gemini-2.5-flash,gemini-flash-latest'
  )
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueValues([options.model || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview', ...fallbackModels]);
}

function getOpenAiModelFallbacks(options = {}) {
  const fallbackModels = String(options.fallbackModels || process.env.OPENAI_FALLBACK_MODELS || 'gpt-4o-mini,gpt-4.1-mini')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueValues([options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini', ...fallbackModels]);
}

function getGroqModelFallbacks(options = {}) {
  const fallbackModels = String(
    options.fallbackModels ||
      process.env.GROQ_FALLBACK_MODELS ||
      'meta-llama/llama-4-scout-17b-16e-instruct'
  )
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueValues([options.model || process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', ...fallbackModels]);
}

function isRetryableGeminiError(error) {
  const status = error.details?.error?.status;
  const code = error.details?.error?.code;

  return (
    error.statusCode === 502 ||
    error.statusCode === 503 ||
    error.statusCode === 429 ||
    status === 'UNAVAILABLE' ||
    status === 'RESOURCE_EXHAUSTED' ||
    code === 'rate_limit_exceeded' ||
    error.details?.error?.type === 'tokens'
  );
}

function isRetryableOpenAiError(error) {
  const code = error.details?.error?.code;
  const type = error.details?.error?.type;

  return (
    error.statusCode === 408 ||
    error.statusCode === 409 ||
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    code === 'rate_limit_exceeded' ||
    type === 'tokens' ||
    type === 'server_error'
  );
}

function isRetryableGroqError(error) {
  const code = error.details?.error?.code;
  const type = error.details?.error?.type;

  return (
    error.statusCode === 408 ||
    error.statusCode === 409 ||
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    code === 'rate_limit_exceeded' ||
    type === 'tokens' ||
    type === 'server_error'
  );
}

async function callGroqJsonWithRetry(messages, options = {}) {
  const attempts = options.attempts || 3;
  const provider = getActiveProvider(options);
  const models =
    provider === 'openai'
      ? getOpenAiModelFallbacks(options)
      : provider === 'groq' || provider === 'grok'
        ? getGroqModelFallbacks(options)
        : getGeminiModelFallbacks(options);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const model of models) {
      try {
        return await callGroqJson(messages, { ...options, model });
      } catch (error) {
        lastError = error;

        const isRetryable =
          provider === 'openai'
            ? isRetryableOpenAiError(error)
            : provider === 'groq' || provider === 'grok'
              ? isRetryableGroqError(error)
              : isRetryableGeminiError(error);

        if (!isRetryable) {
          throw error;
        }
      }
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(lastError)));
    }
  }

  throw lastError || new Error('AI retry failed unexpectedly');
}

module.exports = {
  callGroqJson,
  callGroqJsonWithRetry,
  parseJsonOutput,
};
