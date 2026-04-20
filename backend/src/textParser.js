/**
 * textParser.js — Deep semantic parsing of requirement documents into
 * QA-engineer-level test cases.
 *
 * Strategies (in order):
 *   1. AI-powered (OpenRouter) — best quality, sends pre-analysed context
 *   2. Deep multi-pattern extraction — always works, no API key needed
 *
 * Key improvements:
 *   - Full text cleaning & normalization
 *   - 25+ multi-pattern feature detection groups
 *   - Entity/action/condition extraction from sentences
 *   - Per-feature, business-logic-specific test generation
 *   - Contextual test cases referencing actual document terms
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openai/gpt-3.5-turbo';

const CATEGORY_SORT = { 'Happy Path': 0, 'Negative': 1, 'Edge Case': 2, 'Adhoc': 3 };

// ===================================================================
// 1. TEXT CLEANING
// ===================================================================

function cleanText(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[^\S\n]+$/gm, '')
    .trim();
}

// ===================================================================
// 2. DEEP MULTI-PATTERN FEATURE DETECTION (25+ groups)
// ===================================================================

const FEATURE_PATTERNS = [
  { feature: 'Navigation',              patterns: [/\b(navigation|nav[\s-]?bar|left[\s-]?nav|sidebar|side[\s-]?menu|breadcrumb|menu\s*item|route|routing|page\s*transition)\b/i] },
  { feature: 'Dashboard',               patterns: [/\b(dashboard|overview|home[\s-]?page|landing[\s-]?page|main\s*screen|summary\s*view|analytics\s*page)\b/i] },
  { feature: 'CTA / Buttons',           patterns: [/\b(CTA|call[\s-]to[\s-]action|primary\s*button|submit|create\s*button|action\s*button|save\s*button)\b/i] },
  { feature: 'Feature Flags',           patterns: [/\b(feature[\s-]?flag|feature[\s-]?toggle|flag[\s-]?on|flag[\s-]?off|a\/?b\s*test|experiment|canary|rollout)\b/i] },
  { feature: 'Cards / Widgets',         patterns: [/\b(card|tile|widget|panel|summary[\s-]?card|kpi[\s-]?card|stat[\s-]?card|info[\s-]?card|metric)\b/i] },
  { feature: 'Forms / Inputs',          patterns: [/\b(form|input[\s-]?field|text[\s-]?field|dropdown|select[\s-]?box|checkbox|radio[\s-]?button|date[\s-]?picker|multi[\s-]?select)\b/i] },
  { feature: 'Search / Filter',         patterns: [/\b(search|filter|find|look[\s-]?up|auto[\s-]?complete|type[\s-]?ahead|faceted)\b/i] },
  { feature: 'Data Tables / Lists',     patterns: [/\b(table|data[\s-]?grid|list[\s-]?view|rows?\s*and\s*columns|column[\s-]?header|pagination|sort(?:ing)?|export[\s-]?to[\s-]?csv)\b/i] },
  { feature: 'Authentication',          patterns: [/\b(login|log[\s-]?in|logout|log[\s-]?out|sign[\s-]?in|sign[\s-]?out|auth(?:entication)?|session|token|password|credential|SSO|MFA|2FA|OTP)\b/i] },
  { feature: 'Error / Loading States',  patterns: [/\b(error[\s-]?state|loading|spinner|skeleton|timeout|retry|fallback|empty[\s-]?state|offline)\b/i] },
  { feature: 'Notifications',           patterns: [/\b(notification|alert|toast|banner|snackbar|system[\s-]?message|push[\s-]?notification)\b/i] },
  { feature: 'Modals / Dialogs',        patterns: [/\b(modal|dialog|popup|overlay|lightbox|confirmation[\s-]?dialog|drawer|bottom[\s-]?sheet)\b/i] },
  { feature: 'Permissions / Roles',     patterns: [/\b(permission|role|admin|RBAC|access[\s-]?control|authorization|privilege|read[\s-]?only|restricted)\b/i] },
  { feature: 'Financial Data',          patterns: [/\b(gain|loss|profit|revenue|amount|price|cost|balance|percentage|growth|decline|NAV|AUM|investment|fund|portfolio|dividend|yield|asset|liability)\b/i] },
  { feature: 'Workflow / Approval',     patterns: [/\b(workflow|approval|approve|reject|pending|status[\s-]?change|state[\s-]?machine|step[\s-]?by[\s-]?step|pipeline|escalat)/i] },
  { feature: 'Reports / Export',        patterns: [/\b(report|export|download|PDF[\s-]?export|CSV|Excel|print|generate[\s-]?report|schedule[\s-]?report)\b/i] },
  { feature: 'User Profile / Settings', patterns: [/\b(profile|settings|preferences|account[\s-]?settings|change[\s-]?password|user[\s-]?info|avatar|timezone)\b/i] },
  { feature: 'File Upload',             patterns: [/\b(file[\s-]?upload|attach|attachment|document[\s-]?upload|drag[\s-]?and[\s-]?drop|browse[\s-]?file)\b/i] },
  { feature: 'Data Validation',         patterns: [/\b(validat(?:ion|e)|business[\s-]?rule|constraint|mandatory|required[\s-]?field|format[\s-]?check|regex|saniti[sz])\b/i] },
  { feature: 'API Integration',         patterns: [/\b(API|endpoint|REST|GraphQL|webhook|third[\s-]?party|integration|microservice|backend[\s-]?call)\b/i] },
  { feature: 'Responsive / Mobile',     patterns: [/\b(responsive|mobile|tablet|breakpoint|viewport|adaptive|touch|swipe|gesture)\b/i] },
  { feature: 'Accessibility',           patterns: [/\b(accessibility|a11y|WCAG|screen[\s-]?reader|aria|keyboard[\s-]?navigation|focus[\s-]?management|contrast)\b/i] },
  { feature: 'Charts / Visualization',  patterns: [/\b(chart|graph|pie[\s-]?chart|bar[\s-]?chart|line[\s-]?chart|donut|visualization|plot|legend|tooltip[\s-]?hover)\b/i] },
  { feature: 'Compliance / Regulatory', patterns: [/\b(compliance|regulatory|CSSF|AIFMD|UCITS|KYC|AML|audit[\s-]?trail|GDPR|PCI|SOC|regulation)\b/i] },
  { feature: 'Date / Time Handling',    patterns: [/\b(date[\s-]?range|calendar|schedule|deadline|due[\s-]?date|time[\s-]?zone|period|frequency|recurring)\b/i] },
  { feature: 'Multi-language / i18n',   patterns: [/\b(language|locale|i18n|internation|translat|multi[\s-]?language|RTL|locali[sz])\b/i] },
];

function detectFeatures(text) {
  const detected = [];
  for (const fp of FEATURE_PATTERNS) {
    for (const pat of fp.patterns) {
      if (pat.test(text)) { detected.push(fp.feature); break; }
    }
  }
  return detected;
}

// ===================================================================
// 3. ENTITY / ACTION / CONDITION EXTRACTION
// ===================================================================

function extractEntities(text) {
  const sentences = text.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 10);
  const actions = [], conditions = [], validations = [], entities = [];

  for (const s of sentences) {
    const actMatch = s.match(/(?:user|system|admin|investor|manager|client)\s+(?:can|shall|should|must|will|may)\s+(.{10,80})/i);
    if (actMatch) actions.push(actMatch[1].replace(/[.,;]+$/, '').trim());
    const condMatch = s.match(/\b(?:if|when|only\s*when|unless|provided\s*that)\s+(.{10,80})/i);
    if (condMatch) conditions.push(condMatch[1].replace(/[.,;]+$/, '').trim());
    const valMatch = s.match(/\b(?:validat[ei]|must\s*be|should\s*not\s*exceed|cannot\s*be|is\s*required|shall\s*not|format\s*must)\s*(.{5,80})/i);
    if (valMatch) validations.push(valMatch[1].replace(/[.,;]+$/, '').trim());
    const entMatch = s.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g);
    if (entMatch) entities.push(...entMatch.filter(e => e.length > 3 && !['The','This','That','When','Then','Given','And','But','For','With','From','Into','Each','All','Any'].includes(e)));
  }

  const unique = (arr) => [...new Set(arr)];
  return {
    actions:     unique(actions).slice(0, 20),
    conditions:  unique(conditions).slice(0, 15),
    validations: unique(validations).slice(0, 15),
    entities:    unique(entities).slice(0, 30),
  };
}

// ===================================================================
// 4. HELPER
// ===================================================================

function T(title, category, priority, preconditions, steps, expected) {
  return { title, category, priority, preconditions, steps, expected, statusCode: 200 };
}

// ===================================================================
// 5. AI-POWERED EXTRACTION (enhanced with pre-analysis context)
// ===================================================================

function buildParsingPrompt(text, features, extracted) {
  const featureList = features.length > 0 ? features.join(', ') : 'not pre-detected';
  const actionList  = extracted.actions.length > 0 ? extracted.actions.slice(0, 10).join('; ') : 'none';
  const condList    = extracted.conditions.length > 0 ? extracted.conditions.slice(0, 8).join('; ') : 'none';
  const valList     = extracted.validations.length > 0 ? extracted.validations.slice(0, 8).join('; ') : 'none';

  return `You are a senior QA engineer with 8+ years experience. You are reading a PRD/requirement document.

PRE-ANALYSIS (auto-detected):
- Detected features: ${featureList}
- Key actions: ${actionList}
- Conditions/business rules: ${condList}
- Validations: ${valList}

FULL DOCUMENT:
"""
${text.slice(0, 8000)}
"""

TASK: Generate comprehensive QA test cases for EVERY feature and business rule.

RULES:
1. Generate at least 40 test cases covering ALL detected features.
2. For EACH detected feature, generate at least 3 specific test cases.
3. Categories in order: Happy Path, Negative, Edge Case, Adhoc.
4. Include 5+ Happy Path scenarios covering end-to-end success flows.
5. NEVER generic cases like "verify page loads" or "verify UI works".
6. Reference specific terms, field names, values from the document.
7. Include business-logic-specific tests (calculations, workflows, compliance).
8. Preconditions must be document-specific.
9. Steps must be numbered and executable by a manual tester.
10. Expected results must be precise and verifiable.

Return ONLY JSON (no markdown, no code fences):
{
  "detectedFeatures": ["feature1", "feature2"],
  "testCases": [
    {
      "title": "specific test title referencing document terms",
      "category": "Happy Path" | "Negative" | "Edge Case" | "Adhoc",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "preconditions": ["specific precondition 1", "specific precondition 2"],
      "steps": ["Step 1: do X", "Step 2: do Y"],
      "expected": "precise expected outcome"
    }
  ]
}`;
}

async function parseWithAI(text, features, extracted) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: buildParsingPrompt(text, features, extracted) }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Could not parse AI response.');
  }
  return parsed;
}

// ===================================================================
// 6. PER-FEATURE TEST CASE TEMPLATES (business-logic-aware)
// ===================================================================

const FEATURE_TESTS = {};

FEATURE_TESTS['Navigation'] = (ctx) => [
  T(`Verify all navigation links (${ctx.items}) route to the correct pages`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Application has fully loaded', 'Navigation menu is visible'],
    ['Locate the navigation menu/sidebar', 'Click each navigation item sequentially', 'Verify each click goes to the correct page', 'Verify the URL updates for each section'],
    'Every navigation link routes to the correct page with accurate URL and content.'),
  T('Verify active navigation item is highlighted for the current page',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Navigation is rendered with multiple items'],
    ['Navigate to the first page via menu', 'Observe the active menu item visual state', 'Navigate to a second page', 'Verify the highlight moves to the new item'],
    'The current page menu item shows a distinct visual state (bold/colour) while others remain default.'),
  T('Verify navigation is inaccessible when user is not authenticated',
    'Negative', 'HIGH',
    ['User is NOT logged in'],
    ['Attempt to access a protected URL directly', 'Observe application behavior', 'Check if navigation menu is rendered'],
    'User is redirected to login. Navigation is hidden for unauthenticated users.'),
  T('Verify deep-link navigation preserves query parameters and state',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'A page URL with query parameters exists'],
    ['Copy a page URL with query params', 'Open in new tab', 'Verify page loads with filters matching URL params'],
    'Deep-link loads correct page with all query parameters applied.'),
  T('Verify navigation collapses into hamburger on mobile viewport (375px)',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Viewport is 375px width'],
    ['Open on mobile viewport', 'Verify full nav hidden', 'Tap hamburger icon', 'Verify menu expands', 'Tap an item and verify navigation'],
    'On mobile, nav collapses into hamburger. Tapping reveals all items.'),
  T('Verify keyboard-only navigation through menu items',
    'Adhoc', 'MEDIUM',
    ['User is logged in'],
    ['Tab to navigation menu', 'Arrow keys between items', 'Press Enter to activate', 'Verify focus indicators visible'],
    'All menu items reachable via keyboard with visible focus indicators.'),
];

FEATURE_TESTS['Dashboard'] = (ctx) => [
  T(`Verify dashboard loads all widgets (${ctx.items}) with correct data`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend APIs return valid data'],
    ['Navigate to dashboard', 'Wait for widgets to load', 'Verify each widget has data (no placeholders)', 'Cross-check values against API response'],
    'Dashboard renders all widgets with data matching the API response.'),
  T('Verify dashboard data refreshes correctly on page refresh',
    'Happy Path', 'MEDIUM',
    ['User is on the dashboard', 'Backend data has changed'],
    ['Note current values', 'Trigger page refresh', 'Wait for reload', 'Verify values reflect latest data'],
    'Dashboard shows the most recent data after refresh.'),
  T('Verify dashboard widget click-through to detail view',
    'Happy Path', 'MEDIUM',
    ['User is logged in', 'Widgets are clickable per spec'],
    ['Click a summary card', 'Verify navigation to detail page', 'Verify detail shows contextual data', 'Click back and verify return'],
    'Widget click navigates to correct detail view with contextual data.'),
  T('Verify dashboard graceful empty state when no data is available',
    'Negative', 'HIGH',
    ['User is logged in', 'Backend returns empty datasets'],
    ['Navigate to dashboard', 'Observe widgets', 'Verify no broken layout or JS errors', 'Verify empty-state message shown'],
    'Dashboard shows "No data available" messages instead of blank spaces or errors.'),
  T('Verify dashboard handles partial API failure (some widgets fail)',
    'Negative', 'HIGH',
    ['User is logged in', 'One backend API returns 500, others return 200'],
    ['Navigate to dashboard', 'Verify working widgets display correctly', 'Verify failed widget shows error with retry', 'Verify page does not crash'],
    'Partial API failure only affects the specific widget. Others continue working.'),
  T('Verify dashboard loading skeletons during data fetch',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Network throttled to 3G'],
    ['Open dashboard', 'Observe UI before data arrives', 'Verify skeleton loaders visible', 'Wait for data and verify skeletons replaced'],
    'Skeleton loaders appear during fetch, replaced by content once loaded.'),
  T('Verify dashboard layout across desktop (1440px), tablet (768px), mobile (375px)',
    'Adhoc', 'MEDIUM',
    ['User is logged in'],
    ['View at 1440px desktop', 'Resize to 768px tablet', 'Resize to 375px mobile', 'Verify no overlap or truncation at any size'],
    'Dashboard reflows correctly at each breakpoint.'),
];

FEATURE_TESTS['CTA / Buttons'] = (ctx) => [
  T(`Verify primary CTA (${ctx.items}) executes intended action successfully`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'All preconditions met', 'CTA is visible and enabled'],
    ['Locate the CTA button', 'Click it', 'Observe system response', 'Verify success confirmation'],
    'CTA triggers the correct action with success confirmation.'),
  T('Verify CTA is disabled when preconditions are not met',
    'Negative', 'HIGH',
    ['User is logged in', 'Required fields are empty/invalid'],
    ['Leave required fields empty', 'Observe CTA state', 'Attempt to click', 'Verify no action triggered'],
    'CTA appears disabled and does not trigger any action.'),
  T('Verify rapid double-click on CTA does not trigger duplicate submissions',
    'Edge Case', 'HIGH',
    ['User is logged in', 'CTA is enabled'],
    ['Click CTA twice rapidly (<200ms)', 'Monitor network requests', 'Verify only one API call', 'Verify no duplicate records'],
    'System prevents duplicate submission — only one action executes.'),
  T('Verify CTA shows loading state during async processing',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Network throttled'],
    ['Click CTA', 'Verify spinner appears', 'Verify button disabled during processing', 'Wait for completion'],
    'CTA shows loading spinner, disabled during processing, returns to normal on completion.'),
];

FEATURE_TESTS['Feature Flags'] = (ctx) => [
  T(`Verify feature is fully visible when feature flag is ON`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Feature flag is ON/enabled'],
    ['Navigate to the flagged feature page', 'Verify feature UI visible', 'Interact with the feature', 'Verify it works as specified'],
    'Feature flag ON: feature fully rendered and functional.'),
  T('Verify feature is hidden when feature flag is OFF',
    'Negative', 'HIGH',
    ['User is logged in', 'Feature flag is OFF/disabled'],
    ['Navigate to where feature would appear', 'Verify feature NOT in DOM', 'Verify no console errors', 'Verify rest of page works'],
    'Feature flag OFF: feature completely absent. No errors or broken layout.'),
  T('Verify missing feature flag configuration falls back to safe default',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Flag config deleted or undefined'],
    ['Navigate to flagged feature page', 'Observe behavior', 'Check console', 'Verify no crash'],
    'Missing flag: system defaults to feature hidden without crashes.'),
  T('Verify toggling flag ON→OFF→ON reflects immediately',
    'Edge Case', 'MEDIUM',
    ['User has flag management access'],
    ['Toggle ON, verify feature appears', 'Toggle OFF, verify disappears', 'Toggle ON again, verify reappears'],
    'Flag toggles take effect dynamically with no stale state.'),
];

FEATURE_TESTS['Cards / Widgets'] = (ctx) => [
  T(`Verify all cards display correct data (${ctx.items})`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns valid data'],
    ['Navigate to cards page', 'Note each card value', 'Compare with API response', 'Verify labels and values correct'],
    'All cards show accurate data matching the API response.'),
  T('Verify card click navigates to detail view',
    'Happy Path', 'MEDIUM',
    ['User is logged in', 'Cards rendered with data'],
    ['Click a card', 'Verify detail page loads', 'Verify contextual data shown', 'Verify back navigation works'],
    'Card click navigates to correct detail view.'),
  T('Verify cards render fallback when data is null',
    'Negative', 'HIGH',
    ['User is logged in', 'API returns null for card fields'],
    ['Navigate to cards', 'Observe cards with missing data', 'Verify "N/A" or dash shown', 'Verify no layout breakage'],
    'Cards with missing data show placeholder and maintain alignment.'),
];

FEATURE_TESTS['Forms / Inputs'] = (ctx) => [
  T(`Verify form submission with all valid fields succeeds`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Form page loaded'],
    ['Fill all required fields with valid data', 'Fill optional fields', 'Click Submit', 'Verify success message', 'Verify data persisted'],
    'Form submits with valid data. Success confirmation. Data persisted.'),
  T('Verify form shows validation errors for empty required fields',
    'Negative', 'HIGH',
    ['User is logged in', 'Form page loaded'],
    ['Leave required fields empty', 'Click Submit', 'Verify inline error per field', 'Verify form NOT submitted'],
    'Each required field shows inline error. Form does not submit.'),
  T('Verify form retains input after server-side failure',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Backend returns 500'],
    ['Fill all fields', 'Submit', 'Observe server error', 'Verify data still present in fields'],
    'User input preserved after server error for retry.'),
  T('Verify form sanitizes special characters (XSS/SQL injection)',
    'Edge Case', 'MEDIUM',
    ['User is logged in'],
    ['Enter XSS: <script>alert(1)</script>', 'Enter SQL: \' OR 1=1 --', 'Submit', 'Verify input escaped or rejected'],
    'Special characters sanitized. No XSS or injection.'),
];

FEATURE_TESTS['Search / Filter'] = (ctx) => [
  T('Verify search returns accurate results matching query',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Data set has searchable entries'],
    ['Enter known search term', 'Execute search', 'Verify results match', 'Verify count correct'],
    'Search returns all matching results. Count accurate.'),
  T('Verify filter combinations narrow results correctly',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Data has filterable attributes'],
    ['Apply single filter, verify results narrow', 'Add second filter, verify further narrowing', 'Remove one filter, verify results expand', 'Clear all, verify full dataset'],
    'Filters narrow/expand results correctly when applied/removed.'),
  T('Verify no-results state for unmatched search',
    'Negative', 'MEDIUM',
    ['User is logged in'],
    ['Enter non-existent term', 'Execute search', 'Verify "No results" message', 'Verify guidance shown'],
    '"No results found" message with guidance. No blank page.'),
  T('Verify search handles special characters safely',
    'Edge Case', 'MEDIUM',
    ['User is logged in'],
    ['Enter <, >, &, " in search', 'Execute', 'Verify no XSS', 'Verify safe display'],
    'Special characters handled safely. No XSS.'),
];

FEATURE_TESTS['Data Tables / Lists'] = (ctx) => [
  T('Verify table renders all columns with correct headers and data',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns multi-row dataset'],
    ['Navigate to table page', 'Verify column headers', 'Verify data rows match API', 'Verify row count correct'],
    'Table displays all columns with correct data.'),
  T('Verify table sorting for all sortable columns',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Table has sortable columns'],
    ['Click column header for ascending', 'Verify sort order', 'Click again for descending', 'Verify reverse sort'],
    'Sorting works correctly ascending and descending for all sortable columns.'),
  T('Verify table pagination between pages',
    'Happy Path', 'MEDIUM',
    ['User is logged in', 'Dataset exceeds per-page limit'],
    ['Verify page 1 rows', 'Click Next', 'Verify different rows', 'Click Previous', 'Verify original rows'],
    'Pagination navigates correctly with correct data per page.'),
  T('Verify table empty state',
    'Negative', 'MEDIUM',
    ['User is logged in', 'Backend returns empty array'],
    ['Navigate to table', 'Verify header visible', 'Verify "No data" message', 'Verify no JS errors'],
    'Empty table shows "No data" message. Header intact.'),
];

FEATURE_TESTS['Authentication'] = (ctx) => [
  T('Verify successful login redirects to dashboard',
    'Happy Path', 'HIGH',
    ['Login page loaded', 'Valid credentials available'],
    ['Enter valid username/email', 'Enter correct password', 'Click Sign In', 'Verify session token set', 'Verify redirect to dashboard'],
    'Successful login creates session and redirects to dashboard.'),
  T('Verify login with wrong password shows error',
    'Negative', 'HIGH',
    ['Login page loaded'],
    ['Enter valid username', 'Enter wrong password', 'Click Sign In', 'Verify error message', 'Verify user stays on login page'],
    'Login fails with appropriate error. No sensitive info leaked.'),
  T('Verify session expiration redirects to login',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Session timeout configured'],
    ['Wait for session to expire', 'Attempt to interact', 'Verify redirect to login', 'Verify "Session expired" message'],
    'Expired session redirects to login with clear message.'),
  T('Verify account lockout after 5 failed login attempts',
    'Negative', 'HIGH',
    ['Login page loaded', 'Account lockout policy is configured'],
    ['Enter valid username', 'Enter wrong password 5 times consecutively', 'Verify account locked message on 5th attempt', 'Verify further login attempts are blocked'],
    'Account locks after 5 failed attempts with clear lockout message.'),
];

FEATURE_TESTS['Error / Loading States'] = (ctx) => [
  T('Verify loading indicators shown during data fetch',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Network throttled'],
    ['Navigate to data-heavy page', 'Observe UI before data arrives', 'Verify spinners/skeletons visible', 'Wait for data and verify replaced'],
    'Loading indicators appear during fetch, replaced by content once loaded.'),
  T('Verify user-friendly error when API returns 500',
    'Negative', 'HIGH',
    ['User is logged in', 'Backend returns 500'],
    ['Navigate to failing page', 'Verify user-friendly error (no stack trace)', 'Verify Retry button available', 'Click Retry and verify API called again'],
    'Clear error message shown with retry option. No raw error codes.'),
  T('Verify application handles network timeout gracefully',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Network configured for >30s timeout'],
    ['Trigger page load', 'Wait for timeout', 'Verify timeout message displayed', 'Verify retry available'],
    'Timeout detected, appropriate message shown, retry available.'),
];

FEATURE_TESTS['Notifications'] = (ctx) => [
  T('Verify success notification after successful action',
    'Happy Path', 'HIGH',
    ['User is logged in'],
    ['Complete a successful action', 'Verify success notification appears', 'Verify text matches action', 'Verify auto-dismiss'],
    'Success notification appears with correct text and auto-dismisses.'),
  T('Verify notification manually dismissible before timeout',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Notification is displayed'],
    ['Trigger notification', 'Click close/X before auto-dismiss', 'Verify immediately removed', 'Verify no duplicates'],
    'Notification dismissed immediately on close click.'),
];

FEATURE_TESTS['Modals / Dialogs'] = (ctx) => [
  T('Verify modal opens with correct content when triggered',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Page with modal trigger loaded'],
    ['Click trigger button', 'Verify modal overlay appears', 'Verify title and content correct', 'Verify close button visible'],
    'Modal opens with correct title, content, and action buttons.'),
  T('Verify modal closes via X button, overlay click, and Escape key',
    'Happy Path', 'MEDIUM',
    ['User is logged in', 'Modal is open'],
    ['Click X — verify closes', 'Reopen, click overlay — verify closes', 'Reopen, press Escape — verify closes'],
    'Modal dismissible via all three methods.'),
  T('Verify modal traps focus for accessibility',
    'Adhoc', 'MEDIUM',
    ['User is logged in', 'Modal is open'],
    ['Tab through modal elements', 'Verify focus stays in modal', 'Close modal', 'Verify focus returns to trigger'],
    'Focus trapped in modal. Returns to trigger on close.'),
];

FEATURE_TESTS['Permissions / Roles'] = (ctx) => [
  T('Verify admin user sees all features and navigation items',
    'Happy Path', 'HIGH',
    ['Admin user is logged in'],
    ['Verify all nav items visible', 'Navigate to admin sections', 'Verify admin features functional'],
    'Admin has full access to all features.'),
  T('Verify non-admin cannot access admin-only features',
    'Negative', 'HIGH',
    ['Regular user is logged in'],
    ['Verify admin nav items hidden', 'Attempt direct URL access to admin page', 'Verify access denied'],
    'Regular users blocked from admin features. Direct URL shows "Access Denied".'),
  T('Verify role change reflected in UI after refresh',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Backend supports dynamic roles'],
    ['Log in as regular user', 'Update role to admin via backend', 'Refresh page', 'Verify admin features appear'],
    'Role change takes effect on refresh.'),
];

FEATURE_TESTS['Financial Data'] = (ctx) => [
  T(`Verify financial data displays correct values (${ctx.items})`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns financial data'],
    ['Navigate to financial data page', 'Verify displayed values match API', 'Verify correct formatting (currency, decimals)', 'Verify labels and units correct'],
    'Financial data displayed with correct values, formatting, and labels.'),
  T('Verify positive values shown in green, negative in red',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns both positive and negative values'],
    ['Locate positive values — verify green color and up indicator', 'Locate negative values — verify red color and down indicator', 'Verify zero values display in neutral color'],
    'Positive=green+up, Negative=red+down, Zero=neutral.'),
  T('Verify financial calculations are accurate (totals, percentages, averages)',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns detailed financial data'],
    ['Navigate to financial summary', 'Manually calculate expected totals from line items', 'Compare calculated totals with displayed totals', 'Verify percentage calculations match'],
    'All financial calculations (sums, percentages, averages) are mathematically accurate.'),
  T('Verify financial data handles null/missing values gracefully',
    'Negative', 'HIGH',
    ['User is logged in', 'API returns null for some financial fields'],
    ['Navigate to financial page', 'Observe fields with missing data', 'Verify "N/A" or dash displayed', 'Verify no NaN or broken calculations'],
    'Missing financial data shows placeholder. No NaN or broken totals.'),
  T('Verify financial data precision (rounding to correct decimal places)',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Backend returns high-precision numbers'],
    ['Navigate to financial data', 'Verify amounts rounded to 2 decimal places (or per spec)', 'Verify percentages rounded correctly', 'Verify no floating-point display artifacts'],
    'Financial values rounded to correct precision with no floating-point artifacts.'),
  T('Verify financial data with extreme values (very large, very small)',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Backend returns extreme values (billions, fractions of cents)'],
    ['Navigate to financial page', 'Verify large numbers displayed with proper formatting (commas/abbreviations)', 'Verify very small numbers not displayed as 0', 'Verify no layout overflow'],
    'Extreme values displayed with proper formatting. No layout overflow.'),
];

FEATURE_TESTS['Workflow / Approval'] = (ctx) => [
  T(`Verify end-to-end workflow from creation to approval (${ctx.items})`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Workflow feature is enabled'],
    ['Create a new item/request', 'Submit for approval', 'Log in as approver', 'Review and approve', 'Verify status changes to "Approved"'],
    'Complete workflow from creation to approval works. Status updates correctly.'),
  T('Verify rejection workflow with reason',
    'Happy Path', 'HIGH',
    ['User is logged in as approver', 'Pending item exists'],
    ['Open pending item', 'Click Reject', 'Enter rejection reason', 'Submit', 'Verify status changes to "Rejected"', 'Verify requester sees rejection reason'],
    'Rejection workflow completes. Requester sees the reason.'),
  T('Verify user cannot approve their own request',
    'Negative', 'HIGH',
    ['User is logged in', 'User has a pending request'],
    ['Navigate to own pending request', 'Verify Approve button is hidden or disabled', 'Attempt direct API call to self-approve', 'Verify rejection'],
    'Self-approval blocked both in UI and API.'),
  T('Verify workflow status transitions follow defined state machine',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Item exists in various states'],
    ['Verify Draft → Submitted allowed', 'Verify Submitted → Approved allowed', 'Verify Approved → Draft NOT allowed', 'Verify Rejected → Submitted allowed (resubmit)'],
    'Only valid state transitions are permitted. Invalid transitions blocked.'),
];

FEATURE_TESTS['Reports / Export'] = (ctx) => [
  T('Verify report generates with correct data matching filter criteria',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Data exists matching report criteria'],
    ['Set report filters/parameters', 'Click Generate Report', 'Verify report data matches filter criteria', 'Verify totals and summaries are correct'],
    'Report contains only data matching criteria. Totals correct.'),
  T('Verify export to CSV/PDF produces valid downloadable file',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Report data is available'],
    ['Generate a report', 'Click Export (CSV or PDF)', 'Verify file downloads', 'Open file and verify content matches on-screen data'],
    'Export produces valid file with content matching the on-screen report.'),
  T('Verify report with no matching data shows empty state',
    'Negative', 'MEDIUM',
    ['User is logged in', 'No data matches filter criteria'],
    ['Set filters that match nothing', 'Generate report', 'Verify "No data" message', 'Verify export button disabled or exports empty file'],
    'No-data report shows clear message. No broken export.'),
];

FEATURE_TESTS['User Profile / Settings'] = (ctx) => [
  T('Verify user can update profile information successfully',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Profile settings page loaded'],
    ['Update display name', 'Update email', 'Click Save', 'Verify success message', 'Refresh and verify changes persisted'],
    'Profile updates saved and persisted after refresh.'),
  T('Verify password change requires current password and validates strength',
    'Negative', 'HIGH',
    ['User is logged in', 'Change password form loaded'],
    ['Enter wrong current password', 'Enter new password', 'Click Change', 'Verify error for wrong current password', 'Enter correct current password with weak new password', 'Verify strength validation error'],
    'Wrong current password blocked. Weak new password rejected.'),
];

FEATURE_TESTS['File Upload'] = (ctx) => [
  T('Verify valid file upload completes successfully',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Upload form is visible'],
    ['Select a valid file within size limit', 'Click Upload', 'Verify progress indicator', 'Verify success message', 'Verify file appears in file list'],
    'Valid file uploaded. Progress shown. File visible in list.'),
  T('Verify upload rejects files exceeding size limit',
    'Negative', 'HIGH',
    ['User is logged in'],
    ['Select a file exceeding the max size', 'Attempt upload', 'Verify clear error message about size limit', 'Verify no partial upload occurred'],
    'Oversized file rejected with clear message. No partial upload.'),
  T('Verify upload rejects unsupported file types',
    'Negative', 'HIGH',
    ['User is logged in'],
    ['Select a file with unsupported extension (e.g. .exe)', 'Attempt upload', 'Verify clear error about supported formats'],
    'Unsupported file type rejected with message about accepted formats.'),
];

FEATURE_TESTS['Data Validation'] = (ctx) => [
  T(`Verify all mandatory fields are enforced (${ctx.items})`,
    'Negative', 'HIGH',
    ['User is logged in', 'Form/page with required fields loaded'],
    ['Leave each mandatory field empty one at a time', 'Attempt submission', 'Verify specific error per field', 'Verify submission blocked'],
    'Each mandatory field enforced with specific inline error. Submission blocked.'),
  T('Verify field format validations (email, phone, date formats)',
    'Negative', 'HIGH',
    ['User is logged in'],
    ['Enter invalid email format', 'Enter invalid phone format', 'Enter invalid date format', 'Verify each shows format-specific error'],
    'Invalid formats show specific validation errors. No generic messages.'),
  T('Verify boundary values for numeric fields (min, max, zero)',
    'Edge Case', 'HIGH',
    ['User is logged in', 'Numeric fields with defined min/max exist'],
    ['Enter value at min boundary — verify accepted', 'Enter value at max boundary — verify accepted', 'Enter value below min — verify rejected', 'Enter value above max — verify rejected', 'Enter zero — verify behavior per spec'],
    'Boundary values at min/max accepted. Below/above rejected.'),
  T('Verify business rule validations are enforced',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Business rules are defined for the data'],
    ['Enter data that satisfies all business rules', 'Verify submission succeeds', 'Enter data that violates a business rule', 'Verify specific business rule error message'],
    'Business rules enforced with specific error messages.'),
];

FEATURE_TESTS['API Integration'] = (ctx) => [
  T('Verify API returns correct response for valid request',
    'Happy Path', 'HIGH',
    ['API endpoint is accessible', 'Valid request parameters prepared'],
    ['Send valid GET/POST request', 'Verify HTTP 200 response', 'Verify response body structure matches schema', 'Verify data values are correct'],
    'API returns 200 with correct schema and data.'),
  T('Verify API returns appropriate error for invalid request',
    'Negative', 'HIGH',
    ['API endpoint is accessible'],
    ['Send request with missing required fields', 'Verify HTTP 400 response', 'Verify error message identifies missing field', 'Send request with invalid data types', 'Verify appropriate validation error'],
    'API returns 400 with specific error for invalid requests.'),
  T('Verify API handles concurrent requests without data corruption',
    'Edge Case', 'HIGH',
    ['API endpoint is accessible', 'Test data prepared'],
    ['Send 10 concurrent requests', 'Verify all responses are correct', 'Verify no data corruption or duplicates', 'Verify response times acceptable'],
    'Concurrent requests handled correctly. No data corruption.'),
];

FEATURE_TESTS['Responsive / Mobile'] = (ctx) => [
  T('Verify layout renders correctly on mobile (375px)',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Mobile device or DevTools available'],
    ['Set viewport to 375px', 'Navigate through main pages', 'Verify no horizontal scrollbar', 'Verify text readable', 'Verify buttons tappable (min 44px)'],
    'All pages render on mobile. No overflow. Text readable. Touch targets met.'),
  T('Verify layout on tablet (768px)',
    'Happy Path', 'MEDIUM',
    ['User is logged in'],
    ['Set viewport to 768px', 'Navigate main pages', 'Verify grid adapts', 'Verify no content cutoff'],
    'Pages adapt to tablet with correct grid reflow.'),
  T('Verify touch gestures work on mobile (swipe, pinch-to-zoom)',
    'Edge Case', 'MEDIUM',
    ['User on mobile device'],
    ['Test swipe gestures on carousels/lists', 'Test pinch-to-zoom on charts/images', 'Verify gestures work smoothly'],
    'Touch gestures functional on mobile.'),
];

FEATURE_TESTS['Accessibility'] = (ctx) => [
  T('Verify WCAG 2.1 AA color contrast compliance',
    'Happy Path', 'HIGH',
    ['Pages loaded', 'Accessibility audit tool available'],
    ['Run contrast audit', 'Verify text 4.5:1 ratio', 'Verify large text 3:1 ratio'],
    'All text meets WCAG AA contrast requirements.'),
  T('Verify all interactive elements have visible focus indicators',
    'Happy Path', 'MEDIUM',
    ['Pages loaded'],
    ['Tab through elements', 'Verify focus ring on each', 'Verify logical focus order'],
    'All interactive elements show focus indicator in logical order.'),
  T('Verify screen reader announces page content correctly',
    'Adhoc', 'MEDIUM',
    ['Screen reader enabled'],
    ['Navigate with screen reader', 'Verify headings announced', 'Verify form labels read', 'Verify dynamic content announced'],
    'Screen reader correctly announces all page content and changes.'),
];

FEATURE_TESTS['Charts / Visualization'] = (ctx) => [
  T('Verify chart displays correct data matching API response',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Backend returns chart data'],
    ['Navigate to chart page', 'Verify data points match API values', 'Verify axis labels correct', 'Verify legend matches data series'],
    'Chart renders with correct data, labels, and legend.'),
  T('Verify chart tooltip shows accurate data on hover',
    'Happy Path', 'MEDIUM',
    ['User is logged in', 'Chart is rendered'],
    ['Hover over a data point', 'Verify tooltip appears', 'Verify tooltip value matches the data point', 'Move to another point and verify tooltip updates'],
    'Tooltips show accurate data for each point.'),
  T('Verify chart handles empty dataset gracefully',
    'Negative', 'MEDIUM',
    ['User is logged in', 'Backend returns empty data'],
    ['Navigate to chart', 'Verify empty state message', 'Verify no broken chart rendering'],
    'Empty data shows clear message. No broken rendering.'),
];

FEATURE_TESTS['Compliance / Regulatory'] = (ctx) => [
  T(`Verify compliance data fields are displayed correctly (${ctx.items})`,
    'Happy Path', 'HIGH',
    ['User is logged in', 'Compliance module enabled'],
    ['Navigate to compliance section', 'Verify all required compliance fields visible', 'Verify data matches regulatory requirements', 'Verify audit trail entries logged'],
    'Compliance fields displayed correctly. Audit trail logged.'),
  T('Verify regulatory validations prevent non-compliant data submission',
    'Negative', 'HIGH',
    ['User is logged in'],
    ['Enter data violating regulatory rules', 'Attempt submission', 'Verify compliance error message', 'Verify submission blocked'],
    'Non-compliant data blocked with specific regulatory error message.'),
  T('Verify audit trail captures all user actions',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Audit trail enabled'],
    ['Perform create, update, delete actions', 'Navigate to audit trail', 'Verify each action logged with user, timestamp, and details'],
    'All user actions captured in audit trail with complete metadata.'),
];

FEATURE_TESTS['Date / Time Handling'] = (ctx) => [
  T('Verify date picker allows valid date selection',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Date field is present'],
    ['Click date picker', 'Select a valid date', 'Verify date displayed in correct format', 'Submit and verify date persisted'],
    'Date picker works. Date displayed and saved in correct format.'),
  T('Verify date range validation (start must be before end)',
    'Negative', 'HIGH',
    ['User is logged in', 'Date range fields present'],
    ['Set end date before start date', 'Attempt submission', 'Verify validation error'],
    'Invalid date range blocked with specific error.'),
  T('Verify timezone handling for international users',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'User timezone differs from server'],
    ['Set user timezone', 'Verify displayed dates/times match user timezone', 'Verify stored values are in UTC'],
    'Dates displayed in user timezone. Stored in UTC.'),
];

FEATURE_TESTS['Multi-language / i18n'] = (ctx) => [
  T('Verify language switch changes all UI text',
    'Happy Path', 'HIGH',
    ['User is logged in', 'Multiple languages configured'],
    ['Switch language from settings', 'Verify all labels, buttons, messages change', 'Verify no untranslated text remains'],
    'Language switch updates all UI text. No untranslated strings.'),
  T('Verify RTL layout for Arabic/Hebrew languages',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'RTL language selected'],
    ['Switch to RTL language', 'Verify layout mirrors correctly', 'Verify text alignment is right-to-left', 'Verify no overlapping elements'],
    'RTL layout renders correctly with proper mirroring.'),
];

// ===================================================================
// 7. UNIVERSAL TESTS (always included)
// ===================================================================

const UNIVERSAL_TESTS = [
  T('Verify complete end-to-end user flow from login to primary action',
    'Happy Path', 'HIGH',
    ['Valid credentials available', 'Application accessible'],
    ['Open application', 'Log in', 'Navigate to primary feature', 'Complete main action', 'Verify success', 'Log out'],
    'Full E2E flow completes without errors.'),
  T('Verify browser back/forward navigation preserves state',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'Navigated through 3+ pages'],
    ['Navigate through 3 pages', 'Click browser back', 'Verify previous page loads correctly', 'Click forward', 'Verify return to expected page'],
    'Back/forward navigation preserves page state.'),
  T('Verify cross-browser compatibility (Chrome, Firefox, Safari)',
    'Adhoc', 'MEDIUM',
    ['Application deployed to test environment'],
    ['Test in Chrome', 'Test in Firefox', 'Test in Safari', 'Note any browser-specific differences'],
    'Application works consistently across browsers.'),
];

// ===================================================================
// 8. DEEP KEYWORD PARSER — generates per-feature contextual tests
// ===================================================================

function parseWithKeywords(text) {
  const cleaned = cleanText(text);
  const detected = detectFeatures(cleaned);
  const extracted = extractEntities(cleaned);

  console.log('──────────────────────────────────────');
  console.log('Detected Features:', detected);
  console.log('Extracted Actions:', extracted.actions.slice(0, 5));
  console.log('Extracted Conditions:', extracted.conditions.slice(0, 5));
  console.log('Extracted Validations:', extracted.validations.slice(0, 5));
  console.log('Extracted Entities:', extracted.entities.slice(0, 10));
  console.log('──────────────────────────────────────');

  let tests = [];

  // Generate contextual per-feature tests
  for (const feature of detected) {
    const generator = FEATURE_TESTS[feature];
    if (generator) {
      const ctx = { items: extractContextForFeature(feature, cleaned, extracted) };
      tests.push(...generator(ctx));
    }
  }

  // Generate tests from extracted actions/conditions/validations
  tests.push(...generateFromExtracted(extracted, cleaned));

  // Add universal tests
  tests.push(...UNIVERSAL_TESTS);

  // Deduplicate by title
  const seen = new Set();
  tests = tests.filter((t) => { if (seen.has(t.title)) return false; seen.add(t.title); return true; });

  // Sort by category order
  tests.sort((a, b) => (CATEGORY_SORT[a.category] ?? 9) - (CATEGORY_SORT[b.category] ?? 9));

  return { detectedFeatures: detected, testCases: tests, extracted };
}

/**
 * Extract context string for a feature from text & entities.
 */
function extractContextForFeature(feature, text, extracted) {
  const kw = feature.toLowerCase();
  // Find sentences mentioning this feature
  const sentences = text.split(/[.\n]/).filter(s => s.toLowerCase().includes(kw.split('/')[0].split(' ')[0]));
  if (sentences.length > 0) {
    // Extract nouns/terms from those sentences
    const terms = sentences.slice(0, 3).join('; ').slice(0, 80);
    return terms || feature;
  }
  if (extracted.entities.length > 0) return extracted.entities.slice(0, 3).join(', ');
  return feature;
}

/**
 * Generate additional tests from extracted actions, conditions, and validations.
 */
function generateFromExtracted(extracted, text) {
  const extra = [];

  // From actions
  for (const action of extracted.actions.slice(0, 8)) {
    extra.push(T(
      `Verify user can ${action}`,
      'Happy Path', 'HIGH',
      ['User is logged in', 'All preconditions for this action are met'],
      ['Navigate to the relevant page', `Perform action: ${action}`, 'Verify action completes successfully', 'Verify system state updated correctly'],
      `The action "${action}" completes successfully with correct system state update.`
    ));
  }

  // From conditions
  for (const cond of extracted.conditions.slice(0, 6)) {
    extra.push(T(
      `Verify behavior when condition is met: ${cond.slice(0, 60)}`,
      'Edge Case', 'MEDIUM',
      ['User is logged in', `Condition active: ${cond}`],
      ['Set up the condition', 'Navigate to affected feature', 'Verify the system behaves according to the condition', 'Verify the condition can be toggled'],
      `When "${cond}" the system responds correctly per specification.`
    ));
    extra.push(T(
      `Verify behavior when condition is NOT met: ${cond.slice(0, 50)}`,
      'Negative', 'MEDIUM',
      ['User is logged in', `Condition NOT met: ${cond}`],
      ['Ensure condition is NOT active', 'Navigate to affected feature', 'Verify fallback or default behavior', 'Verify no errors or broken state'],
      `When condition is not met, the system falls back to default behavior without errors.`
    ));
  }

  // From validations
  for (const val of extracted.validations.slice(0, 6)) {
    extra.push(T(
      `Verify validation rule: ${val.slice(0, 60)}`,
      'Negative', 'HIGH',
      ['User is logged in', 'Form/feature with this validation is loaded'],
      ['Enter data that violates: ' + val, 'Attempt submission', 'Verify specific validation error shown', 'Verify submission is blocked'],
      `Validation "${val}" is enforced. Violating data is rejected with a specific error message.`
    ));
  }

  return extra;
}

// ===================================================================
// 9. PUBLIC API
// ===================================================================

async function convertUserStoryToModel(text) {
  const cleaned = cleanText(text);
  console.log(`\n[textParser] Input length: ${text.length} chars → cleaned: ${cleaned.length} chars`);

  // Pre-analyse before AI or keyword fallback
  const features = detectFeatures(cleaned);
  const extracted = extractEntities(cleaned);
  console.log(`[textParser] Pre-analysis: ${features.length} features detected: ${features.join(', ')}`);
  console.log(`[textParser] Extracted: ${extracted.actions.length} actions, ${extracted.conditions.length} conditions, ${extracted.validations.length} validations, ${extracted.entities.length} entities`);

  // Try AI first (sends pre-analysis context for better results)
  try {
    const aiResult = await parseWithAI(cleaned, features, extracted);
    if (aiResult && Array.isArray(aiResult.testCases) && aiResult.testCases.length > 0) {
      console.log(`[textParser] AI extraction succeeded: ${aiResult.testCases.length} test cases`);
      const normalized = aiResult.testCases.map((tc) => ({
        title: tc.title || tc.scenario || 'Untitled test',
        category: ['Happy Path', 'Negative', 'Edge Case', 'Adhoc'].includes(tc.category) ? tc.category : 'Edge Case',
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(tc.priority) ? tc.priority : 'MEDIUM',
        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : ['User is logged in'],
        steps: Array.isArray(tc.steps) ? tc.steps : ['Execute the test scenario'],
        expected: typeof tc.expected === 'string' ? tc.expected : (tc.expectedBehavior || 'Test passes'),
        statusCode: 200,
      }));
      normalized.sort((a, b) => (CATEGORY_SORT[a.category] ?? 9) - (CATEGORY_SORT[b.category] ?? 9));
      // Merge AI-detected features with pre-detected
      const allFeatures = [...new Set([...(aiResult.detectedFeatures || []), ...features])];
      return { detectedFeatures: allFeatures, testCases: normalized, source: 'ai' };
    }
  } catch (err) {
    console.warn(`[textParser] AI parsing failed, using deep keyword extraction: ${err.message}`);
  }

  // Deep keyword-based extraction
  const result = parseWithKeywords(cleaned);
  console.log(`[textParser] Keyword extraction: ${result.detectedFeatures.length} features, ${result.testCases.length} test cases`);
  return { detectedFeatures: result.detectedFeatures, testCases: result.testCases, source: 'keywords' };
}

module.exports = { convertUserStoryToModel };
