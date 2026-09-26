/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: {
    manager: { id: number; email: string };
    manager_b: { id: number; email: string };
    annotator_a: { id: number; email: string };
    annotator_b: { id: number; email: string };
    reviewer: { id: number; email: string };
  };
  tasks: {
    c: { id: number };
  };
};

describe("task assignment management UI", () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile(".enterprise-e2e.json").then((data) => {
      fixture = data as Fixture;
    });
  });

  afterEach(() => {
    if (fixture?.users?.manager_b) {
      cy.task("setEnterpriseE2EMember", { actor: "manager_b", enabled: true });
    }
  });

  const dataPage = () => `/projects/${fixture.project_id}/data`;

  const resetTaskCAssignment = (actor?: "annotator_a" | "annotator_b") => {
    cy.task("setEnterpriseE2EAssignment", {
      action: "clear",
      taskId: fixture.tasks.c.id,
      actor: "manager",
    });
    if (actor) {
      cy.task("setEnterpriseE2EAssignment", {
        action: "assign",
        taskId: fixture.tasks.c.id,
        actor,
      });
    }
  };

  const openTaskAs = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());
    cy.visit(`${dataPage()}?task=${fixture.tasks.c.id}`);
    cy.location("pathname", { timeout: 30000 }).should("eq", dataPage());
  };

  const openAssignmentManager = () => {
    cy.get("body").then(($body) => {
      if ($body.find('button[aria-label="Close modal"]').length) {
        cy.get('button[aria-label="Close modal"]').first().click();
        cy.get('button[aria-label="Close modal"]').should("not.exist");
      }
    });

    cy.get('[data-testid="manage-task-assignments"]', { timeout: 30000 })
      .should("be.visible")
      .and("not.be.disabled")
      .click();

    cy.get('[data-testid="assignment-manager"]', { timeout: 30000 }).should("exist");
  };

  const closeAssignmentManager = () => {
    cy.get('[data-testid="assignment-manager"]').should("exist");
    cy.get('button[aria-label="Close modal"]').first().click();
    cy.get('[data-testid="assignment-manager"]').should("not.exist");
  };

  it("assigns, revokes a stale session, and reassigns a task", () => {
    resetTaskCAssignment();
    openTaskAs(fixture.users.manager.email);
    openAssignmentManager();

    cy.get('[data-testid="assignment-assignee-select"]')
      .find("option")
      .should("not.contain.text", fixture.users.reviewer.email);

    cy.get('[data-testid="assignment-assignee-select"]').select(String(fixture.users.annotator_a.id));
    cy.get('[data-testid="assignment-submit"]').click();

    cy.contains('[data-testid^="assignment-row-"]', fixture.users.annotator_a.email)
      .should("exist")
      .and("contain.text", "assigned");

    cy.request(
      `/api/task-assignments/?project=${fixture.project_id}&task=${fixture.tasks.c.id}&active=true`,
    ).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.length(1);
      const oldAssignment = response.body[0];

      closeAssignmentManager();
      openTaskAs(fixture.users.annotator_a.email);
      cy.request(`/api/tasks/${fixture.tasks.c.id}/`).its("status").should("eq", 200);

      // Preserve Annotator A's browser session while assignment state changes out of band.
      cy.task("setEnterpriseE2EAssignment", {
        action: "cancel",
        taskId: fixture.tasks.c.id,
        actor: "annotator_a",
      });
      cy.task("setEnterpriseE2EAssignment", {
        action: "assign",
        taskId: fixture.tasks.c.id,
        actor: "annotator_a",
      });

      // Same user was reassigned, so the stale assignment id/version must conflict.
      cy.request({
        url: `/api/tasks/${fixture.tasks.c.id}/annotations/`,
        method: "POST",
        failOnStatusCode: false,
        body: {
          result: [],
          assignment_id: oldAssignment.id,
          assignment_version: oldAssignment.version,
        },
      }).its("status").should("eq", 409);

      // Cancel the fresh A assignment out of band, then reassign to B through the Manager UI.
      cy.task("setEnterpriseE2EAssignment", {
        action: "cancel",
        taskId: fixture.tasks.c.id,
        actor: "annotator_a",
      });

      openTaskAs(fixture.users.manager.email);
      openAssignmentManager();
      cy.get('[data-testid="assignment-empty"]').should("exist");
      cy.get('[data-testid="assignment-assignee-select"]').select(String(fixture.users.annotator_b.id));
      cy.get('[data-testid="assignment-submit"]').click();
      cy.contains('[data-testid^="assignment-row-"]', fixture.users.annotator_b.email).should("exist");
      closeAssignmentManager();

      cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());
      cy.request(`/api/tasks/${fixture.tasks.c.id}/`).its("status").should("eq", 200);
    });
  });

  it("rejects assignment management after manager membership is revoked in the same session", () => {
    resetTaskCAssignment("annotator_b");
    openTaskAs(fixture.users.manager_b.email);
    openAssignmentManager();

    cy.request(
      `/api/task-assignments/?project=${fixture.project_id}&task=${fixture.tasks.c.id}&active=true`,
    ).then((beforeRevocation) => {
      expect(beforeRevocation.status).to.eq(200);
      expect(beforeRevocation.body).to.have.length(1);
      const assignmentId = beforeRevocation.body[0].id;

      cy.task("setEnterpriseE2EMember", { actor: "manager_b", enabled: false });

      cy.request({
        url: `/api/task-assignments/eligible-assignees/?project=${fixture.project_id}`,
        failOnStatusCode: false,
      }).its("status").should("be.oneOf", [403, 404]);

      cy.request({
        url: `/api/task-assignments/?project=${fixture.project_id}&task=${fixture.tasks.c.id}&active=true`,
        failOnStatusCode: false,
      }).its("status").should("be.oneOf", [403, 404]);

      cy.request({
        url: "/api/task-assignments/",
        method: "POST",
        failOnStatusCode: false,
        body: {
          task: fixture.tasks.c.id,
          assignee: fixture.users.annotator_a.id,
        },
      }).its("status").should("be.oneOf", [403, 404]);

      cy.request({
        url: `/api/task-assignments/${assignmentId}/`,
        method: "DELETE",
        failOnStatusCode: false,
      }).its("status").should("be.oneOf", [403, 404]);
    });
  });

  it("does not expose assignment mutation controls to an assigned annotator", () => {
    resetTaskCAssignment("annotator_b");
    openTaskAs(fixture.users.annotator_b.email);
    cy.get('[data-testid="manage-task-assignments"]').should("not.exist");
  });
});

export {};
