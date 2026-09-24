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

declare global {
  interface Window {
    DM?: any;
  }
}

describe('enterprise collaboration - currently available UI', () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile('.enterprise-e2e.json').then((data) => {
      fixture = data as Fixture;
    });
  });

  const dataPage = () => `/projects/${fixture.project_id}/data`;

  const openDataManager = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());
    cy.visit(dataPage());
    cy.location('pathname', { timeout: 30000 }).should('eq', dataPage());
    cy.window({ timeout: 30000 }).its('DM').should('exist');
    cy.window({ timeout: 30000 }).its('DM.loading').should('eq', false);
  };

  it('proves backend assignment access while recording the current Data Manager projection gap for annotator A', () => {
    openDataManager(fixture.users.annotator_a.email);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.window().then((win) => {
      expect(win.DM.project.id).to.eq(fixture.project_id);
      expect(win.DM.project.task_count ?? win.DM.project.task_number ?? 0).to.eq(0);
      expect(win.DM.taskStore.total ?? 0).to.eq(0);
    });

    cy.contains('button', /Label All Tasks/i).should('not.exist');
  });

  it('proves backend assignment access while recording the same UI projection gap for annotator B', () => {
    openDataManager(fixture.users.annotator_b.email);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.window().then((win) => {
      expect(win.DM.project.id).to.eq(fixture.project_id);
      expect(win.DM.taskStore.total ?? 0).to.eq(0);
    });

    cy.contains('button', /Label All Tasks/i).should('not.exist');
  });

  it('does not turn reviewer project visibility into labeling access', () => {
    openDataManager(fixture.users.reviewer.email);

    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.window().then((win) => {
      expect(win.DM.taskStore.total ?? 0).to.eq(0);
    });

    cy.contains('button', /Label All Tasks/i).should('not.exist');
    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('records Submit-through-browser as GAP because assigned tasks are not projected into the current Data Manager UI', () => {
    openDataManager(fixture.users.annotator_a.email);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.assignment_id).to.eq(fixture.tasks.a.assignment_id);
    });

    cy.window().then((win) => {
      expect(win.DM.taskStore.total ?? 0).to.eq(0);
    });

    cy.contains('button', /Label All Tasks/i).should('not.exist');
    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('verifies revocation closes backend access; stale open-editor browser validation remains GAP until tasks are projected into UI', () => {
    openDataManager(fixture.users.annotator_b.email);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);

    cy.task('setEnterpriseE2EMember', { actor: 'annotator_b', enabled: false });

    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.window().then((win) => {
      expect(win.DM.taskStore.total ?? 0).to.eq(0);
    });
  });
});

export {};
