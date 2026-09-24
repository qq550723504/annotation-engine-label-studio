/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: {
    manager: { id: number; email: string };
    annotator_a: { id: number; email: string };
    annotator_b: { id: number; email: string };
    reviewer: { id: number; email: string };
    candidate_annotator: { id: number; email: string };
    candidate_reviewer: { id: number; email: string };
  };
};

describe("project member and role management UI", () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile(".enterprise-e2e.json").then((data) => {
      fixture = data as Fixture;
    });
  });

  const settingsPage = () => `/projects/${fixture.project_id}/settings/`;
  const membersPage = () => `/projects/${fixture.project_id}/settings/members`;

  const openProjectSettings = (email: string) => {
    cy.loginAs(email, fixture.password, settingsPage());
    cy.visit(settingsPage());
    cy.location("pathname", { timeout: 30000 }).should("eq", settingsPage());
    cy.get("body").should("be.visible");
  };

  const openAsManager = () => {
    openProjectSettings(fixture.users.manager.email);
    cy.contains("a", "Members", { timeout: 30000 }).should("be.visible").click();
    cy.location("pathname", { timeout: 30000 }).should("eq", membersPage());
    cy.get('[data-testid="project-members-settings"]', { timeout: 30000 }).should("be.visible");
  };

  it("lets a manager add annotator/reviewer members and mutate authoritative state", () => {
    openAsManager();

    cy.get('[data-testid="member-user-select"]').select(String(fixture.users.candidate_annotator.id));
    cy.get('[data-testid="member-role-select"]').select("annotator");
    cy.contains("button", "Add member").click();

    cy.contains("tr", fixture.users.candidate_annotator.email)
      .should("contain.text", "Enabled")
      .find('[data-testid^="member-role-"]')
      .should("have.value", "annotator");

    cy.get('[data-testid="member-user-select"]').select(String(fixture.users.candidate_reviewer.id));
    cy.get('[data-testid="member-role-select"]').select("reviewer");
    cy.contains("button", "Add member").click();

    cy.contains("tr", fixture.users.candidate_reviewer.email)
      .should("contain.text", "Enabled")
      .find('[data-testid^="member-role-"]')
      .should("have.value", "reviewer");

    cy.get(`[data-testid="member-role-${fixture.users.candidate_annotator.id}"]`).select("reviewer");
    cy.get(`[data-testid="member-role-${fixture.users.candidate_annotator.id}"]`).should("have.value", "reviewer");

    cy.contains("tr", fixture.users.candidate_annotator.email).within(() => {
      cy.contains("button", "Disable").click();
    });
    cy.contains("tr", fixture.users.candidate_annotator.email).should("contain.text", "Disabled");

    cy.contains("tr", fixture.users.candidate_annotator.email).within(() => {
      cy.contains("button", "Enable").click();
    });
    cy.contains("tr", fixture.users.candidate_annotator.email).should("contain.text", "Enabled");

    cy.contains("tr", fixture.users.candidate_annotator.email).within(() => {
      cy.contains("button", "Remove").click();
    });
    cy.contains("tr", fixture.users.candidate_annotator.email).should("not.exist");

    cy.contains("tr", fixture.users.candidate_reviewer.email).within(() => {
      cy.contains("button", "Remove").click();
    });
    cy.contains("tr", fixture.users.candidate_reviewer.email).should("not.exist");
  });

  it("shows real backend validation and never reports a failed mutation as success", () => {
    openAsManager();

    cy.get('[data-testid="member-user-select"]').select(String(fixture.users.candidate_annotator.id));

    cy.request("POST", `/api/projects/${fixture.project_id}/members/`, {
      user_id: fixture.users.candidate_annotator.id,
      role: "annotator",
      enabled: true,
    }).then((created) => {
      expect(created.status).to.eq(201);

      cy.contains("button", "Add member").click();
      cy.get('[data-testid="members-error"]')
        .should("be.visible")
        .and("contain.text", "already a member");

      cy.contains("tr", fixture.users.candidate_annotator.email).should("not.exist");

      cy.request(
        "DELETE",
        `/api/projects/${fixture.project_id}/members/${created.body.id}/`,
      ).its("status").should("eq", 204);
    });
  });

  for (const actor of ["annotator_a", "reviewer"] as const) {
    it(`does not expose member management to ${actor}`, () => {
      openProjectSettings(fixture.users[actor].email);
      cy.contains("a", "Members").should("not.exist");
      cy.get('[data-testid="project-members-settings"]').should("not.exist");

      cy.request({
        url: `/api/projects/${fixture.project_id}/members/`,
        failOnStatusCode: false,
      }).its("status").should("eq", 403);
    });
  }
});

export {};
