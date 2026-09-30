/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      loginAs(email: string, password: string, nextPath?: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('loginAs', (email: string, password: string, nextPath = '/') => {
  // With testIsolation enabled, Cypress unloads the previous application before
  // clearing/restoring session data. Late responses from that page must not
  // restore its signed session cookie while the next actor is logging in.
  cy.session(['ui-login', email, nextPath], () => {
    const loginPath = `/user/login/?next=${encodeURIComponent(nextPath)}`;
    cy.visit(loginPath);
    cy.location('pathname', { timeout: 30000 }).should('eq', '/user/login/');
    cy.get('#email', { timeout: 30000 }).should('be.visible').clear().type(email);
    cy.get('#password', { timeout: 30000 }).should('be.visible').clear().type(password, { log: false });
    cy.get('form button[type="submit"]').click();
    cy.location('pathname', { timeout: 20000 }).should('not.eq', '/user/login/');
  }, {
    validate() {
      cy.request('/api/current-user/whoami').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.email, 'authenticated actor').to.eq(email);
      });
    },
  });

  cy.visit(nextPath);
  // Legacy enterprise specs assert English copy. Establish that test premise
  // explicitly when requested; bilingual specs choose their own locale.
  const loginLocale = Cypress.env('loginLocale');
  if (loginLocale) {
    if (loginLocale !== 'en-US' && loginLocale !== 'zh-CN') throw new Error(`Unsupported login locale: ${loginLocale}`);
    cy.get('[data-testid="user-menu-trigger"]', { timeout: 30000 }).click();
    cy.get('[data-testid="menu-language-select"]').then(($select) => {
      if ($select.val() !== loginLocale) cy.wrap($select).select(loginLocale);
    });
    cy.get('html').should('have.attr', 'lang', loginLocale);
    cy.get('[data-testid="user-menu-trigger"]').click();
  }
});

export {};
