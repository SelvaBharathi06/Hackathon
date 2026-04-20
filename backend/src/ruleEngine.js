/**
 * Rule Engine — generates structured test cases across 5 categories.
 *
 * Input shape:
 * {
 *   endpoint: "/users",
 *   method: "POST",
 *   fields: { email: "string", age: "number" }
 * }
 *
 * Each test case:
 * { id, scenario, input, expected, priority, category }
 */

let nextId = 1;

function makeCase(scenario, input, expected, priority, category) {
  return { id: nextId++, scenario, input, expected, priority, category };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SAMPLES = {
  string: {
    _default: 'valid_string',
    email: 'user@example.com',
    name: 'John Doe',
    username: 'john_doe',
    phone: '+1-555-123-4567',
    url: 'https://example.com',
    password: 'P@ssw0rd!Secure1',
    address: '123 Main St',
  },
  number: {
    _default: 25,
    age: 30,
    price: 19.99,
    quantity: 5,
    id: 1,
  },
  boolean: { _default: true },
  array: { _default: [1, 2, 3] },
  object: { _default: { key: 'value' } },
};

function validValueFor(name, type) {
  const bucket = VALID_SAMPLES[type] || VALID_SAMPLES.string;
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(bucket)) {
    if (key !== '_default' && lowerName.includes(key)) return bucket[key];
  }
  return bucket._default;
}

function buildValidBody(fields) {
  const body = {};
  for (const [name, type] of Object.entries(fields)) {
    body[name] = validValueFor(name, type);
  }
  return body;
}

function isEmailField(name) {
  return /email|e_mail|mail/i.test(name);
}

function isUrlField(name) {
  return /url|link|website|homepage/i.test(name);
}

function isPhoneField(name) {
  return /phone|mobile|tel/i.test(name);
}

// ---------------------------------------------------------------------------
// 1. Happy Path — valid inputs for all fields
// ---------------------------------------------------------------------------

function generateHappyTests(endpoint, method, fields) {
  const cases = [];
  const validBody = buildValidBody(fields);

  cases.push(
    makeCase(
      `${method} ${endpoint} with all valid fields`,
      { endpoint, method, body: validBody },
      { status: 200, message: 'Success' },
      'high',
      'happy'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} returns correct content-type`,
      { endpoint, method, body: validBody, headers: { Accept: 'application/json' } },
      { status: 200, contentType: 'application/json' },
      'high',
      'happy'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with valid Authorization header`,
      { endpoint, method, body: validBody, headers: { Authorization: 'Bearer valid_token_123' } },
      { status: 200, message: 'Authenticated request succeeds' },
      'high',
      'happy'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} response contains created resource`,
      { endpoint, method, body: validBody },
      { status: 201, bodyContains: Object.keys(fields) },
      'medium',
      'happy'
    )
  );

  // Per-field valid variations
  for (const [name, type] of Object.entries(fields)) {
    if (type === 'string' && isEmailField(name)) {
      cases.push(
        makeCase(
          `${method} ${endpoint} with valid email format in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'jane.doe+tag@company.co.uk' } },
          { status: 200, message: `Valid email in "${name}" accepted` },
          'high',
          'happy'
        )
      );
    }
    if (type === 'number') {
      cases.push(
        makeCase(
          `${method} ${endpoint} with typical valid number for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 42 } },
          { status: 200, message: `Typical number for "${name}" accepted` },
          'medium',
          'happy'
        )
      );
    }
  }

  cases.push(
    makeCase(
      `${method} ${endpoint} with extra optional headers ignored`,
      {
        endpoint,
        method,
        body: validBody,
        headers: { 'X-Request-Id': 'abc-123', 'Accept-Language': 'en-US' },
      },
      { status: 200, message: 'Extra headers are tolerated' },
      'low',
      'happy'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} response time is acceptable`,
      { endpoint, method, body: validBody },
      { status: 200, maxResponseTimeMs: 2000 },
      'medium',
      'happy'
    )
  );

  return cases;
}

// ---------------------------------------------------------------------------
// 2. Negative — missing fields, invalid formats, wrong types
// ---------------------------------------------------------------------------

function generateNegativeTests(endpoint, method, fields) {
  const cases = [];
  const validBody = buildValidBody(fields);
  const fieldEntries = Object.entries(fields);

  // 2a. Missing each required field
  for (const [name] of fieldEntries) {
    const body = { ...validBody };
    delete body[name];
    cases.push(
      makeCase(
        `${method} ${endpoint} missing required field "${name}"`,
        { endpoint, method, body },
        { status: 400, error: `"${name}" is required` },
        'high',
        'negative'
      )
    );
  }

  // 2b. Null value for each field
  for (const [name] of fieldEntries) {
    cases.push(
      makeCase(
        `${method} ${endpoint} with null value for "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: null } },
        { status: 400, error: `"${name}" must not be null` },
        'high',
        'negative'
      )
    );
  }

  // 2c. Undefined value for each field
  for (const [name] of fieldEntries) {
    cases.push(
      makeCase(
        `${method} ${endpoint} with undefined value for "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: undefined } },
        { status: 400, error: `"${name}" is required` },
        'high',
        'negative'
      )
    );
  }

  // 2d. Wrong type for each field
  for (const [name, type] of fieldEntries) {
    const wrongValue = type === 'number' ? 'not_a_number' : 99999;
    cases.push(
      makeCase(
        `${method} ${endpoint} with wrong type for "${name}" (expected ${type})`,
        { endpoint, method, body: { ...validBody, [name]: wrongValue } },
        { status: 400, error: `"${name}" must be of type ${type}` },
        'high',
        'negative'
      )
    );
  }

  // 2e. Invalid format tests (field-name aware)
  for (const [name, type] of fieldEntries) {
    if (type === 'string' && isEmailField(name)) {
      const badEmails = [
        { val: 'plaintext',       label: 'missing @ symbol' },
        { val: '@no-local.com',   label: 'missing local part' },
        { val: 'user@',           label: 'missing domain' },
        { val: 'user@.com',       label: 'domain starts with dot' },
        { val: 'user@domain..com', label: 'consecutive dots in domain' },
        { val: 'user space@x.com', label: 'space in local part' },
      ];
      for (const { val, label } of badEmails) {
        cases.push(
          makeCase(
            `${method} ${endpoint} with invalid email "${name}" — ${label}`,
            { endpoint, method, body: { ...validBody, [name]: val } },
            { status: 400, error: `"${name}" must be a valid email` },
            'high',
            'negative'
          )
        );
      }
    }

    if (type === 'string' && isUrlField(name)) {
      cases.push(
        makeCase(
          `${method} ${endpoint} with invalid URL in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'not-a-url' } },
          { status: 400, error: `"${name}" must be a valid URL` },
          'high',
          'negative'
        )
      );
    }

    if (type === 'string' && isPhoneField(name)) {
      cases.push(
        makeCase(
          `${method} ${endpoint} with invalid phone in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'abc-def' } },
          { status: 400, error: `"${name}" must be a valid phone number` },
          'high',
          'negative'
        )
      );
    }
  }

  // 2f. Empty / null / malformed body
  cases.push(
    makeCase(
      `${method} ${endpoint} with empty request body`,
      { endpoint, method, body: {} },
      { status: 400, error: 'Request body is required' },
      'high',
      'negative'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with null request body`,
      { endpoint, method, body: null },
      { status: 400, error: 'Request body is required' },
      'high',
      'negative'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with malformed JSON body`,
      { endpoint, method, rawBody: '{invalid json' },
      { status: 400, error: 'Invalid JSON' },
      'high',
      'negative'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with array body instead of object`,
      { endpoint, method, body: [validBody] },
      { status: 400, error: 'Request body must be a JSON object' },
      'medium',
      'negative'
    )
  );

  // 2g. Wrong HTTP method
  const wrongMethod = method === 'GET' ? 'DELETE' : 'GET';
  cases.push(
    makeCase(
      `${wrongMethod} ${endpoint} instead of ${method}`,
      { endpoint, method: wrongMethod, body: validBody },
      { status: 405, error: 'Method not allowed' },
      'medium',
      'negative'
    )
  );

  // 2h. Wrong content-type
  cases.push(
    makeCase(
      `${method} ${endpoint} with wrong content-type`,
      { endpoint, method, body: validBody, headers: { 'Content-Type': 'text/plain' } },
      { status: 415, error: 'Unsupported media type' },
      'medium',
      'negative'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with XML content-type`,
      { endpoint, method, body: validBody, headers: { 'Content-Type': 'application/xml' } },
      { status: 415, error: 'Unsupported media type' },
      'medium',
      'negative'
    )
  );

  return cases;
}

// ---------------------------------------------------------------------------
// 3. Boundary — empty values, max-length strings, min/max numbers
// ---------------------------------------------------------------------------

function generateBoundaryTests(endpoint, method, fields) {
  const cases = [];
  const validBody = buildValidBody(fields);

  for (const [name, type] of Object.entries(fields)) {
    if (type === 'string') {
      cases.push(
        makeCase(
          `${method} ${endpoint} with empty string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '' } },
          { status: 400, error: `"${name}" must not be empty` },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with single character for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'a' } },
          { status: 200, message: 'Min-length string accepted' },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 2-char string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'ab' } },
          { status: 200, message: 'Min-length + 1 accepted' },
          'low',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 255-char string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'a'.repeat(255) } },
          { status: 200, message: 'Max-length string accepted' },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 256-char string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'a'.repeat(256) } },
          { status: 400, error: `"${name}" exceeds maximum length` },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 1000-char string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'x'.repeat(1000) } },
          { status: 400, error: `"${name}" exceeds maximum length` },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 10000-char string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'x'.repeat(10000) } },
          { status: 400, error: `"${name}" exceeds maximum length` },
          'low',
          'boundary'
        )
      );
    }

    if (type === 'number') {
      cases.push(
        makeCase(
          `${method} ${endpoint} with 0 for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 0 } },
          { status: 200, message: 'Zero accepted' },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 1 for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 1 } },
          { status: 200, message: 'Min positive integer accepted' },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with -1 for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: -1 } },
          { status: 400, error: `"${name}" must be non-negative` },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 0.01 for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 0.01 } },
          { status: 200, message: 'Small decimal accepted' },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 2147483647 (INT_MAX) for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 2147483647 } },
          { status: 200, message: 'INT_MAX accepted' },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with 2147483648 (INT_MAX+1) for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 2147483648 } },
          { status: 400, error: `"${name}" exceeds maximum value` },
          'high',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with -2147483648 (INT_MIN) for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: -2147483648 } },
          { status: 400, error: `"${name}" below minimum value` },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with MAX_SAFE_INTEGER for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: Number.MAX_SAFE_INTEGER } },
          { status: 400, error: `"${name}" exceeds maximum value` },
          'medium',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with MIN_SAFE_INTEGER for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: Number.MIN_SAFE_INTEGER } },
          { status: 400, error: `"${name}" below minimum value` },
          'low',
          'boundary'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with very large decimal 99999.99 for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 99999.99 } },
          { status: 200, message: 'Large decimal accepted' },
          'low',
          'boundary'
        )
      );
    }
  }

  return cases;
}

// ---------------------------------------------------------------------------
// 4. Edge — special characters, unicode values
// ---------------------------------------------------------------------------

function generateEdgeTests(endpoint, method, fields) {
  const cases = [];
  const validBody = buildValidBody(fields);

  for (const [name, type] of Object.entries(fields)) {
    if (type === 'string') {
      // Special characters
      cases.push(
        makeCase(
          `${method} ${endpoint} with special chars for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '!@#$%^&*()_+-=[]{}|;:,.<>?' } },
          { status: 200, message: 'Special characters handled' },
          'high',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with backslashes in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'path\\to\\file' } },
          { status: 200, message: 'Backslashes handled' },
          'medium',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with quotes in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'He said "hello" and it\'s fine' } },
          { status: 200, message: 'Quotes handled' },
          'medium',
          'edge'
        )
      );

      // Unicode values
      cases.push(
        makeCase(
          `${method} ${endpoint} with CJK unicode in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '日本語テスト中文' } },
          { status: 200, message: 'CJK characters handled' },
          'medium',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with emoji in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '🚀💡🎉🔥👍' } },
          { status: 200, message: 'Emoji handled' },
          'medium',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with RTL characters in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'مرحبا بالعالم' } },
          { status: 200, message: 'RTL characters handled' },
          'low',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with zero-width chars in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'test\u200B\u200Cvalue' } },
          { status: 400, error: `"${name}" contains invisible characters` },
          'high',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with null byte in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'before\u0000after' } },
          { status: 400, error: `"${name}" contains invalid characters` },
          'high',
          'edge'
        )
      );

      // Whitespace variants
      cases.push(
        makeCase(
          `${method} ${endpoint} with whitespace-only "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '   ' } },
          { status: 400, error: `"${name}" must not be blank` },
          'high',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with leading/trailing spaces in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '  value  ' } },
          { status: 200, message: 'Trimmed value accepted' },
          'low',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with newline in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'line1\nline2' } },
          { status: 400, error: `"${name}" contains invalid characters` },
          'medium',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with tab in "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 'before\tafter' } },
          { status: 400, error: `"${name}" contains invalid characters` },
          'low',
          'edge'
        )
      );
    }

    if (type === 'number') {
      cases.push(
        makeCase(
          `${method} ${endpoint} with NaN for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: NaN } },
          { status: 400, error: `"${name}" must be a valid number` },
          'high',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with Infinity for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: Infinity } },
          { status: 400, error: `"${name}" must be a finite number` },
          'high',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with -Infinity for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: -Infinity } },
          { status: 400, error: `"${name}" must be a finite number` },
          'medium',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with very small decimal for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: 0.000001 } },
          { status: 200, message: 'Very small decimal accepted' },
          'low',
          'edge'
        )
      );

      cases.push(
        makeCase(
          `${method} ${endpoint} with numeric string for "${name}"`,
          { endpoint, method, body: { ...validBody, [name]: '42' } },
          { status: 400, error: `"${name}" must be of type number` },
          'medium',
          'edge'
        )
      );
    }

    // Type coercion tests (all field types)
    cases.push(
      makeCase(
        `${method} ${endpoint} with boolean for "${name}" (expected ${type})`,
        { endpoint, method, body: { ...validBody, [name]: true } },
        { status: 400, error: `"${name}" must be of type ${type}` },
        'medium',
        'edge'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} with array for "${name}" (expected ${type})`,
        { endpoint, method, body: { ...validBody, [name]: [1, 2, 3] } },
        { status: 400, error: `"${name}" must be of type ${type}` },
        'medium',
        'edge'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} with nested object for "${name}" (expected ${type})`,
        { endpoint, method, body: { ...validBody, [name]: { nested: 'value' } } },
        { status: 400, error: `"${name}" must be of type ${type}` },
        'medium',
        'edge'
      )
    );
  }

  // Body-level edge cases
  cases.push(
    makeCase(
      `${method} ${endpoint} with duplicate keys in body`,
      { endpoint, method, rawBody: `{"${Object.keys(fields)[0]}":"a","${Object.keys(fields)[0]}":"b"}` },
      { status: 200, message: 'Last duplicate key value is used' },
      'low',
      'edge'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with unexpected extra fields`,
      { endpoint, method, body: { ...validBody, unknownField: 'surprise', _extra: 42 } },
      { status: 200, message: 'Extra fields ignored or rejected' },
      'medium',
      'edge'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with deeply nested body`,
      { endpoint, method, body: { ...validBody, deep: { a: { b: { c: { d: 'deep' } } } } } },
      { status: 200, message: 'Deep nesting handled' },
      'low',
      'edge'
    )
  );

  return cases;
}

// ---------------------------------------------------------------------------
// 5. Security — SQL injection, XSS payloads, and more
// ---------------------------------------------------------------------------

const SQL_PAYLOADS = [
  { val: "' OR 1=1 --",                  label: 'basic OR injection' },
  { val: "'; DROP TABLE users; --",       label: 'DROP TABLE injection' },
  { val: "1' UNION SELECT * FROM users--", label: 'UNION SELECT injection' },
  { val: "' AND 1=CONVERT(int,(SELECT TOP 1 table_name FROM information_schema.tables))--", label: 'error-based injection' },
  { val: "admin'--",                      label: 'comment-based bypass' },
];

const XSS_PAYLOADS = [
  { val: '<script>alert("xss")</script>',       label: 'basic script tag' },
  { val: '<img src=x onerror=alert(1)>',        label: 'img onerror handler' },
  { val: '<svg onload=alert(1)>',               label: 'svg onload handler' },
  { val: 'javascript:alert(document.cookie)',    label: 'javascript: URI' },
  { val: '<body onload=alert(1)>',              label: 'body onload handler' },
  { val: '"><script>alert(String.fromCharCode(88,83,83))</script>', label: 'encoded XSS breakout' },
];

function generateSecurityTests(endpoint, method, fields) {
  const cases = [];
  const validBody = buildValidBody(fields);
  const stringFields = Object.entries(fields).filter(([, t]) => t === 'string');

  // SQL injection per string field
  for (const [name] of stringFields) {
    for (const { val, label } of SQL_PAYLOADS) {
      cases.push(
        makeCase(
          `${method} ${endpoint} SQL injection in "${name}" — ${label}`,
          { endpoint, method, body: { ...validBody, [name]: val } },
          { status: 400, error: 'Potentially malicious input detected' },
          'high',
          'security'
        )
      );
    }
  }

  // XSS per string field
  for (const [name] of stringFields) {
    for (const { val, label } of XSS_PAYLOADS) {
      cases.push(
        makeCase(
          `${method} ${endpoint} XSS in "${name}" — ${label}`,
          { endpoint, method, body: { ...validBody, [name]: val } },
          { status: 400, error: 'Potentially malicious input detected' },
          'high',
          'security'
        )
      );
    }
  }

  // Additional injection vectors per string field
  for (const [name] of stringFields) {
    cases.push(
      makeCase(
        `${method} ${endpoint} path traversal in "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: '../../etc/passwd' } },
        { status: 400, error: 'Path traversal detected' },
        'high',
        'security'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} command injection in "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: '; rm -rf / --no-preserve-root' } },
        { status: 400, error: 'Potentially malicious input detected' },
        'high',
        'security'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} NoSQL injection in "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: '{"$gt":""}' } },
        { status: 400, error: 'Potentially malicious input detected' },
        'high',
        'security'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} SSTI payload in "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: '{{7*7}}' } },
        { status: 400, error: 'Potentially malicious input detected' },
        'medium',
        'security'
      )
    );

    cases.push(
      makeCase(
        `${method} ${endpoint} LDAP injection in "${name}"`,
        { endpoint, method, body: { ...validBody, [name]: '*)(uid=*))(|(uid=*' } },
        { status: 400, error: 'Potentially malicious input detected' },
        'medium',
        'security'
      )
    );
  }

  // Auth / transport-level security
  cases.push(
    makeCase(
      `${method} ${endpoint} without authorization header`,
      { endpoint, method, body: validBody, headers: {} },
      { status: 401, error: 'Authorization required' },
      'high',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with invalid bearer token`,
      { endpoint, method, body: validBody, headers: { Authorization: 'Bearer invalid_token' } },
      { status: 401, error: 'Invalid token' },
      'high',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with expired token`,
      { endpoint, method, body: validBody, headers: { Authorization: 'Bearer expired_token_abc' } },
      { status: 401, error: 'Token expired' },
      'medium',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with oversized payload (1MB+)`,
      { endpoint, method, body: { ...validBody, _pad: 'x'.repeat(1048576) } },
      { status: 413, error: 'Payload too large' },
      'medium',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with header injection attempt`,
      {
        endpoint,
        method,
        body: validBody,
        headers: { 'X-Custom': 'value\r\nInjected-Header: bad' },
      },
      { status: 400, error: 'Invalid header value' },
      'medium',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with prototype pollution in body`,
      { endpoint, method, body: { ...validBody, '__proto__': { admin: true } } },
      { status: 400, error: 'Potentially malicious input detected' },
      'high',
      'security'
    )
  );

  cases.push(
    makeCase(
      `${method} ${endpoint} with constructor pollution in body`,
      { endpoint, method, body: { ...validBody, 'constructor': { prototype: { admin: true } } } },
      { status: 400, error: 'Potentially malicious input detected' },
      'high',
      'security'
    )
  );

  return cases;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function runRuleEngine(input) {
  const { endpoint, method, fields } = input;

  if (!endpoint || !method || !fields || Object.keys(fields).length === 0) {
    throw new Error('Input must include "endpoint", "method", and non-empty "fields".');
  }

  const upperMethod = method.toUpperCase();
  nextId = 1;

  const testCases = [
    ...generateHappyTests(endpoint, upperMethod, fields),
    ...generateNegativeTests(endpoint, upperMethod, fields),
    ...generateBoundaryTests(endpoint, upperMethod, fields),
    ...generateEdgeTests(endpoint, upperMethod, fields),
    ...generateSecurityTests(endpoint, upperMethod, fields),
  ];

  return testCases;
}

module.exports = {
  runRuleEngine,
  generateHappyTests,
  generateNegativeTests,
  generateBoundaryTests,
  generateEdgeTests,
  generateSecurityTests,
};
