/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: {
    annotator_a: { id: number; email: string };
    reviewer: { id: number; email: string };
  };
  tasks: {
    review: {
      id: number;
      assignment_id: number;
      submission_id: number;
      annotation_id: number;
    };
  };
};

describe("immutable submission reviewer workspace", () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile(".enterprise-e2e.json").then((data) => {
      fixture = data as Fixture;
    });
  });

  const dataPage = () => `/projects/${fixture.project_id}/data`;

  const openReviewsAs = (email: string) => {
    cy.loginAs(email, fixture.password, dataPage());
    cy.visit(dataPage());
    cy.location("pathname", { timeout: 30000 }).should("eq", dataPage());
    cy.get('[data-testid="open-review-workspace"]', { timeout: 30000 }).should("be.visible").click();
    cy.get('[data-testid="reviewer-workspace"]', { timeout: 30000 }).should("exist");
  };

  const closeReviews = () => {
    cy.get('[data-testid="reviewer-workspace"]').should("exist");
    cy.get('button[aria-label="Close modal"]').first().click();
    cy.get('[data-testid="reviewer-workspace"]').should("not.exist");
  };

  it("rejects revision 1, preserves its immutable history, and approves revision 2", () => {
    openReviewsAs(fixture.users.reviewer.email);

    cy.get(`[data-testid="review-submission-${fixture.tasks.review.submission_id}"]`).click();
    cy.contains("Submission", `revision 1`).should("exist");
    cy.get('[data-testid="review-result-snapshot"]').should("contain.text", "Positive");
    cy.get('[data-testid="review-result-hash"]').invoke("text").as("revision1Hash");

    cy.request({
      url: `/api/annotations/${fixture.tasks.review.annotation_id}/`,
      method: "PATCH",
      failOnStatusCode: false,
      body: { result: [] },
    }).its("status").should("eq", 403);

    cy.get('[data-testid="review-reject"]').click();
    cy.get('[data-testid="review-error"]').should("contain.text", "rejection reason");

    cy.get('[data-testid="review-reject-reason"]').type("Needs correction");
    cy.get('[data-testid="review-reject"]').click();

    cy.get(`[data-testid="review-history-${fixture.tasks.review.submission_id}"]`, { timeout: 30000 })
      .should("exist")
      .and("contain.text", "rejected");
    cy.get('[data-testid="review-status"]').should("contain.text", "rejected");
    cy.get('[data-testid="review-result-snapshot"]').should("contain.text", "Positive");
    cy.get('[data-testid="review-approve"]').should("not.exist");

    cy.task("createEnterpriseE2ESubmission", {
      taskId: fixture.tasks.review.id,
      actor: "annotator_a",
    });

    closeReviews();
    cy.get('[data-testid="open-review-workspace"]').click();
    cy.get('[data-testid="reviewer-workspace"]', { timeout: 30000 }).should("exist");

    cy.contains('[data-testid^="review-submission-"]', "Revision 2", { timeout: 30000 }).click();
    cy.get('[data-testid="review-status"]').should("contain.text", "pending");
    cy.get('[data-testid="review-result-snapshot"]').should("contain.text", "Negative");
    cy.get('[data-testid="review-result-hash"]').invoke("text").then((revision2Hash) => {
      cy.get("@revision1Hash").then((revision1Hash) => {
        expect(revision2Hash.trim()).not.to.eq(String(revision1Hash).trim());
      });
    });
    cy.contains('[data-testid^="review-history-"]', "Revision 1")
      .should("exist")
      .and("contain.text", "rejected");

    cy.get('[data-testid="review-approve"]').click();
    cy.get('[data-testid="review-status"]', { timeout: 30000 }).should("contain.text", "approved");
    cy.get('[data-testid="review-approve"]').should("not.exist");

    closeReviews();
    cy.loginAs(fixture.users.annotator_a.email, fixture.password, dataPage());
    cy.visit(dataPage());
    cy.get('[data-testid="open-review-workspace"]').should("not.exist");

    cy.request({
      url: `/api/submissions/${fixture.tasks.review.submission_id}/review/`,
      method: "POST",
      failOnStatusCode: false,
      body: { decision: "approved" },
    }).its("status").should("eq", 403);
  });
});

export {};
