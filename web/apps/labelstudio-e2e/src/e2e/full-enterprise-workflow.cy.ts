/// <reference types="cypress" />

type Fixture = {
  password: string;
  users: {
    manager: { id: number; email: string };
    annotator_a: { id: number; email: string };
    annotator_b: { id: number; email: string };
    reviewer: { id: number; email: string };
  };
  full_flow: {
    project_id: number;
    tasks: {
      a: { id: number };
      b: { id: number };
      stale: { id: number };
    };
  };
};

describe("full enterprise collaboration browser workflow", () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile(".enterprise-e2e.json").then((data) => {
      fixture = data as Fixture;
    });
  });

  const projectId = () => fixture.full_flow.project_id;
  const dataPage = () => `/projects/${projectId()}/data`;
  const settingsPage = () => `/projects/${projectId()}/settings/`;
  const membersPage = () => `/projects/${projectId()}/settings/members`;

  const loginActor = (email: string, nextPath: string) => {
    cy.visit("/logout");
    cy.location("pathname", { timeout: 30000 }).should("eq", "/user/login/");
    cy.loginAs(email, fixture.password, nextPath);
  };

  const loginAndVisit = (email: string, path: string) => {
    loginActor(email, path);
    cy.visit(path);
    cy.location("pathname", { timeout: 30000 }).should("eq", path.split("?")[0]);
  };

  const openTaskPanel = (email: string, taskId: number) => {
    loginActor(email, dataPage());
    cy.visit(`${dataPage()}?task=${taskId}`);
    cy.location("pathname", { timeout: 30000 }).should("eq", dataPage());
    cy.window({ timeout: 30000 }).should((win) => {
      expect(win.dataManager?.store?.taskStore?.selected?.id).to.eq(taskId);
    });
  };

  const addMember = (userId: number, role: "annotator" | "reviewer") => {
    cy.get('[data-testid="member-user-select"]').select(String(userId));
    cy.get('[data-testid="member-role-select"]').select(role);
    cy.contains("button", "Add member").click();
  };

  const openAssignmentManager = (taskId: number) => {
    openTaskPanel(fixture.users.manager.email, taskId);
    cy.get('[data-testid="manage-task-assignments"]', { timeout: 30000 })
      .should("be.visible")
      .and("not.be.disabled")
      .click();
    cy.get('[data-testid="assignment-manager"]', { timeout: 30000 }).should("exist");
  };

  const assignTask = (taskId: number, assigneeId: number, email: string) => {
    openAssignmentManager(taskId);
    cy.get('[data-testid="assignment-assignee-select"]').select(String(assigneeId));
    cy.get('[data-testid="assignment-submit"]').click();
    cy.contains('[data-testid^="assignment-row-"]', email)
      .should("exist")
      .and("contain.text", "assigned");
    cy.get('button[aria-label="Close modal"]').first().click();
    cy.get('[data-testid="assignment-manager"]').should("not.exist");
  };

  const openAssignedEditor = (email: string, taskId: number, taskText: string) => {
    openTaskPanel(email, taskId);
    cy.contains(taskText, { timeout: 30000 }).should("be.visible");
    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should("be.visible");
  };

  const reopenAssignedEditor = (email: string, taskId: number, taskText: string) => {
    openTaskPanel(email, taskId);
    cy.contains(taskText, { timeout: 30000 }).should("be.visible");
    cy.get('[data-testid="bottombar-update-button"], [data-testid="bottombar-submit-button"]', {
      timeout: 30000,
    }).should("be.visible");
  };

  const choose = (value: "Positive" | "Negative") => {
    cy.contains("span", value, { timeout: 30000 }).click();
  };

  const closeModal = () => {
    cy.get('button[aria-label="Close modal"]').first().click();
  };

  const assertRestrictedManagerWrites = () => {
    cy.request({
      url: `/api/projects/${projectId()}/export`,
      failOnStatusCode: false,
    }).its("status").should("be.oneOf", [403, 404]);

    cy.request({
      url: "/api/storages/s3/",
      method: "POST",
      failOnStatusCode: false,
      body: {
        project: projectId(),
        bucket: "full-flow-denied",
        title: "should-not-create",
      },
    }).its("status").should("be.oneOf", [403, 404]);

    cy.request({
      url: "/api/webhooks/",
      method: "POST",
      failOnStatusCode: false,
      body: {
        project: projectId(),
        url: "http://127.0.0.1:9/full-flow-denied",
      },
    }).its("status").should("be.oneOf", [403, 404]);

    cy.request({
      url: `/api/dm/actions/?project=${projectId()}`,
      method: "POST",
      failOnStatusCode: false,
      body: {},
    }).its("status").should("be.oneOf", [403, 404]);
  };

  it("runs Manager -> Assign -> Annotate -> Reject -> Revise -> Approve -> Release -> Revoke", () => {
    // 1-4: Manager adds isolated project members and roles through UI.
    loginAndVisit(fixture.users.manager.email, settingsPage());
    cy.contains("a", "Members", { timeout: 30000 }).click();
    cy.location("pathname", { timeout: 30000 }).should("eq", membersPage());
    cy.get('[data-testid="project-members-settings"]', { timeout: 30000 }).should("be.visible");

    addMember(fixture.users.annotator_a.id, "annotator");
    cy.contains("tr", fixture.users.annotator_a.email).should("contain.text", "Enabled");

    addMember(fixture.users.annotator_b.id, "annotator");
    cy.contains("tr", fixture.users.annotator_b.email).should("contain.text", "Enabled");

    addMember(fixture.users.reviewer.id, "reviewer");
    cy.contains("tr", fixture.users.reviewer.email).should("contain.text", "Enabled");

    // 5-6: Manager assigns tasks through the product UI.
    assignTask(fixture.full_flow.tasks.a.id, fixture.users.annotator_a.id, fixture.users.annotator_a.email);
    assignTask(fixture.full_flow.tasks.b.id, fixture.users.annotator_b.id, fixture.users.annotator_b.email);

    // 7-11: task isolation and reviewer labeling denial.
    loginAndVisit(fixture.users.annotator_a.email, dataPage());
    cy.request(`/api/tasks/${fixture.full_flow.tasks.a.id}/`).its("status").should("eq", 200);
    cy.request({ url: `/api/tasks/${fixture.full_flow.tasks.b.id}/`, failOnStatusCode: false })
      .its("status").should("eq", 404);
    assertRestrictedManagerWrites();

    loginAndVisit(fixture.users.annotator_b.email, dataPage());
    cy.request(`/api/tasks/${fixture.full_flow.tasks.b.id}/`).its("status").should("eq", 200);
    cy.request({ url: `/api/tasks/${fixture.full_flow.tasks.a.id}/`, failOnStatusCode: false })
      .its("status").should("eq", 404);

    loginAndVisit(fixture.users.reviewer.email, dataPage());
    cy.request({ url: `/api/tasks/${fixture.full_flow.tasks.a.id}/`, failOnStatusCode: false })
      .its("status").should("eq", 404);
    cy.contains("button", /Label All Tasks/i).should("not.exist");

    // 12-14: Annotator A edits in the real Editor; draft exists before explicit Submit.
    openAssignedEditor(
      fixture.users.annotator_a.email,
      fixture.full_flow.tasks.a.id,
      "Full flow Annotator A task",
    );
    cy.intercept("POST", `**/api/tasks/${fixture.full_flow.tasks.a.id}/drafts*`).as("draftRevision1");
    choose("Positive");

    cy.wait("@draftRevision1", { timeout: 30000 }).its("response.statusCode").should("be.oneOf", [200, 201]);
    cy.request(`/api/tasks/${fixture.full_flow.tasks.a.id}/drafts`).then((drafts) => {
      expect(drafts.status).to.eq(200);
      expect(drafts.body.length).to.be.greaterThan(0);
    });
    cy.request(`/api/submissions/?project=${projectId()}`).then((submissions) => {
      expect(submissions.status).to.eq(200);
      expect(submissions.body).to.have.length(0);
    });

    cy.intercept("POST", `**/api/tasks/${fixture.full_flow.tasks.a.id}/annotations*`).as("submitRevision1");
    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should("be.visible").click();
    cy.wait("@submitRevision1").its("response.statusCode").should("be.oneOf", [200, 201]);

    let revision1Id: number;
    let revision1Hash: string;
    cy.request(`/api/submissions/?project=${projectId()}`).then((submissions) => {
      expect(submissions.status).to.eq(200);
      expect(submissions.body).to.have.length(1);
      expect(submissions.body[0].revision).to.eq(1);
      expect(submissions.body[0].status).to.eq("pending");
      expect(submissions.body[0].submitted_by.id).to.eq(fixture.users.annotator_a.id);
      revision1Id = submissions.body[0].id;
      revision1Hash = submissions.body[0].result_hash;
    });

    // 15-16: Reviewer rejects revision 1 in the browser workspace.
    loginAndVisit(fixture.users.reviewer.email, dataPage());
    cy.get('[data-testid="open-review-workspace"]', { timeout: 30000 }).click();
    cy.get('[data-testid="reviewer-workspace"]', { timeout: 30000 }).should("exist");
    cy.then(() => {
      cy.get(`[data-testid="review-submission-${revision1Id}"]`).click();
    });
    cy.get('[data-testid="review-result-snapshot"]').should("contain.text", "Positive");
    cy.get('[data-testid="review-reject-reason"]').type("Full flow correction required");
    cy.get('[data-testid="review-reject"]').click();
    cy.then(() => {
      cy.get(`[data-testid="review-history-${revision1Id}"]`, { timeout: 30000 })
        .should("contain.text", "rejected");
    });
    closeModal();

    // 17-20: Annotator A changes the real annotation and submits revision 2 through Editor Update.
    reopenAssignedEditor(
      fixture.users.annotator_a.email,
      fixture.full_flow.tasks.a.id,
      "Full flow Annotator A task",
    );
    choose("Negative");
    cy.intercept("PATCH", `**/api/annotations/**`).as("submitRevision2");
    cy.get('[data-testid="bottombar-update-button"]', { timeout: 30000 }).should("be.visible").click();
    cy.wait("@submitRevision2").its("response.statusCode").should("eq", 200);

    let revision2Id: number;
    let revision2Hash: string;
    cy.request(`/api/submissions/?project=${projectId()}`).then((submissions) => {
      expect(submissions.status).to.eq(200);
      const rows = submissions.body;
      expect(rows).to.have.length(2);
      const rev1 = rows.find((item) => item.revision === 1);
      const rev2 = rows.find((item) => item.revision === 2);
      expect(rev1.status).to.eq("rejected");
      expect(rev1.result_hash).to.eq(revision1Hash);
      expect(JSON.stringify(rev1.result_snapshot)).to.contain("Positive");
      expect(rev2.status).to.eq("pending");
      expect(JSON.stringify(rev2.result_snapshot)).to.contain("Negative");
      revision2Id = rev2.id;
      revision2Hash = rev2.result_hash;
      expect(revision2Hash).not.to.eq(revision1Hash);
    });

    loginAndVisit(fixture.users.reviewer.email, dataPage());
    cy.get('[data-testid="open-review-workspace"]', { timeout: 30000 }).click();
    cy.then(() => {
      cy.get(`[data-testid="review-submission-${revision2Id}"]`).click();
    });
    cy.get('[data-testid="review-result-snapshot"]').should("contain.text", "Negative");
    cy.get('[data-testid="review-approve"]').click();
    cy.get('[data-testid="review-status"]', { timeout: 30000 }).should("contain.text", "approved");
    closeModal();

    // 21-24: Manager sees immutable history and releases approved revision 2.
    loginAndVisit(fixture.users.manager.email, dataPage());
    cy.get('[data-testid="open-release-workspace"]', { timeout: 30000 }).click();
    cy.get('[data-testid="submission-release-workspace"]', { timeout: 30000 }).should("exist");

    cy.then(() => {
      cy.get(`[data-testid="release-submission-${revision1Id}"]`)
        .should("contain.text", "rejected")
        .click();
    });
    cy.get('[data-testid="release-approved-submission"]').should("not.exist");

    cy.then(() => {
      cy.get(`[data-testid="release-submission-${revision2Id}"]`)
        .should("contain.text", "approved")
        .click();
    });
    cy.then(() => {
      cy.get('[data-testid="release-result-hash"]').should("contain.text", revision2Hash);
      cy.get('[data-testid="release-result-snapshot"]').should("contain.text", "Negative");
      cy.get('[data-testid="release-approved-submission"]').click();
      cy.get('[data-testid="release-success"]', { timeout: 30000 })
        .should("contain.text", "Released revision 2")
        .and("contain.text", revision2Hash);
    });
    closeModal();

    // 25-29: prove Manager UI revocation, then exercise a truly stale writable Editor.
    loginAndVisit(fixture.users.manager.email, membersPage());
    cy.contains("tr", fixture.users.annotator_a.email).within(() => {
      cy.contains("button", "Disable").click();
    });
    cy.contains("tr", fixture.users.annotator_a.email).should("contain.text", "Disabled");
    cy.contains("tr", fixture.users.annotator_a.email).within(() => {
      cy.contains("button", "Enable").click();
    });
    cy.contains("tr", fixture.users.annotator_a.email).should("contain.text", "Enabled");

    // Use a fresh, never-annotated task so the active assignment is definitely writable before revocation.
    assignTask(
      fixture.full_flow.tasks.stale.id,
      fixture.users.annotator_a.id,
      fixture.users.annotator_a.email,
    );

    openAssignedEditor(
      fixture.users.annotator_a.email,
      fixture.full_flow.tasks.stale.id,
      "Full flow stale editor task",
    );

    cy.intercept("POST", `**/api/tasks/${fixture.full_flow.tasks.stale.id}/drafts*`).as("staleWritableDraft");
    choose("Positive");
    cy.wait("@staleWritableDraft", { timeout: 30000 })
      .its("response.statusCode")
      .should("be.oneOf", [200, 201]);

    cy.request(`/api/tasks/${fixture.full_flow.tasks.stale.id}/`).then((taskResponse) => {
      expect(taskResponse.status).to.eq(200);
      expect(taskResponse.body.assignment_id).to.be.a("number");
      expect(taskResponse.body.assignment_version).to.be.a("number");
    });

    // Keep this confirmed-writable real Editor open while membership is revoked out-of-band.
    cy.task("setEnterpriseE2EMember", {
      actor: "annotator_a",
      enabled: false,
      projectId: projectId(),
    });

    cy.intercept("POST", `**/api/tasks/${fixture.full_flow.tasks.stale.id}/annotations*`).as("staleSubmit");
    cy.get('[data-testid="bottombar-submit-button"]', { timeout: 30000 }).should("be.visible").click();
    cy.wait("@staleSubmit").then((interception) => {
      expect(interception.response?.statusCode).to.be.oneOf([403, 404, 409]);
      expect(interception.response?.statusCode).not.to.eq(500);
    });

    cy.request({
      url: `/api/tasks/${fixture.full_flow.tasks.stale.id}/`,
      failOnStatusCode: false,
    }).its("status").should("eq", 404);

    cy.reload();
    cy.get('[data-testid="bottombar-submit-button"]').should("not.exist");

    // 30-34: role separation / hardened mutation surfaces remain server-authoritative.
    cy.then(() => {
      cy.request({
        url: `/api/submissions/${revision2Id}/review/`,
        method: "POST",
        failOnStatusCode: false,
        body: { decision: "approved" },
      }).its("status").should("eq", 403);
    });
    cy.request({
      url: `/api/projects/${projectId()}/members/`,
      failOnStatusCode: false,
    }).its("status").should("be.oneOf", [403, 404]);
    loginAndVisit(fixture.users.reviewer.email, dataPage());
    cy.get('[data-testid="manage-task-assignments"]').should("not.exist");
    cy.get('[data-testid="open-release-workspace"]').should("not.exist");
    cy.contains("button", /Label All Tasks/i).should("not.exist");
    cy.request({
      url: `/api/task-assignments/?project=${projectId()}`,
      method: "POST",
      failOnStatusCode: false,
      body: { task: fixture.full_flow.tasks.a.id, assignee: fixture.users.annotator_b.id },
    }).its("status").should("eq", 403);
    cy.request({
      url: `/api/projects/${projectId()}/members/`,
      failOnStatusCode: false,
    }).its("status").should("eq", 403);
    assertRestrictedManagerWrites();

    // Restore membership for repeatable local reruns; assignment intentionally remains cancelled.
    cy.task("setEnterpriseE2EMember", {
      actor: "annotator_a",
      enabled: true,
      projectId: projectId(),
    });
  });
});

export {};
