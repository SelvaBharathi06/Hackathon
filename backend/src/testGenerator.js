/**
 * Rule-based test case generator.
 * Accepts an API spec object and returns an array of structured test case objects.
 *
 * Expected input shape:
 * {
 *   method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
 *   url: "/api/users/{id}",
 *   headers: { "Authorization": "Bearer token", ... },
 *   queryParams: { "page": "1", ... },
 *   pathParams: { "id": "123" },
 *   body: { ... },
 *   expectedStatus: 200
 * }
 */

let nextId = 1;

function tc(name, method, url, headers, body, expectedStatus, description) {
  return {
    id: nextId++,
    name,
    method,
    url,
    headers: headers || {},
    body: body || null,
    expectedStatus,
    description,
  };
}

function generateTestCases(apiSpec) {
  nextId = 1;
  const {
    method,
    url,
    headers = {},
    body = null,
    expectedStatus = 200,
    pathParams = {},
    queryParams = {},
  } = apiSpec;

  const cases = [];
  const upperMethod = method.toUpperCase();

  // --- 1. Happy path ---
  cases.push(
    tc(
      'testHappyPath',
      upperMethod,
      url,
      headers,
      body,
      expectedStatus,
      `Valid ${upperMethod} request returns ${expectedStatus}`
    )
  );

  // --- 2. Missing auth header ---
  if (headers['Authorization'] || headers['authorization']) {
    const stripped = { ...headers };
    delete stripped['Authorization'];
    delete stripped['authorization'];
    cases.push(
      tc(
        'testMissingAuthHeader',
        upperMethod,
        url,
        stripped,
        body,
        401,
        'Request without Authorization header should return 401'
      )
    );
  }

  // --- 3. Invalid HTTP method ---
  const invalidMethod = upperMethod === 'GET' ? 'POST' : 'GET';
  cases.push(
    tc(
      'testInvalidHttpMethod',
      invalidMethod,
      url,
      headers,
      body,
      405,
      `Using ${invalidMethod} instead of ${upperMethod} should return 405`
    )
  );

  // --- 4. Path param rules ---
  const pathParamNames = Object.keys(pathParams);
  if (pathParamNames.length > 0) {
    // Missing path param
    let missingUrl = url;
    for (const p of pathParamNames) {
      missingUrl = missingUrl.replace(`{${p}}`, '');
    }
    cases.push(
      tc(
        'testMissingPathParam',
        upperMethod,
        missingUrl,
        headers,
        body,
        400,
        'Request with missing path parameter should return 400'
      )
    );

    // Invalid path param (non-numeric for typical id params)
    if (pathParamNames.some((p) => /id/i.test(p))) {
      let badUrl = url;
      for (const p of pathParamNames) {
        if (/id/i.test(p)) badUrl = badUrl.replace(`{${p}}`, 'INVALID');
      }
      cases.push(
        tc(
          'testInvalidPathParam',
          upperMethod,
          badUrl,
          headers,
          body,
          400,
          'Request with invalid (non-numeric) ID path param should return 400'
        )
      );
    }

    // Non-existent resource
    let notFoundUrl = url;
    for (const p of pathParamNames) {
      notFoundUrl = notFoundUrl.replace(`{${p}}`, '999999');
    }
    cases.push(
      tc(
        'testResourceNotFound',
        upperMethod,
        notFoundUrl,
        headers,
        body,
        404,
        'Request for a non-existent resource should return 404'
      )
    );
  }

  // --- 5. Body rules (POST / PUT / PATCH) ---
  if (['POST', 'PUT', 'PATCH'].includes(upperMethod)) {
    // Empty body
    cases.push(
      tc(
        'testEmptyRequestBody',
        upperMethod,
        url,
        headers,
        {},
        400,
        'Request with empty body should return 400'
      )
    );

    // Missing required fields
    if (body && typeof body === 'object') {
      const keys = Object.keys(body);
      for (const key of keys) {
        const partial = { ...body };
        delete partial[key];
        cases.push(
          tc(
            `testMissingField_${key}`,
            upperMethod,
            url,
            headers,
            partial,
            400,
            `Request missing required field "${key}" should return 400`
          )
        );
      }

      // Invalid field types
      for (const key of keys) {
        const wrongType = { ...body };
        if (typeof wrongType[key] === 'number') {
          wrongType[key] = 'not_a_number';
        } else if (typeof wrongType[key] === 'string') {
          wrongType[key] = 12345;
        } else if (typeof wrongType[key] === 'boolean') {
          wrongType[key] = 'not_a_boolean';
        }
        cases.push(
          tc(
            `testInvalidType_${key}`,
            upperMethod,
            url,
            headers,
            wrongType,
            400,
            `Request with invalid type for field "${key}" should return 400`
          )
        );
      }
    }
  }

  // --- 6. Query param rules ---
  const qpNames = Object.keys(queryParams);
  if (qpNames.length > 0) {
    for (const qp of qpNames) {
      cases.push(
        tc(
          `testMissingQueryParam_${qp}`,
          upperMethod,
          url,
          headers,
          body,
          400,
          `Request without required query param "${qp}" should return 400`
        )
      );
    }
  }

  return cases;
}

module.exports = { generateTestCases };
