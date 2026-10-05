"""Generate opt-in failing Cypress probes outside the regular test directory."""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--synthetic-only', action='store_true', required=True)
    parser.add_argument('--kind', choices=('http', 'token', 'invite'), required=True)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--secrets', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if args.output.resolve().is_relative_to(repo / 'web'):
        parser.error('Generate outside web; these expected failures must not enter the regular suite')
    fixture_path, secret_path = json.dumps(args.fixture), json.dumps(args.secrets)
    if args.kind == 'http':
        probe = """/// <reference types="cypress" />
describe('real authenticated HTTP failure artifact probe', () => {
  it('retains a failing 404 while redacting its authenticated cookie headers', () => {
    cy.readFile(FIXTURE, { log: false }).then((fixture) => {
      cy.loginAs(fixture.users.annotator_a.email, fixture.password, `/projects/${fixture.project_id}/data`);
      const secrets: Record<string, string> = { fixturePassword: fixture.password };
      cy.getCookie('sessionid', { log: false }).then((cookie) => { secrets.session = cookie!.value; });
      cy.getCookie('csrftoken', { log: false }).then((cookie) => { secrets.csrf = cookie!.value; });
      cy.then(() => cy.writeFile(SECRETS, secrets, { log: false }));
      // The real backend denies another annotator's task. Default cy.request must fail.
      cy.request(`/api/tasks/${fixture.tasks.b.id}/`);
    });
  });
});
export {};
""".replace('FIXTURE', fixture_path).replace('SECRETS', secret_path)
    elif args.kind == 'invite':
        probe = """/// <reference types="cypress" />
describe('real invite failure artifact probe', () => {
  it('redacts the invite API token in failure JSON, URL and server logs', () => {
    cy.readFile(FIXTURE, { log: false }).then((fixture) => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      const secrets: Record<string, string> = { fixturePassword: fixture.password };
      cy.getCookie('sessionid', { log: false }).then((cookie) => { secrets.session = cookie!.value; });
      cy.getCookie('csrftoken', { log: false }).then((cookie) => {
        secrets.csrf = cookie!.value;
        cy.request({ method: 'POST', url: '/api/invite/reset-token', log: false, failOnStatusCode: false,
          headers: { 'X-CSRFToken': cookie!.value } }).then((response) => {
          expect(response.status, 'real synthetic owner invite reset').to.eq(201);
          expect(typeof response.body.token === 'string' && response.body.token.length === 40,
            'real invite token returned').to.eq(true);
          expect(response.body.invite_url.includes(`token=${response.body.token}`),
            'invite URL uses the real token').to.eq(true);
          secrets.inviteToken = response.body.token;
          cy.writeFile(SECRETS, secrets, { log: false });
          cy.then(() => { throw new Error('I18N_INVITE_ARTIFACT_PROBE_EXPECTED_FAILURE ' + JSON.stringify(response.body)); });
        });
      });
    });
  });
});
export {};
""".replace('FIXTURE', fixture_path).replace('SECRETS', secret_path)
    else:
        source = repo / 'web/apps/labelstudio-e2e/src/e2e/app-locale.cy.ts'
        text = source.read_text(encoding='utf-8')
        # Reuse the actual journey, before-render mask and failure cleanup. Fail
        # explicitly if its structure changes; do not maintain a second Token test.
        prefix = text[:text.index("  it('switches anonymous login copy")]
        start = text.index("  it('preserves the real token and curl example")
        end = text.index('  for (const [locale, copy] of [', start)
        probe = prefix + text[start:end] + '\n});\nexport {};\n'
        probe = probe.replace("cy.readFile('.enterprise-e2e.json')", f'cy.readFile({fixture_path}, {{ log: false }})')
        marker = "    cy.then(() => {\n      if (!legacyTokensEnabled) {"
        if probe.count(marker) != 1:
            parser.error('Token journey structure changed; review the probe insertion point')
        injection = """    const secrets: Record<string, string> = {};
    cy.getCookie('sessionid', { log: false }).then((cookie) => { secrets.session = cookie!.value; });
    cy.getCookie('csrftoken', { log: false }).then((cookie) => { secrets.csrf = cookie!.value; });
    cy.get(tokenField, { log: false }).should(($input) => {
      expect(getComputedStyle($input[0]).visibility, 'token pixels hidden').to.eq('hidden');
    });
    cy.get(curlField, { log: false }).should(($input) => {
      expect(getComputedStyle($input[0]).visibility, 'curl pixels hidden').to.eq('hidden');
    });
    cy.then(() => {
      secrets.token = token;
      secrets.fixturePassword = fixture.password;
      cy.writeFile(SECRETS, secrets, { log: false });
    });
    cy.then(() => { throw new Error('I18N_TOKEN_ARTIFACT_PROBE_EXPECTED_FAILURE'); });
""".replace('SECRETS', secret_path)
        probe = probe.replace(marker, injection + marker)
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        output.write(probe)
    print(json.dumps({'kind': args.kind, 'isolated_tests': 1, 'expected_cypress_exit': 1}))


if __name__ == '__main__':
    main()
