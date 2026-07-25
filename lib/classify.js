// lib/classify.js
import { TAXONOMY, MAX_NEW_CATEGORIES } from './taxonomy.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export function buildPrompt(videos) {
  const escape = (value) => String(value).replace(/"/g, '\\"');

  const list = videos
    .filter(v => !v.unavailable)
    .map(v => {
      const fields = [
        `id: "${escape(v.id)}"`,
        `title: "${escape(v.title)}"`,
        `channel: "${escape(v.channel)}"`,
      ];
      if (v.category) fields.push(`ytCategory: "${escape(v.category)}"`);
      return `- ${fields.join(', ')}`;
    })
    .join('\n');

  return `You are organizing a YouTube Watch Later playlist. Assign each video to one category.

Prefer these categories:
${TAXONOMY.map(name => `- ${name}`).join('\n')}

Rules:
- Each video belongs to exactly one category
- Strongly prefer the categories above
- You may introduce at most ${MAX_NEW_CATEGORIES} new categories, but only when a video genuinely fits none of them
- The channel name is often a stronger signal than the title
- ytCategory is YouTube's own label. It is coarse and sometimes wrong — treat it as a hint, not an answer
- Return ONLY valid JSON, no explanation

Videos:
${list}

Return JSON in this exact format:
{"clusters":[{"name":"Category Name","videoIds":["id1","id2"]}]}`;
}

export function parseClusters(text) {
  let json = text.trim();

  const fenced = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) json = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse cluster JSON: ${json.slice(0, 100)}`);
  }

  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    throw new Error('Missing "clusters" array in response');
  }
  return parsed;
}

/** Call Claude with streaming for faster perceived performance. */
export async function categorizeVideos(apiKey, videos) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      stream: true,
      messages: [{ role: 'user', content: buildPrompt(videos) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullText += event.delta.text;
        }
      } catch {
        // Skip malformed events.
      }
    }
  }
  return parseClusters(fullText);
}
