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

  const openDataManager = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());

    cy.intercept('GET', `/api/projects/${fixture.project_id}**`).as('projectDetail');
    cy.intercept('GET', '/api/dm/project**').as('dmProject');

    cy.visit(dataPage());
    cy.location('pathname', { timeout: 30000 }).should('eq', dataPage());

    // ProjectProvider must resolve the project before DataManagerPage mounts and
    // dynamically imports @humansignal/editor / @humansignal/datamanager.
    cy.wait('@projectDetail', { timeout: 30000 }).its('response.statusCode').should('eq', 200);

    cy.window({ timeout: 30000 }).should((win) => {
      expect(win.APP_SETTINGS, 'APP_SETTINGS').to.exist;
      expect(win.LabelStudio, 'LabelStudio global after DataManager route mount').to.exist;
      expect(win.DataManager, 'DataManager global after DataManager route mount').to.exist;
    });

    cy.wait('@dmProject', { timeout: 30000 }).its('response.statusCode').should('eq', 200);
  };

  const startLabelStream = (expectedStatus: number, expectedTaskId?: number) => {
    cy.intercept('GET', '**/api/dm/tasks/next**').as('nextTask');
    cy.contains('button', /Label All Tasks/i, { timeout: 30000 }).should('be.visible').click();

    cy.wait('@nextTask').then(({ response }) => {
      expect(response?.statusCode).to.eq(expectedStatus);
      if (expectedTaskId !== undefined && response?.statusCode === 200) {
        expect(response.body.id).to.eq(expectedTaskId);
      }
    });
  };

  it('keeps annotator task visibility isolated in the real browser session', () => {
    openDataManager(fixture.users.annotator_a.email);

    cy.contains('button', /Label All Tasks/i).should('be.visible');
    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('keeps the second annotator isolated from the first annotator task', () => {
    openDataManager(fixture.users.annotator_b.email);

    cy.contains('button', /Label All Tasks/i).should('be.visible');
    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('does not turn reviewer project visibility into labeling access', () => {
    openDataManager(fixture.users.reviewer.email);

    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    startLabelStream(404);
    cy.get('[data-testid="bottombar-submit-button"]').should('not.exist');
  });

  it('uses the existing editor Submit action to create an immutable submission', () => {
    openDataManager(fixture.users.annotator_a.email);

    cy.intercept('POST', `/api/tasks/${fixture.tasks.a.id}/annotations/`).as('submitAnnotation');
    startLabelStream(200, fixture.tasks.a.id);

    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should('be.visible').click();

    cy.wait('@submitAnnotation').then(({ response }) => {
      expect(response?.statusCode).to.eq(201);
    });

    cy.request(`/api/submissions/?project=${fixture.project_id}&status=pending`).then((response) => {
      expect(response.status).to.eq(200);
      const results = response.body.results ?? response.body;
      const submission = results.find(
        (item: { assignment: number }) => item.assignment === fixture.tasks.a.assignment_id,
      );
      expect(submission, 'submission for annotator A assignment').to.exist;
      expect(submission.revision).to.eq(1);
      expect(submission.status).to.eq('pending');
      expect(submission.submitted_by.id).to.eq(fixture.users.annotator_a.id);
    });
  });

  it('rejects Submit from an already-open page after membership revocation', () => {
    openDataManager(fixture.users.annotator_b.email);

    startLabelStream(200, fixture.tasks.b.id);
    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should('be.visible');

    // Revoke membership out-of-band while the annotator keeps the editor open.
    cy.task('setEnterpriseE2EMember', { actor: 'annotator_b', enabled: false });

    cy.intercept('POST', `/api/tasks/${fixture.tasks.b.id}/annotations/`).as('staleSubmit');
    cy.get('[data-testid="bottombar-submit-button"]').click();

    cy.wait('@staleSubmit').then(({ response }) => {
      expect(response?.statusCode).to.be.oneOf([403, 404, 409]);
      expect(response?.statusCode).not.to.eq(500);
    });

    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });
});

export {};
