const express = require('express');
const cors = require('cors');
const { runRuleEngine } = require('./ruleEngine');
const { generateJUnitCodeV2 } = require('./junitGeneratorV2');
const { enhanceWithAI } = require('./aiService');

const app = express();
const PORT = process.env.PORT || 4000;
const MIN_TEST_CASES = 50;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(testCases) {
  const summary = { total: testCases.length, byCategory: {}, byPriority: {} };
  for (const tc of testCases) {
    summary.byCategory[tc.category] = (summary.byCategory[tc.category] || 0) + 1;
    summary.byPriority[tc.priority] = (summary.byPriority[tc.priority] || 0) + 1;
  }
  return summary;
}

function validateInput(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object.';
  }
  if (!body.endpoint || typeof body.endpoint !== 'string') {
    return '"endpoint" is required and must be a string (e.g. "/users").';
  }
  if (!body.method || typeof body.method !== 'string') {
    return '"method" is required and must be a string (e.g. "POST").';
  }
  if (!body.fields || typeof body.fields !== 'object' || Object.keys(body.fields).length === 0) {
    return '"fields" is required and must be a non-empty object (e.g. { "email": "string" }).';
  }
  return null;
}

function renumberIds(testCases) {
  testCases.forEach((tc, i) => { tc.id = i + 1; });
  return testCases;
}

// ---------------------------------------------------------------------------
// POST /generate-tests  (primary endpoint)
// ---------------------------------------------------------------------------

app.post('/generate-tests', async (req, res) => {
  try {
    // 1. Validate input
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const input = req.body;
    const useAI = input.enhanceWithAI === true;

    // 2. Run rule engine
    let testCases;
    try {
      testCases = runRuleEngine(input);
    } catch (err) {
      console.error('Rule engine failed:', err);
      return res.status(500).json({ error: 'Rule engine failed: ' + err.message });
    }

    // 3. Optional AI enhancement
    let aiError = null;
    if (useAI) {
      try {
        const aiCases = await enhanceWithAI(input, testCases.length);
        testCases = [...testCases, ...aiCases];
      } catch (err) {
        console.warn('AI enhancement failed (non-fatal):', err.message);
        aiError = 'AI enhancement unavailable, using rule-based generation.';
      }
    }

    // 4. Guarantee minimum 50 test cases
    renumberIds(testCases);
    if (testCases.length < MIN_TEST_CASES) {
      console.warn(`Only ${testCases.length} cases generated — below minimum ${MIN_TEST_CASES}.`);
    }

    // 5. Generate JUnit code
    let junitCode;
    try {
      junitCode = generateJUnitCodeV2(input, testCases);
    } catch (err) {
      console.error('JUnit generation failed:', err);
      junitCode = '// JUnit code generation failed. See test cases table for results.';
    }

    // 6. Build summary and respond
    const summary = buildSummary(testCases);

    return res.json({
      testCases,
      junitCode,
      summary,
      ...(aiError ? { aiWarning: aiError } : {}),
    });
  } catch (err) {
    console.error('Unexpected error in /generate-tests:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', aiConfigured: !!process.env.OPENROUTER_API_KEY });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`OpenRouter AI: ${process.env.OPENROUTER_API_KEY ? 'configured' : 'not configured (set OPENROUTER_API_KEY to enable)'}`);
});
