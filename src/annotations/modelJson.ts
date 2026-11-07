/**
 * Getting JSON out of a chat model's reply.
 *
 * Even with guided decoding, replies arrive with reasoning blocks, code
 * fences, a sentence before the JSON, trailing commas, or cut off at the
 * token limit. This finds the first complete JSON value and says what it had
 * to do to get there, so the report shows how clean the output really was.
 */

export interface Extracted {
  value: unknown;
  /** What was stripped or repaired; empty for a clean reply. */
  repairs: string[];
}

export class ModelJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelJsonError';
  }
}

export function extractJson(text: unknown): Extracted {
  if (typeof text !== 'string') {
    if (text && typeof text === 'object') return { value: text, repairs: [] };
    throw new ModelJsonError('reply has no text content');
  }
  const repairs: string[] = [];
  let s = text;

  const noThink = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (noThink !== s) {
    repairs.push('removed <think> block');
    s = noThink;
  }
  if (/<think>/i.test(s)) throw new ModelJsonError('reply ended inside an unfinished <think> block');

  const trimmed = s.trim();
  if (!trimmed) throw new ModelJsonError('reply is empty');
  try {
    return { value: JSON.parse(trimmed), repairs };
  } catch {
    // fall through to the slower paths
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) {
    repairs.push('removed code fence');
    s = fence[1];
  }

  const start = s.search(/[[{]/);
  if (start < 0) throw new ModelJsonError('no JSON object or array in reply');
  if (s.slice(0, start).trim()) repairs.push('ignored text before the JSON');
  const end = matchingEnd(s, start);
  if (end < 0) throw new ModelJsonError('JSON is cut off (reply probably hit the token limit)');
  if (s.slice(end + 1).trim()) repairs.push('ignored text after the JSON');
  let body = s.slice(start, end + 1);
  try {
    return { value: JSON.parse(body), repairs };
  } catch {
    const fixed = body.replace(/,\s*([}\]])/g, '$1');
    if (fixed !== body) {
      try {
        const value = JSON.parse(fixed);
        repairs.push('removed trailing commas');
        return { value, repairs };
      } catch {
        body = fixed;
      }
    }
    throw new ModelJsonError(`JSON does not parse: ${body.slice(0, 80)}…`);
  }
}

/** Index of the bracket closing the one at `start`, honouring strings; -1 if unbalanced. */
function matchingEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** The text content of an OpenAI-style chat completion, or null. */
export function completionText(resp: unknown): string | null {
  const c = (resp as { choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[] })?.choices?.[0]?.message;
  if (!c) return null;
  if (typeof c.content === 'string' && c.content.trim()) return c.content;
  // Some reasoning models put everything in reasoning_content when content is empty.
  if (typeof c.reasoning_content === 'string' && c.reasoning_content.trim()) return c.reasoning_content;
  return null;
}
