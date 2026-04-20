const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { runRuleEngine, CATEGORY_SORT_ORDER } = require('./ruleEngine');
const { generateJUnitCodeV2 } = require('./junitGeneratorV2');
const { enhanceWithAI } = require('./aiService');
const { convertUserStoryToModel } = require('./textParser');
const { extractTextFromFile, cleanupFile } = require('./fileExtractor');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 4000;
const MIN_TEST_CASES = 50;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

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

    // 3. Log detected features
    console.log(`[/generate-from-text] Detected ${model.detectedFeatures.length} features: ${model.detectedFeatures.join(', ')}`);
    console.log(`[/generate-from-text] Source: ${model.source} | Raw test cases: ${model.testCases.length}`);

    // 4. Assign IDs to test cases
    let testCases = model.testCases.map((tc, i) => ({
      ...tc,
      id: i + 1,
      statusCode: tc.statusCode || 200,
    }));

    // 5. Ensure minimum 50 test cases by padding with QA-quality patterns
    if (testCases.length < MIN_TEST_CASES) {
      testCases = padTestCases(testCases, model.detectedFeatures);
    }
    sortAndRenumber(testCases);

    // 6. Generate JUnit-style code
    let junitCode;
    try {
      const pseudoInput = { endpoint: '/user-story', method: 'GET', fields: {} };
      junitCode = generateJUnitCodeV2(pseudoInput, testCases);
    } catch (err) {
      console.error('JUnit generation failed:', err);
      junitCode = '// JUnit code generation failed. See test cases table for results.';
    }

    // 7. Respond
    const summary = buildSummary(testCases);
    console.log(`[/generate-from-text] Final: ${summary.total} test cases | Categories: ${JSON.stringify(summary.byCategory)}`);

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
// POST /generate-from-file  (file upload: txt, pdf, docx)
// ---------------------------------------------------------------------------

app.post('/generate-from-file', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please attach a .txt, .pdf, or .docx file.' });
    }

    filePath = req.file.path;
    const originalName = req.file.originalname || '';

    // 1. Extract text from file
    let extractedText;
    try {
      extractedText = await extractTextFromFile(filePath, originalName);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const trimmed = extractedText.trim().slice(0, 10000);
    if (!trimmed) {
      return res.status(400).json({ error: 'Uploaded file contains no extractable text.' });
    }

    // 2. Convert to structured model (reuse existing text parser)
    let model;
    try {
      model = await convertUserStoryToModel(trimmed);
    } catch (err) {
      console.error('Text parsing from file failed:', err);
      return res.status(500).json({ error: 'Failed to parse file content: ' + err.message });
    }

    // 3. Log detected features
    console.log(`[/generate-from-file] Detected ${model.detectedFeatures.length} features: ${model.detectedFeatures.join(', ')}`);
    console.log(`[/generate-from-file] Source: ${model.source} | Raw test cases: ${model.testCases.length}`);

    // 4. Assign IDs
    let testCases = model.testCases.map((tc, i) => ({
      ...tc,
      id: i + 1,
      statusCode: tc.statusCode || 200,
    }));

    // 5. Pad to minimum
    if (testCases.length < MIN_TEST_CASES) {
      testCases = padTestCases(testCases, model.detectedFeatures);
    }
    sortAndRenumber(testCases);

    // 6. Generate JUnit
    let junitCode;
    try {
      const pseudoInput = { endpoint: '/file-upload', method: 'GET', fields: {} };
      junitCode = generateJUnitCodeV2(pseudoInput, testCases);
    } catch (err) {
      console.error('JUnit generation failed:', err);
      junitCode = '// JUnit code generation failed. See test cases table for results.';
    }

    // 7. Respond
    const summary = buildSummary(testCases);
    console.log(`[/generate-from-file] Final: ${summary.total} test cases | Categories: ${JSON.stringify(summary.byCategory)}`);

    return res.json({
      testCases,
      junitCode,
      summary,
      detectedFeatures: model.detectedFeatures,
      parsingSource: model.source,
      extractedTextPreview: trimmed.slice(0, 500) + (trimmed.length > 500 ? '…' : ''),
      fileName: originalName,
    });
  } catch (err) {
    console.error('Unexpected error in /generate-from-file:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  } finally {
    if (filePath) cleanupFile(filePath);
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
// POST /download  (Excel export)
// ---------------------------------------------------------------------------

app.post('/download', async (req, res) => {
  try {
    const { testCases } = req.body || {};
    if (!Array.isArray(testCases) || testCases.length === 0) {
      return res.status(400).json({ error: 'testCases array is required.' });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test Cases');

    // Set column widths (A–G)
    sheet.getColumn(1).width = 10;   // TC ID
    sheet.getColumn(2).width = 40;   // Title
    sheet.getColumn(3).width = 20;   // Priority
    sheet.getColumn(4).width = 20;   // Type
    sheet.getColumn(5).width = 50;   // Expected Result
    sheet.getColumn(6).width = 15;   // DEV
    sheet.getColumn(7).width = 15;   // QA

    // Row 1 — top header with merged "Execution Status" over F1:G1
    const row1 = sheet.getRow(1);
    row1.values = ['TC ID', 'Title', 'Priority', 'Type', 'Expected Result', 'Execution Status'];
    sheet.mergeCells('F1:G1');

    // Row 2 — sub-headers for the merged columns
    const row2 = sheet.getRow(2);
    row2.values = [null, null, null, null, null, 'DEV', 'QA'];

    // Merge A1:A2, B1:B2, C1:C2, D1:D2, E1:E2 (span 2 rows for non-split headers)
    ['A', 'B', 'C', 'D', 'E'].forEach((col) => sheet.mergeCells(`${col}1:${col}2`));

    // Style both header rows
    const headerStyle = { bold: true };
    const headerAlign = { vertical: 'middle', horizontal: 'center' };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    const headerBorder = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };

    [row1, row2].forEach((row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = headerStyle;
        cell.alignment = headerAlign;
        cell.fill = headerFill;
        cell.border = headerBorder;
      });
    });

    // Data rows starting at row 3
    testCases.forEach((tc) => {
      sheet.addRow([tc.id, tc.title, tc.priority, tc.category, tc.expected, '', '']);
    });

    // Enable filter dropdowns on sub-header row (row 2, all columns)
    sheet.autoFilter = { from: 'A2', to: 'G2' };

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=testcases.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Excel generation failed:', err);
    res.status(500).json({ error: 'Failed to generate Excel file.' });
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
