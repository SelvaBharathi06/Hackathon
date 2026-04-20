/**
 * Generates a JUnit 5 test class from the API spec and generated test cases.
 */

function toClassName(url) {
  const parts = url
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join('') + 'Test';
}

function escapeJava(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function bodyToJson(body) {
  if (!body || Object.keys(body).length === 0) return '"{}"';
  return `"${escapeJava(JSON.stringify(body))}"`;
}

function headersToJava(headers) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `            .header("${escapeJava(k)}", "${escapeJava(v)}")`)
    .join('\n');
}

function generateJUnitCode(apiSpec, testCases) {
  const className = toClassName(apiSpec.url);

  const methods = testCases
    .map((tc) => {
      const headerLines = headersToJava(tc.headers);
      const needsBody = ['POST', 'PUT', 'PATCH'].includes(tc.method);

      let requestChain = `        given()\n            .baseUri(BASE_URL)\n            .contentType(ContentType.JSON)`;

      if (headerLines) {
        requestChain += `\n${headerLines}`;
      }

      if (needsBody && tc.body) {
        requestChain += `\n            .body(${bodyToJson(tc.body)})`;
      }

      requestChain += `\n        .when()\n            .${tc.method.toLowerCase()}("${escapeJava(tc.url)}")`;
      requestChain += `\n        .then()\n            .statusCode(${tc.expectedStatus});`;

      return `    // ${tc.description}
    @Test
    void ${tc.name}() {
${requestChain}
    }`;
    })
    .join('\n\n');

  return `import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.Test;
import static io.restassured.RestAssured.given;

class ${className} {

    private static final String BASE_URL = "http://localhost:8080";

${methods}
}
`;
}

module.exports = { generateJUnitCode };
