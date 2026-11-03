// Claude through the person's server: it holds the key and counts the monthly budget of the account.
import { SessionError, aiCall } from './session.js';

const MODEL = 'claude-opus-5-5';

export async function askClaude({ messages, system, maxTokens = 16000, effort = 'medium' }) {
  const response = await aiCall(
    {
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort },
      fallbacks: 'default',
      ...(system ? { system } : {}),
      messages,
    },
    { 'anthropic-beta': 'server-side-fallback-2026-07-01' }
  );
  const reply = await response.json().catch(() => null);
  if (reply?.stop_reason === 'refusal') throw new SessionError('refused');
  const text = (reply?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text) throw new SessionError('server');
  return text;
}

// One short question, to see that the whole way from here to Claude works.
export const testClaude = () =>
  askClaude({ messages: [{ role: 'user', content: 'Antworte nur mit: OK' }], maxTokens: 500, effort: 'low' });
