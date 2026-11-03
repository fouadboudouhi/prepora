// The assistant's turn: asks Claude through the server, runs the tools it calls, sends the results back and repeats
// until it answers. Inside a turn every block goes back exactly as received, thinking included; between turns only the
// visible text is kept, so nothing earlier has to match.
import { SessionError, aiCall } from './session.js';

const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 10;

// Rebuilds the reply's blocks from the server-sent events. Tool input whose JSON cannot be read is marked, not guessed.
async function readStream(response, onText) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const blocks = [];
  let buffer = '';
  let stop = '';
  const fields = { text_delta: 'text', thinking_delta: 'thinking', signature_delta: 'signature' };
  const textOf = () =>
    blocks
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('');
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    let event;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (event.type === 'content_block_start') {
      blocks[event.index] = { ...event.content_block };
      if (blocks[event.index].type === 'tool_use') blocks[event.index].partial = '';
    } else if (event.type === 'content_block_delta') {
      const block = blocks[event.index];
      if (!block) return;
      const field = fields[event.delta?.type];
      if (field) {
        block[field] = (block[field] ?? '') + event.delta[field];
        if (field === 'text') onText(textOf());
      } else if (event.delta?.type === 'input_json_delta') block.partial += event.delta.partial_json;
    } else if (event.type === 'content_block_stop') {
      const block = blocks[event.index];
      if (block?.partial === undefined) return;
      try {
        block.input = block.partial ? JSON.parse(block.partial) : {};
      } catch {
        block.invalid = block.partial;
        block.input = {};
      }
      delete block.partial;
    } else if (event.type === 'message_delta' && event.delta?.stop_reason) stop = event.delta.stop_reason;
    else if (event.type === 'error') throw new SessionError('server', event.error?.message);
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
  return { content: blocks.filter(Boolean), text: textOf(), stop };
}

// After a fallback in the middle of an answer, only the text from before it goes back, the rest of what came before
// belongs to the model that stopped.
export function kept(content) {
  const last = content.findLastIndex((block) => block.type === 'fallback');
  return content.filter((block, index) => index > last || (index < last && block.type === 'text'));
}

export async function runTurn({ system, messages, tools, execute, signal, onText = () => {} }) {
  const transcript = [...messages];
  let shown = '';
  const join = (text) => [shown, text.trim()].filter(Boolean).join('\n\n');
  for (let step = 0; step < MAX_STEPS; step++) {
    let reply;
    try {
      const response = await aiCall(
        {
          model: MODEL,
          max_tokens: 16000,
          stream: true,
          output_config: { effort: 'medium' },
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system,
          tools,
          messages: transcript,
        },
        { 'anthropic-beta': 'server-side-fallback-2026-07-01' },
        signal
      );
      reply = await readStream(response, (text) => onText(join(text)));
    } catch (err) {
      if (signal?.aborted) throw new SessionError('aborted');
      throw err;
    }
    shown = join(reply.text);
    const content = kept(reply.content);
    const calls = content.filter((block) => block.type === 'tool_use');
    if (reply.stop === 'refusal') throw new SessionError('refused');
    if (reply.stop === 'max_tokens' && (calls.length || !shown)) throw new SessionError('toolong');
    transcript.push({ role: 'assistant', content: content.map(({ invalid, ...block }) => block) });
    if (reply.stop === 'pause_turn') continue;
    if (reply.stop !== 'tool_use' || !calls.length) return shown;
    const results = [];
    for (const call of calls) {
      if (signal?.aborted) throw new SessionError('aborted');
      let outcome;
      if (call.invalid !== undefined)
        outcome = { error: 'INVALID_JSON: Die Eingabe war kein gültiges JSON.' };
      else
        try {
          outcome = await execute(call.name, call.input);
        } catch (err) {
          outcome = { error: err?.message || 'Das hat nicht geklappt.' };
        }
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        ...(outcome?.error ? { is_error: true } : {}),
        content: JSON.stringify(outcome ?? {}),
      });
    }
    transcript.push({ role: 'user', content: results });
  }
  throw new SessionError('server', 'Zu viele Schritte in einer Antwort.');
}
