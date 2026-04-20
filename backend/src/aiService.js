/**
 * Optional OpenRouter AI integration.
 * Sends the API spec to OpenRouter (mistralai/mixtral-8x7b) and asks for
 * additional edge-case test cases.
 * Returns an array of test case objects that can be merged with rule-engine output.
 *
 * Requires OPENROUTER_API_KEY environment variable.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openai/gpt-3.5-turbo';

function getApiKey() {
  return process.env.OPENROUTER_API_KEY || '';
}

function buildPrompt(input, existingCount) {
  return `You are a senior QA engineer. Given the following API specification, generate additional edge-case test scenarios that a rule-based engine might miss.

API Specification:
- Endpoint: ${input.endpoint}
- Method: ${input.method}
- Fields: ${JSON.stringify(input.fields)}

I already have ${existingCount} test cases covering: happy path, negative, boundary, edge, and security categories.

Generate 10-15 ADDITIONAL unique test cases I might have missed. Focus on:
- Business logic edge cases
- Race conditions or concurrency hints
- Unusual but valid inputs
- Complex field interaction tests
- Real-world abuse scenarios

Return ONLY a JSON array (no markdown, no code fences) where each element has:
{
  "scenario": "description of the test",
  "input": { "body": { ... } },
  "expected": { "status": <http_code>, "error": "or message" },
  "priority": "high" | "medium" | "low",
  "category": "ai-generated"
}`;
}

async function enhanceWithAI(input, existingCount) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("OpenRouter AI: not configured");
    return [];
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: 'user',
          content: buildPrompt(input, existingCount),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';

  // Strip markdown fences if the model wraps them
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('OpenRouter returned non-JSON, attempting extraction…');
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error('Could not parse AI response as JSON array.');
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not an array.');
  }

  // Normalize each case
  return parsed.map((tc, i) => ({
    id: 0, // will be renumbered by caller
    scenario: tc.scenario || `AI-generated case ${i + 1}`,
    input: tc.input || { body: {} },
    expected: tc.expected || { status: 200, message: 'AI-suggested' },
    priority: ['high', 'medium', 'low'].includes(tc.priority) ? tc.priority : 'medium',
    category: 'ai-generated',
  }));
}

module.exports = { enhanceWithAI };
