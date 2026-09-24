/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      loginAs(email: string, password: string, nextPath?: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('loginAs', (email: string, password: string, nextPath = '/') => {
  cy.clearCookies();
  cy.clearLocalStorage();

  cy.visit(`/user/login/?next=${encodeURIComponent(nextPath)}`);
  cy.get('#email').should('be.visible').clear().type(email);
  cy.get('#password').should('be.visible').clear().type(password, { log: false });
  cy.get('button[aria-label="Log In"]').click();

  cy.location('pathname', { timeout: 20000 }).should('not.eq', '/user/login/');
  cy.request('/api/current-user/whoami').its('status').should('eq', 200);
});

export {};
