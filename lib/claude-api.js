// lib/claude-api.js

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export function buildPrompt(videos) {
  const esc = (s) => s.replace(/"/g, '\\"');
  const videoList = videos
    .map(v => `- id: "${esc(v.id)}", title: "${esc(v.title)}", channel: "${esc(v.channel)}", duration: ${v.duration}s`)
    .join('\n');

  return `You are organizing a YouTube Watch Later playlist. Given the following videos, group them into broad topic clusters (e.g., "Media Criticism", "Politics", "Comedy", "Music", "History", "Tech", etc.).

Rules:
- Each video belongs to exactly one cluster
- Use broad, recognizable category names
- Aim for 3-8 clusters depending on variety
- Order clusters from lightest/most casual (e.g., Comedy, Music, Entertainment) to most intense/serious/academic (e.g., Politics, History, Science)
- Return ONLY valid JSON, no explanation

Videos:
${videoList}

Return JSON in this exact format:
{"clusters":[{"name":"Category Name","videoIds":["id1","id2"]}]}`;
}

export function parseClusters(text) {
  let jsonStr = text.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse cluster JSON: ${jsonStr.slice(0, 100)}`);
  }

  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    throw new Error('Missing "clusters" array in response');
  }

  return parsed;
}

/**
 * Call Claude API with streaming to categorize videos.
 * Streams the response for faster perceived performance.
 */
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
      max_tokens: 1024,
      stream: true,
      messages: [{ role: 'user', content: buildPrompt(videos) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  // Read SSE stream and accumulate text
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

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
        // Skip malformed events
      }
    }
  }

  return parseClusters(fullText);
}
