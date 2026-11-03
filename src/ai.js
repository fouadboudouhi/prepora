// Claude through the person's server: it holds the key and counts the monthly budget of the account. Answers stream, so
// a long one keeps the connection alive all the way.
import { SessionError, aiCall } from './session.js';

const MODEL = 'claude-opus-5-5';

async function readStream(response) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let stop = '';
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    let event;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    // A fallback model starts over, what came before it does not count.
    if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') text = '';
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text;
    if (event.type === 'message_delta' && event.delta?.stop_reason) stop = event.delta.stop_reason;
    if (event.type === 'error') throw new SessionError('server', event.error?.message);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);
  return { text, stop };
}

export async function askClaude({ messages, system, maxTokens = 8000, effort = 'low', format }) {
  const response = await aiCall(
    {
      model: MODEL,
      max_tokens: maxTokens,
      stream: true,
      output_config: { effort, ...(format ? { format: { type: 'json_schema', schema: format } } : {}) },
      fallbacks: 'default',
      ...(system ? { system } : {}),
      messages,
    },
    { 'anthropic-beta': 'server-side-fallback-2026-07-01' }
  );
  const { text, stop } = await readStream(response);
  if (stop === 'refusal') throw new SessionError('refused');
  if (stop === 'max_tokens') throw new SessionError('toolong');
  if (!text) throw new SessionError('server');
  return text;
}

export async function askClaudeJson(options) {
  const text = await askClaude(options);
  try {
    return JSON.parse(text);
  } catch {
    throw new SessionError('server', 'Die Antwort war kein gültiges JSON.');
  }
}
