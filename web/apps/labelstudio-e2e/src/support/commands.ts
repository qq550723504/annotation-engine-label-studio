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
    // Switching actors within one test must end the prior server session and
    // unload its page before a new login. Clearing the cookie on a still-mounted
    // page can race with a late authenticated response that restores it.
    cy.visit('/logout/');
    cy.clearCookies();
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
});

export {};
