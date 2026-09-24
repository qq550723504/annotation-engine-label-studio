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

  const expectDataManagerTaskIds = (expectedIds: number[]) => {
    cy.window({ timeout: 30000 }).its('dataManager').should('exist');
    cy.window({ timeout: 30000 }).should((win) => {
      const list = win.dataManager?.store?.taskStore?.list ?? [];
      const ids = Array.from(list, (task: { id: number }) => task.id).sort((a, b) => a - b);
      expect(ids).to.deep.equal([...expectedIds].sort((a, b) => a - b));
    });
  };

  it('keeps annotator task visibility isolated in the real browser session', () => {
    cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());

    cy.visit(dataPage());
    expectDataManagerTaskIds([fixture.tasks.a.id]);

    cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);

    cy.window().then((win) => {
      return win.dataManager.store.setTask({
        taskID: fixture.tasks.b.id,
        pushState: false,
      });
    });
    cy.request({
      url: `/api/tasks/${fixture.tasks.b.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('keeps the second annotator isolated from the first annotator task', () => {
    cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());

    cy.visit(dataPage());
    expectDataManagerTaskIds([fixture.tasks.b.id]);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).its('status').should('eq', 200);
    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('does not turn reviewer project visibility into labeling access', () => {
    cy.loginAs(fixture.users.reviewer.email, fixture.password, dataPage());

    cy.visit(dataPage());
    expectDataManagerTaskIds([]);

    cy.request({
      url: `/api/tasks/${fixture.tasks.a.id}/`,
      failOnStatusCode: false,
    }).its('status').should('eq', 404);
  });

  it('uses the existing editor Submit action to create an immutable submission', () => {
    cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());

    cy.intercept('GET', '**/api/dm/tasks/next**').as('nextTask');
    cy.intercept('POST', `/api/tasks/${fixture.tasks.a.id}/annotations/`).as('submitAnnotation');
    cy.visit(dataPage());
    expectDataManagerTaskIds([fixture.tasks.a.id]);

    cy.contains('button', /Label All Tasks/i, { timeout: 30000 }).should('be.visible').click();
    cy.wait('@nextTask').its('response.statusCode').should('eq', 200);

    cy.window({ timeout: 30000 }).should((win) => {
      expect(win.dataManager?.lsf?.task?.id).to.eq(fixture.tasks.a.id);
    });

    cy.contains('button', /^Submit$/i, { timeout: 30000 }).should('be.visible').click();

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

  it('rejects writes from an already-open page after membership revocation', () => {
    cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());
    cy.visit(dataPage());
    expectDataManagerTaskIds([fixture.tasks.b.id]);

    cy.request(`/api/tasks/${fixture.tasks.b.id}/`).then((taskResponse) => {
      const assignmentId = taskResponse.body.assignment_id;
      const assignmentVersion = taskResponse.body.assignment_version;

      cy.loginAs(fixture.users.manager.email, fixture.password, '/');
      cy.request(`/api/projects/${fixture.project_id}/members/`).then((membersResponse) => {
        const results = membersResponse.body.results ?? membersResponse.body;
        const annotatorBMember = results.find(
          (item: { user: { id: number } }) => item.user.id === fixture.users.annotator_b.id,
        );
        expect(annotatorBMember).to.exist;

        cy.request({
          method: 'PATCH',
          url: `/api/projects/${fixture.project_id}/members/${annotatorBMember.id}/`,
          body: { enabled: false },
        }).its('status').should('eq', 200);
      });

      // Re-authenticate as B but intentionally send the token captured from the old browser state.
      cy.loginAs(fixture.users.annotator_b.email, fixture.password, '/');
      cy.request({
        method: 'POST',
        url: `/api/tasks/${fixture.tasks.b.id}/annotations/`,
        failOnStatusCode: false,
        body: {
          result: [],
          assignment_id: assignmentId,
          assignment_version: assignmentVersion,
          submit_for_review: true,
        },
      }).then((response) => {
        expect([403, 404, 409]).to.include(response.status);
        expect(response.status).not.to.eq(500);
      });

      cy.request({
        url: `/api/tasks/${fixture.tasks.b.id}/`,
        failOnStatusCode: false,
      }).its('status').should('eq', 404);
    });
  });
});
