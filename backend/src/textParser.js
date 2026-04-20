/**
 * textParser.js — Converts plain-English user stories into QA-engineer-level
 * test cases with preconditions, steps, and expected results.
 *
 * Two strategies:
 *   1. AI-powered (OpenRouter) — best quality, extracts nuanced scenarios
 *   2. Keyword-based fallback  — always works, no API key needed
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openai/gpt-3.5-turbo';

const CATEGORY_SORT = { 'Happy Path': 0, 'Negative': 1, 'Edge Case': 2, 'Adhoc': 3 };

// ---------------------------------------------------------------------------
// Helper — compact test-case builder
// ---------------------------------------------------------------------------

function T(title, category, priority, preconditions, steps, expected) {
  return { title, category, priority, preconditions, steps, expected, statusCode: 200 };
}

// ---------------------------------------------------------------------------
// AI-powered extraction
// ---------------------------------------------------------------------------

function buildParsingPrompt(text) {
  return `You are a senior QA engineer with 8+ years of experience in functional and UI testing.

Analyse the following user story / requirement and generate detailed, real-world test cases.

USER STORY:
"""
${text.slice(0, 6000)}
"""

STRICT RULES:
- Generate at least 30 test cases.
- Include these categories in this order: Happy Path, Negative, Edge Case, Adhoc.
- ALWAYS include 3-5 Happy Path scenarios covering end-to-end success flows.
- NEVER generate generic cases like "verify page loads" or "verify UI works".
- Every test case must be specific to the described feature.
- Focus on: business logic, navigation, data validation, feature flags, state transitions, error handling.
- Preconditions must be specific (e.g. "User is logged in as admin", "Feature flag X is ON").
- Steps must be numbered, step-by-step, and executable by a manual tester.
- Expected must be precise and verifiable.

Return ONLY a JSON object (no markdown, no code fences):
{
  "detectedFeatures": ["feature1", "feature2"],
  "testCases": [
    {
      "title": "specific test title",
      "category": "Happy Path" | "Negative" | "Edge Case" | "Adhoc",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "preconditions": ["precondition 1", "precondition 2"],
      "steps": ["Step 1: do X", "Step 2: do Y"],
      "expected": "precise expected outcome"
    }
  ]
}`;
}

async function parseWithAI(text) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: buildParsingPrompt(text) }],
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
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Could not parse AI response.');
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Keyword-based fallback extraction (QA-engineer quality)
// ---------------------------------------------------------------------------

const KEYWORD_RULES = [
  // ---- Navigation ----
  { pattern: /\b(navigation|nav\s*bar|left\s*nav|menu|sidebar|breadcrumb)\b/i, feature: 'Navigation', tests: [
    T('Verify end-to-end navigation flow from landing page to target section',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Application has fully loaded', 'Navigation menu is visible'],
      ['Open the application landing page', 'Locate the left navigation / sidebar menu', 'Click each navigation item sequentially', 'Verify each click navigates to the correct page', 'Verify the URL updates to match the selected section'],
      'Each navigation item routes the user to the correct page with accurate URL, page title, and content.'),
    T('Verify active navigation item is highlighted for current page',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Application navigation is rendered'],
      ['Navigate to the Home page via the menu', 'Observe the visual state of the Home menu item', 'Navigate to Reports page', 'Observe which menu item is now highlighted'],
      'The currently active page\'s navigation item shows a distinct visual state (bold, colour, underline) while other items remain in default state.'),
    T('Verify navigation menu is inaccessible when user is not authenticated',
      'Negative', 'HIGH',
      ['User is not logged in', 'Application login page is displayed'],
      ['Attempt to access a protected URL directly via the browser address bar', 'Observe the application behavior', 'Check if the navigation menu is rendered'],
      'User is redirected to the login page. Navigation menu is not visible or functional for unauthenticated users.'),
    T('Verify navigation collapses into hamburger on mobile viewport',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Browser window is resized to 375px width or mobile device is used'],
      ['Open the application on a mobile-width viewport', 'Verify the full navigation menu is hidden', 'Locate and tap the hamburger icon', 'Verify the menu expands with all items', 'Tap a menu item and verify navigation occurs'],
      'On mobile viewports, the navigation collapses into a hamburger menu. Tapping it reveals all items, and selecting one navigates correctly.'),
    T('Verify keyboard-only navigation through menu items',
      'Adhoc', 'MEDIUM',
      ['User is logged in', 'Screen reader or keyboard navigation mode is active'],
      ['Tab to the navigation menu', 'Use arrow keys to move between menu items', 'Press Enter to activate the focused item', 'Verify focus indicator is visible on each item'],
      'All menu items are reachable via Tab/arrow keys with visible focus indicators. Enter activates the focused item correctly.'),
  ]},
  // ---- Dashboard ----
  { pattern: /\b(dashboard|overview|home\s*page|landing)\b/i, feature: 'Dashboard', tests: [
    T('Verify dashboard loads with all widgets displaying correct user-specific data',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Backend APIs are returning data', 'Dashboard feature is enabled'],
      ['Navigate to the dashboard page', 'Wait for all widgets/cards to finish loading', 'Verify each widget displays data (no empty or placeholder values)', 'Cross-check displayed values against the API response'],
      'Dashboard renders all configured widgets with data matching the backend API response for the logged-in user.'),
    T('Verify dashboard data refreshes correctly on pull-to-refresh or refresh action',
      'Happy Path', 'MEDIUM',
      ['User is on the dashboard', 'Backend data has been updated since last load'],
      ['Note the current values displayed on the dashboard', 'Trigger a page refresh or pull-to-refresh action', 'Wait for the dashboard to reload', 'Verify the displayed data reflects the latest backend values'],
      'Dashboard fetches and displays the most recent data from all APIs after a refresh action.'),
    T('Verify dashboard displays graceful empty state when no data is available',
      'Negative', 'HIGH',
      ['User is logged in', 'Backend APIs return empty datasets'],
      ['Navigate to the dashboard', 'Observe each widget/card area', 'Verify no broken layouts or JavaScript errors', 'Verify a friendly empty-state message is displayed'],
      'Dashboard shows informative empty-state messages (e.g., "No data available") instead of blank spaces or errors.'),
    T('Verify dashboard shows loading skeletons while data is being fetched',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Network is throttled to simulate slow connection'],
      ['Open the dashboard page', 'Observe the UI before data arrives', 'Verify skeleton loaders or spinners are displayed in each widget area', 'Wait for data to load and verify skeletons are replaced with real content'],
      'Skeleton/shimmer loaders appear in widget placeholders during data fetch and are replaced by actual content once loaded.'),
    T('Verify dashboard layout adapts correctly across desktop, tablet, and mobile viewports',
      'Adhoc', 'MEDIUM',
      ['User is logged in', 'Dashboard has loaded successfully'],
      ['View the dashboard at 1440px width (desktop)', 'Resize to 768px (tablet) and verify grid reflows', 'Resize to 375px (mobile) and verify single-column layout', 'Verify no content is cut off or overlapping at any viewport'],
      'Dashboard grid reflows appropriately at each breakpoint with no overlapping, truncated, or hidden content.'),
  ]},
  // ---- CTA / Buttons ----
  { pattern: /\b(CTA|call[\s-]to[\s-]action|button|click|submit|action)\b/i, feature: 'CTA / Buttons', tests: [
    T('Verify primary CTA click executes the intended action successfully',
      'Happy Path', 'HIGH',
      ['User is logged in', 'All required form data or preconditions are met', 'CTA button is visible and enabled'],
      ['Locate the primary CTA button on the page', 'Click the CTA button', 'Observe the system response (modal, navigation, API call)', 'Verify a success confirmation is displayed'],
      'Clicking the CTA triggers the correct action (e.g., form submit, modal open, navigation) and a success confirmation is shown.'),
    T('Verify CTA button is disabled when required preconditions are not met',
      'Negative', 'HIGH',
      ['User is logged in', 'Required form fields are empty or invalid'],
      ['Navigate to the page containing the CTA', 'Leave required fields empty or enter invalid data', 'Observe the CTA button state', 'Attempt to click the disabled button'],
      'CTA button appears visually disabled (greyed out) and does not trigger any action when clicked.'),
    T('Verify rapid double-click on CTA does not trigger duplicate actions',
      'Edge Case', 'HIGH',
      ['User is logged in', 'CTA button is active and enabled'],
      ['Click the CTA button twice rapidly (within 200ms)', 'Monitor network requests in browser dev tools', 'Verify only one API call is made', 'Verify no duplicate records are created'],
      'System prevents duplicate submission — only one action is executed regardless of rapid clicks.'),
    T('Verify CTA button displays loading spinner during async processing',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Network speed is throttled to observe loading state'],
      ['Click the CTA button', 'Observe the button immediately after click', 'Verify a spinner/loader appears on the button', 'Verify the button is disabled during processing', 'Wait for action to complete and verify button returns to normal'],
      'CTA shows a loading spinner and becomes non-clickable during processing, then returns to its default state on completion.'),
    T('Verify CTA is activatable via keyboard (Enter and Space keys)',
      'Adhoc', 'MEDIUM',
      ['User is logged in', 'CTA button is focusable'],
      ['Tab to the CTA button', 'Verify focus ring is visible', 'Press Enter key and verify action triggers', 'Tab back to the button', 'Press Space key and verify action triggers'],
      'CTA button is accessible via keyboard — both Enter and Space keys trigger the same action as a mouse click.'),
  ]},
  // ---- Feature Flags ----
  { pattern: /\b(feature\s*flag|toggle|flag\s*on|flag\s*off|enabled|disabled|experiment)\b/i, feature: 'Feature Flags', tests: [
    T('Verify feature is fully visible and functional when feature flag is ON',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Feature flag for the target feature is set to ON/enabled'],
      ['Navigate to the page containing the flagged feature', 'Verify the feature UI element is visible', 'Interact with the feature (click, input, navigate)', 'Verify the feature behaves as specified'],
      'When the feature flag is ON, the associated feature is fully rendered, interactive, and functioning per specification.'),
    T('Verify feature is completely hidden and non-functional when flag is OFF',
      'Negative', 'HIGH',
      ['User is logged in', 'Feature flag for the target feature is set to OFF/disabled'],
      ['Navigate to the page where the feature would appear', 'Verify the feature UI element is NOT visible in the DOM', 'Verify no JavaScript errors in the console', 'Verify the rest of the page functions correctly'],
      'When the feature flag is OFF, the feature is completely absent from the UI with no residual errors or broken layout.'),
    T('Verify system handles missing or undefined feature flag configuration',
      'Edge Case', 'HIGH',
      ['User is logged in', 'Feature flag configuration is deleted or returns undefined from the backend'],
      ['Navigate to the page containing the flagged feature', 'Observe the application behavior', 'Check browser console for errors', 'Verify the page does not crash or show a blank screen'],
      'When flag configuration is missing, the system falls back to a safe default (feature hidden) without crashes or console errors.'),
    T('Verify multiple feature flags in different states on the same page',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Flag A is ON, Flag B is OFF, Flag C is ON'],
      ['Navigate to a page with multiple flagged features', 'Verify Feature A is visible and functional', 'Verify Feature B is hidden', 'Verify Feature C is visible and functional', 'Verify no layout issues from mixed visibility'],
      'Each feature independently respects its own flag state. Mixed ON/OFF flags do not cause layout shifts or errors.'),
  ]},
  // ---- Cards / Tiles ----
  { pattern: /\b(card|tile|widget|panel|module)\b/i, feature: 'Cards / Tiles', tests: [
    T('Verify all summary cards display correct data matching API response',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Backend APIs return valid data', 'Dashboard/page with cards is loaded'],
      ['Navigate to the page with summary cards', 'For each card, note the displayed value', 'Compare displayed values against the API response', 'Verify labels, values, and units are correct'],
      'All summary cards show accurate data (labels, values, trends) that match the backend API response exactly.'),
    T('Verify card click navigates to the correct detail view',
      'Happy Path', 'MEDIUM',
      ['User is logged in', 'Cards are rendered with data'],
      ['Click on a summary card', 'Verify navigation occurs to the detail page', 'Verify the detail page shows data specific to the clicked card', 'Verify the back button returns to the cards page'],
      'Clicking a card navigates to its associated detail view with contextually correct data. Back navigation works.'),
    T('Verify cards render fallback state when data is null or missing',
      'Negative', 'HIGH',
      ['User is logged in', 'API returns null/empty for one or more card data fields'],
      ['Navigate to the cards page', 'Observe cards where data is missing', 'Verify "N/A" or dash is displayed instead of blank', 'Verify no layout breakage from missing data'],
      'Cards with missing data display a dash or "N/A" placeholder and maintain proper alignment and styling.'),
    T('Verify card grid layout with an odd number of cards',
      'Edge Case', 'LOW',
      ['User is logged in', 'Backend returns an odd number of data items (e.g., 3 or 5)'],
      ['Navigate to the cards page', 'Count visible cards', 'Verify the last row does not have awkward alignment', 'Verify all cards maintain consistent sizing'],
      'Card grid handles odd-count rows gracefully without stretching or misaligning the last card.'),
  ]},
  // ---- Forms / Inputs ----
  { pattern: /\b(form|input|text\s*field|dropdown|select|checkbox|radio|field)\b/i, feature: 'Forms / Inputs', tests: [
    T('Verify form submission with all valid fields completes successfully',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Form page is loaded', 'All required field constraints are known'],
      ['Fill in all required fields with valid data', 'Fill in optional fields with valid data', 'Click the Submit button', 'Verify success message or redirect is shown', 'Verify data is persisted (check API or database)'],
      'Form submits successfully with all valid data. A success confirmation is displayed and data is correctly persisted.'),
    T('Verify form shows validation errors for each empty required field on submit',
      'Negative', 'HIGH',
      ['User is logged in', 'Form page is loaded'],
      ['Leave all required fields empty', 'Click the Submit button', 'Verify inline error messages appear next to each required field', 'Verify the form is NOT submitted', 'Verify the error messages are descriptive (not generic)'],
      'Each required field shows a specific inline error message. The form does not submit. No API call is made.'),
    T('Verify form retains user input after a failed server-side submission',
      'Edge Case', 'HIGH',
      ['User is logged in', 'Backend is configured to return a 500 error'],
      ['Fill in all form fields with valid data', 'Submit the form', 'Observe the error message from the server', 'Verify all previously entered data is still present in the form fields'],
      'User input is preserved after a server error, allowing the user to retry without re-entering data.'),
    T('Verify form field max-length constraints are enforced client-side',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Form has fields with defined max-length'],
      ['Attempt to type more characters than the max-length limit', 'Verify input is truncated or blocked at the limit', 'Submit the form with max-length values', 'Verify submission succeeds'],
      'Client-side enforcement prevents exceeding max-length. Data at exact max-length boundary is accepted by the server.'),
  ]},
  // ---- Search / Filter ----
  { pattern: /\b(search|filter|find|query|look\s*up)\b/i, feature: 'Search / Filter', tests: [
    T('Verify search returns accurate results matching the query',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Data set contains known searchable entries'],
      ['Enter a known search term in the search field', 'Press Enter or click the search icon', 'Verify results contain only items matching the search term', 'Verify result count matches expected number'],
      'Search returns all and only matching results. Result count is accurate and items are relevant to the query.'),
    T('Verify search with no matching results shows empty state',
      'Negative', 'MEDIUM',
      ['User is logged in', 'Data set does not contain the search term'],
      ['Enter a non-existent search term (e.g., "zzz_no_match_999")', 'Execute the search', 'Verify a "No results found" message is displayed', 'Verify the message suggests trying a different query'],
      'System displays a user-friendly "No results found" message with guidance, not a blank page or error.'),
    T('Verify search handles special characters without errors',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Search field is visible'],
      ['Enter special characters: <script>alert(1)</script>', 'Execute the search', 'Verify no XSS is triggered', 'Verify the search returns safely (empty results or escaped display)'],
      'Special characters are safely handled — no XSS execution, no server errors, and results display correctly.'),
  ]},
  // ---- Tables / Lists ----
  { pattern: /\b(table|list|grid|rows|columns|pagination|sort)\b/i, feature: 'Table / List', tests: [
    T('Verify table renders all columns with correct headers and data',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Backend returns a dataset with multiple rows'],
      ['Navigate to the table/list page', 'Verify all expected column headers are displayed', 'Verify data rows populate with correct values from the API', 'Verify row count matches the API response for the current page'],
      'Table displays all expected columns with correct headers and data matching the API response exactly.'),
    T('Verify table pagination navigates between pages correctly',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Dataset has more rows than the per-page limit'],
      ['Verify page 1 shows the first set of rows', 'Click "Next" or page 2', 'Verify new rows are displayed (different from page 1)', 'Click "Previous" to return to page 1', 'Verify original rows are shown again'],
      'Pagination navigates correctly between pages, displaying the correct subset of data for each page.'),
    T('Verify table displays empty state when dataset is empty',
      'Negative', 'MEDIUM',
      ['User is logged in', 'Backend returns an empty array'],
      ['Navigate to the table page', 'Verify the table header is still visible', 'Verify a "No data available" message is shown', 'Verify no JavaScript errors in the console'],
      'Empty dataset shows a friendly "No data" message with intact table header. No errors or broken layout.'),
    T('Verify table handles large dataset (1000+ rows) without performance degradation',
      'Edge Case', 'LOW',
      ['User is logged in', 'Backend returns 1000+ rows'],
      ['Navigate to the table page', 'Measure page load time', 'Scroll through the data', 'Verify no freezing, lag, or browser memory warnings'],
      'Table handles large datasets with acceptable performance — virtual scrolling or pagination prevents UI freeze.'),
  ]},
  // ---- Authentication ----
  { pattern: /\b(login|logout|auth|sign[\s-]?in|sign[\s-]?out|session|token|password|credential)\b/i, feature: 'Authentication', tests: [
    T('Verify successful login with valid credentials redirects to the dashboard',
      'Happy Path', 'HIGH',
      ['Application login page is loaded', 'Valid user credentials are available'],
      ['Enter a valid username/email', 'Enter the correct password', 'Click the "Sign In" button', 'Verify a session token/cookie is set', 'Verify the user is redirected to the dashboard'],
      'User logs in successfully, a session token is created, and the user is redirected to the main dashboard.'),
    T('Verify login with incorrect password shows specific error message',
      'Negative', 'HIGH',
      ['Application login page is loaded'],
      ['Enter a valid username/email', 'Enter an incorrect password', 'Click the "Sign In" button', 'Verify a "Invalid credentials" error message is shown', 'Verify the user remains on the login page'],
      'Login fails with an appropriate error message. No sensitive information (e.g., "user exists") is leaked.'),
    T('Verify session expiration redirects user to login page',
      'Edge Case', 'HIGH',
      ['User is logged in', 'Session timeout is configured (e.g., 30 minutes)'],
      ['Wait for the session to expire (or manually invalidate the token)', 'Attempt to interact with the application', 'Verify the user is redirected to the login page', 'Verify a "Session expired" message is shown'],
      'Expired session redirects the user to login with a clear "session expired" message. No data loss occurs.'),
  ]},
  // ---- Error / Loading States ----
  { pattern: /\b(error|loading|spinner|skeleton|timeout|retry|fail)\b/i, feature: 'Error / Loading States', tests: [
    T('Verify loading indicators are shown while data is being fetched',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Network is throttled to simulate delay'],
      ['Navigate to a data-heavy page', 'Observe the UI before data arrives', 'Verify spinners or skeleton loaders are visible in each data region', 'Wait for data to load and verify loaders are replaced with content'],
      'Loading indicators (spinner/skeleton) appear during data fetch and are replaced by real content once loaded. No blank screens.'),
    T('Verify user-friendly error message when backend API returns 500',
      'Negative', 'HIGH',
      ['User is logged in', 'Backend is configured to return 500 Internal Server Error'],
      ['Navigate to a page that calls the failing API', 'Verify a user-friendly error message is displayed (not a stack trace)', 'Verify a "Retry" button is available', 'Click "Retry" and verify the API is called again'],
      'A clear, non-technical error message is shown with a retry option. No raw error codes or stack traces are displayed.'),
    T('Verify application behavior during network timeout',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Network is configured to simulate timeout (>30s delay)'],
      ['Trigger a page load or action that calls the API', 'Wait for the timeout threshold', 'Verify a timeout-specific message is displayed', 'Verify the user can retry the action'],
      'Application detects timeout, shows an appropriate message, and provides a way to retry the action.'),
  ]},
  // ---- Notifications / Alerts ----
  { pattern: /\b(notification|alert|toast|banner|message|snackbar)\b/i, feature: 'Notifications', tests: [
    T('Verify success notification appears after a successful action',
      'Happy Path', 'HIGH',
      ['User is logged in', 'User performs an action that triggers a notification'],
      ['Complete a successful action (e.g., form submit, save)', 'Verify a success notification/toast appears', 'Verify the notification text matches the completed action', 'Wait and verify it auto-dismisses after the configured duration'],
      'A success notification appears with correct text, styled in green/success theme, and auto-dismisses.'),
    T('Verify notification can be manually dismissed before auto-timeout',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'A notification is currently displayed'],
      ['Trigger an action that shows a notification', 'Before auto-dismiss, click the close/X button on the notification', 'Verify the notification is immediately removed', 'Verify no duplicate notifications appear'],
      'Notification is immediately dismissed when the close button is clicked, before the auto-timeout.'),
  ]},
  // ---- Modals / Dialogs ----
  { pattern: /\b(modal|dialog|popup|overlay|lightbox|confirm)\b/i, feature: 'Modals / Dialogs', tests: [
    T('Verify modal opens with correct content when triggered',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Page with modal trigger is loaded'],
      ['Click the button/link that triggers the modal', 'Verify the modal overlay appears', 'Verify modal title and content match the expected values', 'Verify the close button (X) is visible'],
      'Modal opens with the correct title, content, and action buttons. A semi-transparent overlay covers the background.'),
    T('Verify modal closes on overlay click, X button, and Escape key',
      'Happy Path', 'MEDIUM',
      ['User is logged in', 'Modal is currently open'],
      ['Click the X button — verify modal closes', 'Reopen the modal', 'Click the overlay/backdrop — verify modal closes', 'Reopen the modal', 'Press the Escape key — verify modal closes'],
      'Modal is dismissible via all three methods: X button, overlay click, and Escape key.'),
    T('Verify modal traps keyboard focus for accessibility',
      'Adhoc', 'MEDIUM',
      ['User is logged in', 'Modal is currently open'],
      ['Press Tab key repeatedly within the modal', 'Verify focus cycles through modal elements only', 'Verify focus does not escape to background page elements', 'Close the modal and verify focus returns to the trigger element'],
      'Focus remains trapped inside the modal while it is open. Upon closing, focus returns to the element that opened it.'),
  ]},
  // ---- Permissions / Roles ----
  { pattern: /\b(permission|role|admin|user\s*role|access\s*control|rbac|authorization)\b/i, feature: 'Permissions / Roles', tests: [
    T('Verify admin user sees all navigation items and features',
      'Happy Path', 'HIGH',
      ['Admin user is logged in', 'All feature flags are enabled'],
      ['Log in as an admin user', 'Verify all navigation items are visible', 'Navigate to admin-only sections', 'Verify admin features are functional'],
      'Admin user has full access to all navigation items, pages, and admin-specific features.'),
    T('Verify non-admin user cannot access admin-only features',
      'Negative', 'HIGH',
      ['Regular (non-admin) user is logged in'],
      ['Log in as a regular user', 'Verify admin-only navigation items are hidden', 'Attempt to access an admin URL directly via the address bar', 'Verify access is denied with an appropriate message'],
      'Regular users cannot see or access admin features. Direct URL access shows an "Access Denied" or redirects to an allowed page.'),
    T('Verify role change is reflected in UI without requiring re-login',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Backend supports dynamic role updates'],
      ['Log in as a regular user', 'Update the user role to admin via backend/API', 'Refresh the page or wait for session update', 'Verify admin features now appear'],
      'Role change takes effect dynamically (on refresh or session update) without requiring the user to log out and back in.'),
  ]},
  // ---- Gain/Loss / Financial Data ----
  { pattern: /\b(gain|loss|profit|revenue|amount|price|cost|balance|percentage|growth|decline)\b/i, feature: 'Financial Data Display', tests: [
    T('Verify positive gain/profit values are displayed in green with up arrow',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Backend returns positive financial values'],
      ['Navigate to the page displaying financial data', 'Locate values representing gains/profit', 'Verify positive values are displayed in green colour', 'Verify an up-arrow or "+" indicator accompanies the value'],
      'Positive financial values (gains/profit) are colour-coded green with an upward indicator, matching the design system.'),
    T('Verify negative loss values are displayed in red with down arrow',
      'Happy Path', 'HIGH',
      ['User is logged in', 'Backend returns negative financial values'],
      ['Navigate to the page displaying financial data', 'Locate values representing losses', 'Verify negative values are displayed in red colour', 'Verify a down-arrow or "-" indicator accompanies the value'],
      'Negative financial values (losses) are colour-coded red with a downward indicator, clearly distinguishable from gains.'),
    T('Verify zero-value financial data displays correctly without colour coding',
      'Edge Case', 'MEDIUM',
      ['User is logged in', 'Backend returns zero for a financial metric'],
      ['Navigate to the financial data page', 'Locate the metric with zero value', 'Verify it displays "0" or "$0.00"', 'Verify no colour (green/red) is applied'],
      'Zero values display in neutral/default colour without gain or loss indicators.'),
  ]},
];

// ---- Universal tests (always included) ----
const UNIVERSAL_TESTS = [
  T('Verify complete end-to-end user flow from login to primary action completion',
    'Happy Path', 'HIGH',
    ['Valid user credentials are available', 'Application is accessible'],
    ['Open the application URL', 'Log in with valid credentials', 'Navigate to the primary feature page', 'Complete the main user action', 'Verify success confirmation', 'Log out and verify session is terminated'],
    'Full end-to-end flow completes without errors — from login through primary action to logout.'),
  T('Verify application handles browser back/forward navigation correctly',
    'Edge Case', 'MEDIUM',
    ['User is logged in', 'User has navigated through multiple pages'],
    ['Navigate through at least 3 pages', 'Click the browser back button', 'Verify the previous page loads with correct state', 'Click the browser forward button', 'Verify navigation returns to the expected page'],
    'Browser back/forward navigation preserves page state and navigates correctly through the history stack.'),
  T('Verify responsive layout renders correctly on mobile (375px) viewport',
    'Adhoc', 'MEDIUM',
    ['User is logged in', 'Browser DevTools or mobile device is available'],
    ['Set viewport width to 375px', 'Navigate through the main pages', 'Verify no horizontal scrollbar appears', 'Verify text is readable without zooming', 'Verify buttons are tappable (min 44px touch target)'],
    'All pages render correctly on mobile viewport — no horizontal overflow, text is readable, and interactive elements meet minimum touch target size.'),
  T('Verify responsive layout renders correctly on tablet (768px) viewport',
    'Adhoc', 'MEDIUM',
    ['User is logged in', 'Browser DevTools or tablet device is available'],
    ['Set viewport width to 768px', 'Navigate through the main pages', 'Verify grid/layout adapts to tablet width', 'Verify no content is cut off or overlapping'],
    'All pages adapt to tablet viewport with correct grid reflow and no content clipping.'),
  T('Verify colour contrast meets WCAG 2.1 AA accessibility standard',
    'Adhoc', 'MEDIUM',
    ['Application pages are loaded', 'Accessibility audit tool is available (Lighthouse, axe)'],
    ['Run an accessibility audit on the main pages', 'Check text-to-background contrast ratios', 'Verify all text meets minimum 4.5:1 ratio', 'Verify large text meets minimum 3:1 ratio'],
    'All text elements meet WCAG 2.1 AA contrast requirements — 4.5:1 for normal text and 3:1 for large text.'),
  T('Verify cross-browser compatibility on Chrome, Firefox, and Safari',
    'Adhoc', 'MEDIUM',
    ['Application is deployed to a test environment'],
    ['Open the application in Chrome and verify layout and functionality', 'Repeat in Firefox — verify consistency', 'Repeat in Safari — verify consistency', 'Note any browser-specific rendering differences'],
    'Application renders and functions consistently across Chrome, Firefox, and Safari with no browser-specific bugs.'),
  T('Verify all interactive elements have visible focus indicators for keyboard users',
    'Adhoc', 'LOW',
    ['Application pages are loaded'],
    ['Tab through all interactive elements on the page', 'Verify each button, link, and input shows a visible focus ring', 'Verify focus order follows a logical reading order'],
    'All interactive elements show a visible focus indicator and the focus order is logical and sequential.'),
];

function parseWithKeywords(text) {
  const lower = text.toLowerCase();
  const detectedFeatures = [];
  let tests = [];

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(lower)) {
      detectedFeatures.push(rule.feature);
      tests.push(...rule.tests);
    }
  }

  tests.push(...UNIVERSAL_TESTS);

  // Deduplicate by title
  const seen = new Set();
  tests = tests.filter((t) => {
    if (seen.has(t.title)) return false;
    seen.add(t.title);
    return true;
  });

  // Sort by category order
  tests.sort((a, b) => (CATEGORY_SORT[a.category] ?? 9) - (CATEGORY_SORT[b.category] ?? 9));

  return { detectedFeatures, testCases: tests };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function convertUserStoryToModel(text) {
  console.log('User Story mode enabled');

  // Try AI first
  try {
    const aiResult = await parseWithAI(text);
    if (aiResult && Array.isArray(aiResult.testCases) && aiResult.testCases.length > 0) {
      console.log(`AI extraction succeeded: ${aiResult.testCases.length} scenarios`);
      // Normalize AI results to our format
      const normalized = aiResult.testCases.map((tc) => ({
        title: tc.title || tc.scenario || 'Untitled test',
        category: ['Happy Path', 'Negative', 'Edge Case', 'Adhoc'].includes(tc.category) ? tc.category : 'Edge Case',
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(tc.priority) ? tc.priority : 'MEDIUM',
        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : ['User is logged in'],
        steps: Array.isArray(tc.steps) ? tc.steps : ['Execute the test scenario'],
        expected: typeof tc.expected === 'string' ? tc.expected : (tc.expectedBehavior || 'Test passes successfully'),
        statusCode: 200,
      }));
      normalized.sort((a, b) => (CATEGORY_SORT[a.category] ?? 9) - (CATEGORY_SORT[b.category] ?? 9));
      return {
        detectedFeatures: aiResult.detectedFeatures || [],
        testCases: normalized,
        source: 'ai',
      };
    }
  } catch (err) {
    console.warn('AI parsing failed, using rule-based extraction:', err.message);
  }

  // Fallback to keyword-based
  const result = parseWithKeywords(text);
  console.log(`Keyword extraction: ${result.detectedFeatures.length} features, ${result.testCases.length} test cases`);
  return { ...result, source: 'keywords' };
}

module.exports = { convertUserStoryToModel };
