const assert = require('node:assert/strict');
const test = require('node:test');
const { redactDiagnostic, redactFailure } = require('./failure-diagnostics.cjs');

const session = 's'.repeat(32);
const csrf = 'c'.repeat(32);
const token = 't'.repeat(40);

test('redacts default HTTP failure headers while retaining route, method and status', () => {
  const diagnostic = [
    'cy.request() failed on GET http://localhost:8080/api/tasks/2/',
    '404: Not Found',
    `Cookie: sessionid=${session}; csrftoken=${csrf}`,
    `Set-Cookie: ["sessionid=${session}; HttpOnly",`,
    `  "csrftoken=${csrf}; SameSite=Lax"]`,
    `"Authorization": "Bearer ${token}", "status": 404`,
    `'X-CSRFToken': '${csrf}'`,
  ].join('\n');
  const result = redactDiagnostic(diagnostic);
  for (const value of [session, csrf, token]) assert.equal(result.includes(value), false);
  for (const value of ['GET http://localhost:8080/api/tasks/2/', '404: Not Found', '"status": 404']) {
    assert.equal(result.includes(value), true);
  }
  assert.equal(result.includes('[REDACTED]'), true);
});

test('redacts cookie and token fragments without requiring a complete header', () => {
  const diagnostic = `sessionid: '${session}'\ncsrftoken=${csrf}\nToken ${token}\nBearer ${token}`;
  const result = redactDiagnostic(diagnostic);
  for (const value of [session, csrf, token]) assert.equal(result.includes(value), false);
  assert.equal(redactDiagnostic(result), result);
});

test('preserves the original error and diagnostic location for rethrow', () => {
  const error = new Error(`GET /api/tasks/2/ returned 404\nCookie: sessionid=${session}`);
  error.name = 'CypressError';
  error.stack = `${error.name}: ${error.message}\n  at failure-probe.cy.ts:19:8`;
  error.status = 404;
  const result = redactFailure(error);
  assert.equal(result, error);
  assert.equal(result.name, 'CypressError');
  assert.equal(result.status, 404);
  assert.equal(result.message.includes(session), false);
  assert.equal(result.stack.includes(session), false);
  assert.equal(result.stack.includes('failure-probe.cy.ts:19:8'), true);
});

test('redacts the real invite API JSON and URL token formats without hiding other fields', () => {
  const diagnostic = JSON.stringify({ invite_url: `/user/signup/?token=${token}&next=/projects`, token, status: 201 });
  const result = redactDiagnostic(diagnostic);
  assert.equal(result.includes(token), false);
  assert.equal(result.includes('/user/signup/?token=[REDACTED]&next=/projects'), true);
  assert.equal(result.includes('"token":"[REDACTED]"'), true);
  assert.equal(result.includes('"status":201'), true);
  assert.equal(redactDiagnostic(result), result);
});

test('leaves ordinary failures and errors without a stack diagnosable', () => {
  const error = new Error('Expected annotation revision 2, got 1');
  error.stack = undefined;
  assert.equal(redactFailure(error).message, 'Expected annotation revision 2, got 1');
});

test('redacts the existing JWT refresh/rotate request and response credential keys', () => {
  // jwt_auth/serializers.py declares access and refresh credential fields.
  const jwt = `${'h'.repeat(24)}.${'p'.repeat(64)}.${'s'.repeat(43)}`;
  const diagnostic = JSON.stringify({ access: jwt, refresh: jwt, status: 401 });
  const result = redactDiagnostic(diagnostic);
  assert.equal(result.includes(jwt), false);
  assert.equal(result.includes('"access":"[REDACTED]"'), true);
  assert.equal(result.includes('"refresh":"[REDACTED]"'), true);
  assert.equal(result.includes('"status":401'), true);
});

test('consumes complete opaque bearer credentials with RFC 6750 characters', () => {
  assert.equal(redactDiagnostic('Bearer abc+/~=='), 'Bearer [REDACTED]');
  for (const value of ['abc+def/ghi~jklmnop==', 'abcdefghijklmnop+SECRET/tail~==']) {
    for (const scheme of ['Bearer', 'Token']) {
      assert.equal(redactDiagnostic(`${scheme} ${value}`), `${scheme} [REDACTED]`);
    }
    assert.equal(redactDiagnostic(JSON.stringify({ token: value })), '{"token":"[REDACTED]"}');
    assert.equal(redactDiagnostic(`?token=${encodeURIComponent(value)}&next=/projects`),
      '?token=[REDACTED]&next=/projects');
  }
});
