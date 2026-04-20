const express = require('express');
const cors = require('cors');
const { runRuleEngine, CATEGORY_SORT_ORDER } = require('./ruleEngine');
const { generateJUnitCodeV2 } = require('./junitGeneratorV2');
const { enhanceWithAI } = require('./aiService');
const { convertUserStoryToModel } = require('./textParser');

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

function sortAndRenumber(testCases) {
  testCases.sort((a, b) =>
    (CATEGORY_SORT_ORDER[a.category] ?? 9) - (CATEGORY_SORT_ORDER[b.category] ?? 9)
  );
  testCases.forEach((tc, i) => { tc.id = i + 1; });
  return testCases;
}

// ---------------------------------------------------------------------------
// POST /generate-tests  (primary endpoint — JSON input)
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

    // 2. Run rule engine (returns QA format, already sorted)
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

    // 4. Sort by category order and renumber
    sortAndRenumber(testCases);

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
// POST /generate-from-text  (user story / plain English input)
// ---------------------------------------------------------------------------

app.post('/generate-from-text', async (req, res) => {
  try {
    const { description } = req.body || {};

    // 1. Validate
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: '"description" is required and must be a non-empty string.' });
    }

    const trimmed = description.trim().slice(0, 10000); // safety cap

    // 2. Convert user story → structured model (already in QA format)
    let model;
    try {
      model = await convertUserStoryToModel(trimmed);
    } catch (err) {
      console.error('Text parsing failed:', err);
      return res.status(500).json({ error: 'Failed to parse user story: ' + err.message });
    }

    // 3. Assign IDs to test cases
    let testCases = model.testCases.map((tc, i) => ({
      ...tc,
      id: i + 1,
      statusCode: tc.statusCode || 200,
    }));

    // 4. Ensure minimum 50 test cases by padding with QA-quality patterns
    if (testCases.length < MIN_TEST_CASES) {
      testCases = padTestCases(testCases, model.detectedFeatures);
    }
    sortAndRenumber(testCases);

    // 5. Generate JUnit-style code
    let junitCode;
    try {
      const pseudoInput = { endpoint: '/user-story', method: 'GET', fields: {} };
      junitCode = generateJUnitCodeV2(pseudoInput, testCases);
    } catch (err) {
      console.error('JUnit generation failed:', err);
      junitCode = '// JUnit code generation failed. See test cases table for results.';
    }

    // 6. Respond
    const summary = buildSummary(testCases);

    return res.json({
      testCases,
      junitCode,
      summary,
      detectedFeatures: model.detectedFeatures,
      parsingSource: model.source,
    });
  } catch (err) {
    console.error('Unexpected error in /generate-from-text:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Padding templates (QA format) for text-based generation
// ---------------------------------------------------------------------------

const PADDING_TEMPLATES = [
  { title: 'Verify {f} remains functional on slow network (3G throttle)', category: 'Edge Case', priority: 'MEDIUM',
    pre: ['User is logged in', 'Network is throttled to 3G speed'],
    steps: ['Enable 3G throttling in browser DevTools', 'Navigate to the {f} section', 'Perform key interactions', 'Verify all actions complete (with acceptable delay)', 'Verify no timeout errors are shown'],
    expected: '{f} remains functional under slow network — actions complete and no timeout errors occur.' },
  { title: 'Verify {f} handles concurrent user actions without race conditions', category: 'Edge Case', priority: 'MEDIUM',
    pre: ['User is logged in', 'Multiple browser tabs are open'],
    steps: ['Open the {f} feature in two tabs', 'Perform conflicting actions simultaneously', 'Verify no data corruption or duplicate entries', 'Verify both tabs reflect consistent state after refresh'],
    expected: 'Concurrent actions are handled safely — no data corruption, duplicates, or inconsistent state.' },
  { title: 'Verify {f} state persists correctly after full page refresh', category: 'Edge Case', priority: 'MEDIUM',
    pre: ['User is logged in', 'User has made changes in {f}'],
    steps: ['Interact with {f} and note the current state', 'Press F5 or Ctrl+R to refresh the page', 'Verify the state is restored correctly', 'Verify no unsaved changes are lost unexpectedly'],
    expected: 'Page refresh preserves the expected state. Any unsaved data prompts the user before being discarded.' },
  { title: 'Verify {f} renders correctly in dark mode theme', category: 'Adhoc', priority: 'LOW',
    pre: ['User is logged in', 'Dark mode is enabled in settings or system preference'],
    steps: ['Enable dark mode', 'Navigate to {f}', 'Verify all text is readable against dark backgrounds', 'Verify no elements are invisible or poorly contrasted'],
    expected: 'All {f} elements are properly themed in dark mode with adequate contrast and readability.' },
  { title: 'Verify {f} sanitizes special characters in user input', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} accepts user input'],
    steps: ['Enter special characters in input fields: <script>, SQL quotes, etc.', 'Submit the input', 'Verify no XSS is executed', 'Verify the system handles the input safely'],
    expected: 'Special characters are escaped or rejected. No XSS or injection vulnerabilities are triggered.' },
  { title: 'Verify {f} is fully operable using keyboard only', category: 'Adhoc', priority: 'MEDIUM',
    pre: ['User is logged in', 'Mouse/trackpad is disabled or unused'],
    steps: ['Tab through all interactive elements in {f}', 'Verify focus indicators are visible', 'Activate buttons/links with Enter/Space', 'Navigate through all key flows using keyboard only'],
    expected: 'All interactive elements in {f} are keyboard-accessible with visible focus indicators.' },
  { title: 'Verify {f} displays user-friendly error when API returns 500', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', 'Backend is configured to return 500 error for {f} API'],
    steps: ['Navigate to {f}', 'Trigger the action that calls the failing API', 'Verify a user-friendly error message is displayed', 'Verify a retry option is available'],
    expected: 'A clear error message is shown (no stack trace). A retry button allows the user to re-attempt.' },
  { title: 'Verify {f} handles empty API response gracefully', category: 'Edge Case', priority: 'MEDIUM',
    pre: ['User is logged in', 'Backend returns empty data for {f}'],
    steps: ['Navigate to {f}', 'Verify empty state message is displayed', 'Verify no layout breakage', 'Verify no JavaScript errors in console'],
    expected: '{f} shows an informative empty state message. Layout is intact and no errors occur.' },
  { title: 'Verify {f} truncates or wraps extremely long text content', category: 'Edge Case', priority: 'LOW',
    pre: ['User is logged in', 'Data contains very long text strings (1000+ chars)'],
    steps: ['Load {f} with extremely long text data', 'Verify text is truncated with ellipsis or wraps correctly', 'Verify no horizontal overflow breaks the layout'],
    expected: 'Long text is handled gracefully — truncated or wrapped without breaking the layout.' },
  { title: 'Verify {f} print layout is clean and readable', category: 'Adhoc', priority: 'LOW',
    pre: ['User is logged in', '{f} page is loaded'],
    steps: ['Open the browser print dialog (Ctrl+P)', 'Preview the print layout', 'Verify navigation and non-essential UI elements are hidden', 'Verify content is formatted for print'],
    expected: 'Print layout shows only relevant content in a clean, readable format.' },
];

function padTestCases(testCases, features) {
  const existing = new Set(testCases.map((tc) => tc.title));
  const featureNames = features.length > 0 ? features : ['the feature'];

  for (const tmpl of PADDING_TEMPLATES) {
    if (testCases.length >= MIN_TEST_CASES) break;
    for (const f of featureNames) {
      if (testCases.length >= MIN_TEST_CASES) break;
      const title = tmpl.title.replace(/\{f\}/g, f);
      if (existing.has(title)) continue;
      existing.add(title);
      testCases.push({
        id: testCases.length + 1,
        title,
        category: tmpl.category,
        priority: tmpl.priority,
        preconditions: tmpl.pre.map((p) => p.replace(/\{f\}/g, f)),
        steps: tmpl.steps.map((s) => s.replace(/\{f\}/g, f)),
        expected: tmpl.expected.replace(/\{f\}/g, f),
        statusCode: 200,
      });
    }
  }
  return testCases;
}

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
