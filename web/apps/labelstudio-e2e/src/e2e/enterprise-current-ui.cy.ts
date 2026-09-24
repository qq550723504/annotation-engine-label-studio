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

  const waitForDataManager = () => {
    cy.window({ timeout: 30000 }).its('dataManager').should('exist');
    cy.window({ timeout: 30000 }).its('dataManager.store.taskStore').should('exist');
  };

  const expectVisibleTaskScope = (includedId: number | null, excludedIds: number[]) => {
    waitForDataManager();
    cy.window().should((win) => {
      const list = win.dataManager?.store?.taskStore?.list ?? [];
      const ids = Array.from(list, (task: { id: number }) => task.id);

      if (includedId !== null) {
        expect(ids, 'Data Manager task IDs').to.include(includedId);
      }
      excludedIds.forEach((id) => {
        expect(ids, 'Data Manager task IDs').not.to.include(id);
      });
    });
  };

  const openAssignedTask = (taskId: number) => {
    waitForDataManager();

    cy.window().then((win) => {
      win.dataManager.store.startLabeling({ id: taskId, isSelected: false });
    });

    cy.window({ timeout: 30000 }).its('dataManager.store.mode').should('eq', 'labeling');
    cy.window({ timeout: 30000 }).should((win) => {
      expect(win.dataManager?.lsf?.task?.id).to.eq(taskId);
    });
    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should('be.visible');
  };

  it('keeps annotator task visibility isolated in the real Data Manager state', () => {
    cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());
    cy.visit(dataPage());

    expectVisibleTaskScope(fixture.tasks.a.id, [fixture.tasks.b.id]);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('keeps the second annotator isolated from the first annotator task', () => {
    cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());
    cy.visit(dataPage());

    expectVisibleTaskScope(fixture.tasks.b.id, [fixture.tasks.a.id]);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('does not turn reviewer project visibility into labeling access', () => {
    cy.loginAs(fixture.users.reviewer.email, fixture.password, dataPage());
    cy.visit(dataPage());

    expectVisibleTaskScope(null, [fixture.tasks.a.id, fixture.tasks.b.id]);

    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('uses the existing editor Submit action to create an immutable submission', () => {
    cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());
    cy.visit(dataPage());
    expectVisibleTaskScope(fixture.tasks.a.id, [fixture.tasks.b.id]);

    cy.intercept('POST', `/api/tasks/${fixture.tasks.a.id}/annotations/`).as('submitAnnotation');
    openAssignedTask(fixture.tasks.a.id);

    cy.get('[data-testid="bottombar-submit-button"]').click();

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
    cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());
    cy.visit(dataPage());
    expectVisibleTaskScope(fixture.tasks.b.id, [fixture.tasks.a.id]);
    openAssignedTask(fixture.tasks.b.id);

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
