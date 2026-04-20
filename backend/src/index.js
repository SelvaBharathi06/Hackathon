const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { runRuleEngine, CATEGORY_SORT_ORDER } = require('./ruleEngine');
const { generateJUnitCodeV2 } = require('./junitGeneratorV2');
const { enhanceWithAI } = require('./aiService');
const { convertUserStoryToModel } = require('./textParser');
const { extractTextFromFile, cleanupFile } = require('./fileExtractor');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 4000;
const MIN_TEST_CASES = 40;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
// Quality Enforcement — removes generic/low-value test cases, deduplicates
// ---------------------------------------------------------------------------

const GENERIC_TITLE_PATTERNS = [
  /^verify (?:the )?(?:page|api|app|system|it) (?:loads|works|functions|runs|is\s+working)/i,
  /^check (?:the )?(?:response|result|output|page)$/i,
  /^test (?:the )?(?:api|endpoint|feature|page|system)$/i,
  /^verify (?:everything|all|basic) (?:works|functions|is\s+ok)/i,
  /^ensure (?:the )?(?:api|page|system|app) (?:is )?(?:working|functional|ok|running)/i,
  /^verify (?:the )?(?:ui|interface|frontend|backend) (?:works|loads|renders)$/i,
  /^verify (?:basic )?functionality$/i,
  /^smoke test$/i,
];

function enforceQuality(testCases, maxCases = 70, minCases = 40) {
  let filtered = testCases;

  // 1. Remove test cases with generic titles
  filtered = filtered.filter(tc => {
    const title = (tc.title || '').trim();
    if (!title || title.length < 20) return false;
    return !GENERIC_TITLE_PATTERNS.some(pattern => pattern.test(title));
  });

  // 2. Remove test cases missing critical fields
  filtered = filtered.filter(tc => {
    if (!tc.title || !tc.category || !tc.priority) return false;
    if (!tc.steps || !Array.isArray(tc.steps) || tc.steps.length === 0) return false;
    if (!tc.expected) return false;
    if (!tc.preconditions || !Array.isArray(tc.preconditions) || tc.preconditions.length === 0) return false;
    return true;
  });

  // 3. Remove near-duplicate titles (word-overlap > 85%)
  const seen = new Map();
  filtered = filtered.filter(tc => {
    const words = new Set(
      tc.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
    );
    for (const [, existingWords] of seen.entries()) {
      const intersection = [...words].filter(w => existingWords.has(w)).length;
      const union = new Set([...words, ...existingWords]).size;
      if (union > 0 && intersection / union > 0.85) return false;
    }
    seen.set(tc.title, words);
    return true;
  });

  // 4. Cap at maxCases — remove lowest priority first if over limit
  if (filtered.length > maxCases) {
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));
    filtered = filtered.slice(0, maxCases);
  }

  // 5. Re-sort by category and renumber
  filtered.sort((a, b) =>
    (CATEGORY_SORT_ORDER[a.category] ?? 9) - (CATEGORY_SORT_ORDER[b.category] ?? 9)
  );
  filtered.forEach((tc, i) => { tc.id = i + 1; });

  console.log(`[enforceQuality] ${testCases.length} → ${filtered.length} test cases (removed ${testCases.length - filtered.length} low-quality)`);
  return filtered;
}

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

    // 5. Enforce quality — remove generics, dedup, cap at 70
    testCases = enforceQuality(testCases);

    // 6. Generate JUnit code
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

    // 5. Ensure minimum test cases by padding with QA-quality patterns
    if (testCases.length < MIN_TEST_CASES) {
      testCases = padTestCases(testCases, model.detectedFeatures);
    }
    sortAndRenumber(testCases);

    // 5b. Enforce quality — remove generics, dedup, cap at 70
    testCases = enforceQuality(testCases);

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

    // 5b. Enforce quality — remove generics, dedup, cap at 70
    testCases = enforceQuality(testCases);

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
// POST /generate-from-swagger-url  (Swagger / OpenAPI URL input)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: Validate Swagger/OpenAPI structure
// ---------------------------------------------------------------------------

function validateSwaggerStructure(data) {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid Swagger response (not JSON)');
  }

  if (!data.paths || typeof data.paths !== 'object' || Object.keys(data.paths).length === 0) {
    throw new Error('Invalid OpenAPI/Swagger specification: no paths found');
  }

  if (!data.openapi && !data.swagger) {
    throw new Error('Invalid OpenAPI/Swagger specification: missing openapi or swagger version field');
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helper: Fetch and validate Swagger JSON with fallback logic
// ---------------------------------------------------------------------------

async function fetchSwaggerJson(url) {
  console.log(`[Swagger Fetch] Attempting: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; QA-Test-Generator/1.0)',
      },
      timeout: 15000,
    });

    console.log(`[Swagger Fetch] Response status: ${response.status}, type: ${typeof response.data}`);

    // Check if response is HTML (Swagger UI page)
    if (typeof response.data === 'string') {
      if (response.data.includes('<!DOCTYPE') || response.data.includes('<html')) {
        throw new Error('Swagger UI page detected. Please provide the JSON specification URL instead (e.g., /swagger.json or /openapi.json)');
      }
      throw new Error('Received HTML/text instead of JSON. Please provide a valid Swagger/OpenAPI JSON URL.');
    }

    // Validate response is an object
    if (typeof response.data !== 'object') {
      throw new Error('Invalid Swagger response (not JSON)');
    }

    // Validate Swagger structure
    validateSwaggerStructure(response.data);

    console.log(`[Swagger Fetch] Success: ${url}`);
    return response.data;
  } catch (err) {
    console.log(`[Swagger Fetch] Failed for ${url}: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Endpoint: Generate from Swagger URL with robust handling
// ---------------------------------------------------------------------------

app.post('/generate-from-swagger-url', async (req, res) => {
  try {
    const { url } = req.body || {};

    // 1. Validate URL
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: '"url" is required and must be a non-empty string.' });
    }

    let parsed;
    try { parsed = new URL(url.trim()); } catch {
      return res.status(400).json({ error: 'Invalid URL format. Please provide a valid Swagger/OpenAPI JSON URL.' });
    }

    console.log('[Swagger URL received]:', parsed.href);

    // Early validation: reject Swagger UI URLs
    if (parsed.hash && parsed.hash.includes('/')) {
      return res.status(400).json({
        error: 'Swagger UI URL detected. Please use the JSON specification URL instead.',
        details: 'You provided a Swagger UI link (with #/). Please use the direct JSON spec URL like /swagger.json or /openapi.json',
        suggestion: `${parsed.origin}${parsed.pathname}/swagger.json`,
      });
    }

    // 2. Fetch Swagger JSON
    let swaggerJson;
    try {
      swaggerJson = await fetchSwaggerJson(parsed.href);
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid Swagger URL.',
        details: err.message,
        suggestion: 'Please use a valid OpenAPI/Swagger JSON specification URL (e.g., /swagger.json or /openapi.json)',
      });
    }

    // 3. Extract endpoints from OpenAPI/Swagger spec
    const paths = swaggerJson.paths;
    const endpoints = [];
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, details] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
          const fields = {};

          // OpenAPI 3.x requestBody
          const schema = details.requestBody?.content?.['application/json']?.schema;
          if (schema?.properties) {
            for (const [name, prop] of Object.entries(schema.properties)) {
              fields[name] = prop.type || 'string';
            }
          }

          // Swagger 2.x / OpenAPI parameters
          const params = details.parameters || [];
          for (const p of params) {
            if (p.in === 'body' && p.schema?.properties) {
              for (const [name, prop] of Object.entries(p.schema.properties)) {
                fields[name] = prop.type || 'string';
              }
            } else if (p.in === 'query' || p.in === 'path') {
              fields[p.name] = p.type || p.schema?.type || 'string';
            }
          }

          // If no fields found, add a placeholder so rule engine still works
          if (Object.keys(fields).length === 0) {
            fields.id = 'string';
          }

          endpoints.push({
            endpoint: path,
            method: method.toUpperCase(),
            fields,
            operationId: details.operationId || `${method.toUpperCase()} ${path}`,
            summary: details.summary || '',
          });
        }
      }
    }

    if (endpoints.length === 0) {
      return res.status(400).json({ error: 'No valid endpoints found in the Swagger specification.' });
    }

    // 6. Generate test cases for each endpoint
    let allTestCases = [];
    for (const ep of endpoints) {
      try {
        const cases = runRuleEngine(ep);
        allTestCases = allTestCases.concat(cases);
      } catch (err) {
        console.warn(`Rule engine failed for ${ep.method} ${ep.endpoint}:`, err.message);
      }
    }

    if (allTestCases.length === 0) {
      return res.status(500).json({ error: 'Failed to generate test cases from the Swagger endpoints.' });
    }

    // 7. Sort, renumber, and pad if needed
    sortAndRenumber(allTestCases);
    if (allTestCases.length < MIN_TEST_CASES) {
      const features = endpoints.map((ep) => `${ep.method} ${ep.endpoint}`);
      allTestCases = padTestCases(allTestCases, features);
      sortAndRenumber(allTestCases);
    }

    // 8. Enforce quality
    allTestCases = enforceQuality(allTestCases);

    // 9. Generate JUnit code
    let junitCode;
    try {
      const pseudoInput = { endpoint: endpoints[0].endpoint, method: endpoints[0].method, fields: endpoints[0].fields };
      junitCode = generateJUnitCodeV2(pseudoInput, allTestCases);
    } catch (err) {
      console.error('JUnit generation failed:', err);
      junitCode = '// JUnit code generation failed. See test cases table for results.';
    }

    // 10. Respond
    const summary = buildSummary(allTestCases);
    const detectedFeatures = endpoints.map((ep) => `${ep.method} ${ep.endpoint}${ep.summary ? ' — ' + ep.summary : ''}`);
    console.log(`[/generate-from-swagger-url] Final: ${summary.total} test cases from ${endpoints.length} endpoints`);

    return res.json({
      testCases: allTestCases,
      junitCode,
      summary,
      detectedFeatures,
      parsingSource: 'swagger',
      swaggerInfo: {
        title: swaggerJson.info?.title || 'Unknown API',
        version: swaggerJson.info?.version || '',
        endpointCount: endpoints.length,
      },
    });
  } catch (err) {
    console.error('Unexpected error in /generate-from-swagger-url:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Padding templates (QA format) for text-based generation
// ---------------------------------------------------------------------------

const PADDING_TEMPLATES = [
  { title: 'Verify {f} enforces business rule: minimum value validation for numeric fields', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} has numeric fields with defined minimum values'],
    steps: ['Enter a value below the minimum threshold for a numeric field', 'Attempt to submit or save', 'Verify specific validation error appears', 'Verify submission is blocked'],
    expected: 'Minimum value rule enforced. Values below threshold rejected with clear error message.' },
  { title: 'Verify {f} state machine transitions follow defined workflow rules', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} has multi-state workflow (Draft→Pending→Approved)'],
    steps: ['Attempt to transition from Draft directly to Approved (bypassing Pending)', 'Verify transition is blocked', 'Verify error indicates invalid state transition', 'Verify only valid transitions (Draft→Pending, Pending→Approved) are allowed'],
    expected: 'State machine enforces valid transitions only. Invalid transitions blocked with specific error.' },
  { title: 'Verify {f} audit trail logs all create/update/delete actions with user and timestamp', category: 'Happy Path', priority: 'HIGH',
    pre: ['User is logged in', '{f} has audit trail enabled'],
    steps: ['Create a new record in {f}', 'Update the record', 'Delete the record', 'Navigate to audit trail log', 'Verify all three actions logged with user ID, action type, and timestamp'],
    expected: 'All CRUD operations captured in audit trail with complete metadata (user, timestamp, action).' },
  { title: 'Verify {f} handles concurrent modifications with optimistic locking', category: 'Edge Case', priority: 'HIGH',
    pre: ['User is logged in', '{f} supports concurrent access', 'Two users are accessing the same record'],
    steps: ['User A opens record for editing', 'User B opens the same record', 'User B saves changes first', 'User A attempts to save their changes', 'Verify User A receives conflict error or prompt to resolve'],
    expected: 'Concurrent modification detected. User A shown conflict error with option to refresh and retry.' },
  { title: 'Verify {f} performance under load: response time < 2s with 1000 records', category: 'Edge Case', priority: 'HIGH',
    pre: ['User is logged in', '{f} contains 1000+ records', 'Performance testing tools available'],
    steps: ['Navigate to {f} with 1000 records loaded', 'Measure initial page load time', 'Perform filter/sort operations', 'Verify all operations complete within 2 seconds'],
    expected: 'All operations complete within acceptable performance threshold (< 2s) with production-scale data.' },
  { title: 'Verify {f} role-based access control restricts operations based on user permissions', category: 'Negative', priority: 'HIGH',
    pre: ['User with limited permissions is logged in', '{f} has role-based restrictions'],
    steps: ['Attempt to perform a restricted action (delete/admin function)', 'Verify action is blocked', 'Verify access denied error message shown', 'Verify no data modification occurs'],
    expected: 'RBAC enforced. Restricted users blocked from unauthorized operations with clear access denied message.' },
  { title: 'Verify {f} sanitizes input while preserving legitimate special characters', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} accepts text input with special characters'],
    steps: ['Enter legitimate special characters: apostrophes, ampersands, angle brackets', 'Submit the form', 'Verify data is stored correctly without corruption', 'Verify XSS/SQL injection still blocked'],
    expected: 'Legitimate special characters preserved. Malicious patterns sanitized without false positives.' },
  { title: 'Verify {f} data integrity: foreign key constraints prevent orphaned records', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} has relational data with foreign key constraints'],
    steps: ['Delete a parent record that has dependent child records', 'Verify delete is blocked', 'Verify error indicates dependent records exist', 'Verify cascading delete or block behavior matches specification'],
    expected: 'Foreign key constraints enforced. Orphaned records prevented with clear error message.' },
  { title: 'Verify {f} pagination remains consistent when data changes during navigation', category: 'Edge Case', priority: 'MEDIUM',
    pre: ['User is logged in', '{f} has pagination with dynamic data'],
    steps: ['Navigate to page 1', 'Note the records visible', 'Add a new record that would appear on page 1', 'Navigate to page 2 and back to page 1', 'Verify pagination recalculates correctly'],
    expected: 'Pagination recalculates correctly when underlying data changes. No stale or duplicate records shown.' },
  { title: 'Verify {f} error recovery: user input preserved after server error', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} has a form with multiple fields', 'Backend configured to return 500 on submission'],
    steps: ['Fill all form fields with valid data', 'Submit the form', 'Observe server error message', 'Verify all user input remains in fields', 'Retry submission without re-entering data'],
    expected: 'User input preserved after server error. User can retry without re-entering data.' },
  { title: 'Verify {f} compliance: required regulatory fields are enforced and validated', category: 'Negative', priority: 'HIGH',
    pre: ['User is logged in', '{f} has regulatory/compliance field requirements'],
    steps: ['Attempt to submit without a mandatory compliance field', 'Verify submission blocked', 'Verify error identifies the missing compliance requirement', 'Fill the field and verify submission succeeds'],
    expected: 'Regulatory fields enforced. Missing compliance data blocked with specific error message.' },
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
