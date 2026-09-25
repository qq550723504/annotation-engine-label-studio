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

  const dataPage = () => `/projects/${fixture.project_id}/data`;

  const openTaskAs = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());
    cy.visit(`${dataPage()}?task=${fixture.tasks.c.id}`);
    cy.location("pathname", { timeout: 30000 }).should("eq", dataPage());
  };

  const openAssignmentManager = () => {
    cy.get('[data-testid="manage-task-assignments"]', { timeout: 30000 })
      .should("be.visible")
      .and("not.be.disabled")
      .click();

    cy.get('[data-testid="assignment-manager"]', { timeout: 30000 }).should("exist");
  };

  it("assigns, cancels, and reassigns a task through the manager UI", () => {
    openTaskAs(fixture.users.manager.email);
    openAssignmentManager();

    cy.get('[data-testid="assignment-assignee-select"]')
      .find("option")
      .should("not.contain.text", fixture.users.reviewer.email);

    cy.get('[data-testid="assignment-assignee-select"]').select(String(fixture.users.annotator_a.id));
    cy.contains("button", "Assign").click();

    cy.contains('[data-testid^="assignment-"]', fixture.users.annotator_a.email)
      .should("exist")
      .and("contain.text", "assigned");

    cy.request(
      `/api/task-assignments/?project=${fixture.project_id}&task=${fixture.tasks.c.id}&active=true`,
    ).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.length(1);
      const oldAssignment = response.body[0];

      cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());
      cy.request(`/api/tasks/${fixture.tasks.c.id}/`).its("status").should("eq", 200);

      openTaskAs(fixture.users.manager.email);
      openAssignmentManager();
      cy.contains('[data-testid^="assignment-"]', fixture.users.annotator_a.email).within(() => {
        cy.contains("button", "Cancel assignment").click();
      });
      cy.get('[data-testid="assignment-empty"]').should("exist");

      cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());
      cy.request({
        url: `/api/tasks/${fixture.tasks.c.id}/annotations/`,
        method: "POST",
        failOnStatusCode: false,
        body: {
          result: [],
          assignment_id: oldAssignment.id,
          assignment_version: oldAssignment.version,
        },
      }).then((staleWrite) => {
        expect([403, 404, 409]).to.include(staleWrite.status);
      });

      openTaskAs(fixture.users.manager.email);
      openAssignmentManager();
      cy.get('[data-testid="assignment-assignee-select"]').select(String(fixture.users.annotator_b.id));
      cy.contains("button", "Assign").click();
      cy.contains('[data-testid^="assignment-"]', fixture.users.annotator_b.email).should("exist");

      cy.loginAs(fixture.users.annotator_b.email, fixture.password, dataPage());
      cy.request(`/api/tasks/${fixture.tasks.c.id}/`).its("status").should("eq", 200);
    });
  });

  it("does not expose assignment mutation controls to a reviewer", () => {
    openTaskAs(fixture.users.reviewer.email);
    cy.get('[data-testid="manage-task-assignments"]').should("not.exist");
  });
});

export {};
