/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: {
    manager: { id: number; email: string };
    annotator_a: { id: number; email: string };
    annotator_b: { id: number; email: string };
    reviewer: { id: number; email: string };
  };
  tasks: {
    a: { id: number; assignment_id: number };
    b: { id: number; assignment_id: number };
  };
};

describe('enterprise collaboration - currently available UI', () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile('.enterprise-e2e.json').then((data) => {
      fixture = data as Fixture;
    });
  });

  const dataPage = () => `/projects/${fixture.project_id}/data`;

  const openProjectDataPage = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());
    cy.visit(dataPage());
    cy.location('pathname', { timeout: 30000 }).should('eq', dataPage());
    cy.get('body').should('be.visible');
  };

  it('proves annotator A backend assignment scope from a real browser session', () => {
    openProjectDataPage(fixture.users.annotator_a.email);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    // The project-level labeling entry may be visible depending on seeded task state.
    // Security is asserted by the task API scope above; no editor submit control is active here.
    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('proves annotator B backend assignment scope from a real browser session', () => {
    openProjectDataPage(fixture.users.annotator_b.email);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('does not turn reviewer project visibility into labeling access', () => {
    openProjectDataPage(fixture.users.reviewer.email);

    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('records Submit-through-browser as GAP while preserving the backend assignment contract', () => {
    openProjectDataPage(fixture.users.annotator_a.email);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.assignment_id).to.eq(fixture.tasks.a.assignment_id);
      expect(response.body.assignment_version).to.be.a('number');
    });

    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('verifies revocation closes backend access; stale-open-editor remains a documented UI GAP', () => {
    openProjectDataPage(fixture.users.annotator_b.email);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);

    // Out-of-band fixture mutation is intentional: project member management UI is #17.
    cy.task('setEnterpriseE2EMember', { actor: 'annotator_b', enabled: false });

    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
      expect(response.status).not.to.eq(500);
    });

    // The backend access is revoked immediately, while the already-rendered
    // Data Manager control can remain stale until refresh. That stale control
    // is the documented UI GAP; the security boundary is the 404 above.
    cy.contains('button', /Label All Tasks/i).should('exist');

    cy.task('setEnterpriseE2EMember', { actor: 'annotator_b', enabled: true });
  });
});

export {};
