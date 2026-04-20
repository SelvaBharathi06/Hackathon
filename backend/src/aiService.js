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
  return `You are a senior QA engineer with 8+ years of experience in API testing.

Given the following API specification, generate additional detailed test cases that a rule-based engine might miss.

API Specification:
- Endpoint: ${input.endpoint}
- Method: ${input.method}
- Fields: ${JSON.stringify(input.fields)}

I already have ${existingCount} test cases covering: Happy Path, Negative, and Edge Case categories.

Generate 10-15 ADDITIONAL unique, high-quality test cases. Focus on:
- Business logic edge cases
- Race conditions or concurrency hints
- Complex field interaction tests
- Real-world abuse scenarios
- Data integrity validation

STRICT RULES:
- Each test case MUST include: title, preconditions, steps, expected
- Avoid generic tests like "verify API works"
- Preconditions must be specific and actionable
- Steps must be step-by-step and executable
- Expected must be precise and verifiable

Return ONLY a JSON array (no markdown, no code fences) where each element has:
{
  "title": "specific test case title",
  "category": "Happy Path" | "Negative" | "Edge Case" | "Adhoc",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "preconditions": ["precondition 1", "precondition 2"],
  "steps": ["step 1", "step 2", "step 3"],
  "expected": "precise expected result",
  "statusCode": 200,
  "input": { "body": { ... } }
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

  // Normalize each case to QA format
  return parsed.map((tc, i) => ({
    id: 0, // will be renumbered by caller
    title: tc.title || tc.scenario || `AI-generated case ${i + 1}`,
    category: ['Happy Path', 'Negative', 'Edge Case', 'Adhoc'].includes(tc.category) ? tc.category : 'Edge Case',
    priority: ['HIGH', 'MEDIUM', 'LOW'].includes(tc.priority) ? tc.priority : 'MEDIUM',
    preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : ['API endpoint is accessible', 'User is authenticated'],
    steps: Array.isArray(tc.steps) ? tc.steps : [`Send request to ${input.endpoint}`, 'Verify response'],
    expected: typeof tc.expected === 'string' ? tc.expected : (tc.expected?.error || tc.expected?.message || 'Test passes'),
    input: tc.input || { body: {} },
    statusCode: tc.statusCode || tc.expected?.status || 200,
  }));
}

module.exports = { enhanceWithAI };
