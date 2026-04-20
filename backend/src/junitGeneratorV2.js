/**
 * JUnit 5 + MockMvc code generator for rule-engine test cases.
 *
 * Accepts the original input spec + array of test cases from ruleEngine.js
 * and produces a compilable Spring Boot @WebMvcTest class using MockMvc.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toClassName(endpoint) {
  return (
    endpoint
      .replace(/^\//, '')
      .split('/')
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('') + 'ControllerTest'
  );
}

function toControllerName(endpoint) {
  return (
    endpoint
      .replace(/^\//, '')
      .split('/')
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('') + 'Controller'
  );
}

function escapeJava(str) {
  if (str === null || str === undefined) return 'null';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function toMethodName(scenario) {
  return (
    'test' +
    scenario
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  );
}

function bodyToJavaString(body) {
  if (body === null || body === undefined) return '"{}"';
  return `"${escapeJava(JSON.stringify(body))}"`;
}

// ---------------------------------------------------------------------------
// Status code → MockMvc ResultMatcher mapping
// ---------------------------------------------------------------------------

const STATUS_MATCHERS = {
  200: 'isOk()',
  201: 'isCreated()',
  204: 'isNoContent()',
  400: 'isBadRequest()',
  401: 'isUnauthorized()',
  403: 'isForbidden()',
  404: 'isNotFound()',
  405: 'isMethodNotAllowed()',
  409: 'isConflict()',
  415: 'isUnsupportedMediaType()',
  422: 'isUnprocessableEntity()',
  429: 'is(429)',
  500: 'isInternalServerError()',
};

function statusMatcher(code) {
  return STATUS_MATCHERS[code] || `is(${code})`;
}

// ---------------------------------------------------------------------------
// HTTP method → MockMvcRequestBuilders static method
// ---------------------------------------------------------------------------

function mockMvcMethod(method) {
  const map = {
    get: 'get',
    post: 'post',
    put: 'put',
    patch: 'patch',
    delete: 'delete',
  };
  return map[method.toLowerCase()] || 'post';
}

// ---------------------------------------------------------------------------
// Generate a single test method
// ---------------------------------------------------------------------------

function generateMethod(tc, inputSpec, uniqueNameFn) {
  const methodName = uniqueNameFn(toMethodName(tc.scenario));
  const httpMethod = mockMvcMethod(tc.input.method || inputSpec.method);
  const url = tc.input.endpoint || inputSpec.endpoint;
  const hasBody = ['post', 'put', 'patch'].includes(httpMethod);
  const status = statusMatcher(tc.expected.status);

  // Build the perform() chain
  let perform = `            ${httpMethod}("${escapeJava(url)}")`;
  perform += `\n                .contentType(MediaType.APPLICATION_JSON)`;

  // Headers
  if (tc.input.headers) {
    for (const [k, v] of Object.entries(tc.input.headers)) {
      if (v) {
        perform += `\n                .header("${escapeJava(k)}", "${escapeJava(v)}")`;
      }
    }
  }

  // Body
  if (hasBody) {
    if (tc.input.body !== undefined && tc.input.body !== null) {
      perform += `\n                .content(${bodyToJavaString(tc.input.body)})`;
    } else if (tc.input.rawBody) {
      perform += `\n                .content("${escapeJava(tc.input.rawBody)}")`;
    }
  }

  return `    /**
     * [${tc.category.toUpperCase()}] ${tc.scenario}
     * Priority: ${tc.priority}
     */
    @Test
    void ${methodName}() throws Exception {
        mockMvc.perform(
${perform})
            .andExpect(status().${status});
    }`;
}

// ---------------------------------------------------------------------------
// Generate the full Java class
// ---------------------------------------------------------------------------

function generateJUnitCodeV2(input, testCases) {
  const className = toClassName(input.endpoint);
  const controllerName = toControllerName(input.endpoint);
  const usedNames = new Set();

  function uniqueName(base) {
    let name = base;
    let i = 2;
    while (usedNames.has(name)) {
      name = base + i++;
    }
    usedNames.add(name);
    return name;
  }

  const methods = testCases.map((tc) => generateMethod(tc, input, uniqueName));

  return `import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Auto-generated JUnit 5 + MockMvc tests for ${input.method.toUpperCase()} ${input.endpoint}
 * Total test cases: ${testCases.length}
 */
@WebMvcTest(${controllerName}.class)
class ${className} {

    @Autowired
    private MockMvc mockMvc;

${methods.join('\n\n')}
}
`;
}

module.exports = { generateJUnitCodeV2 };
