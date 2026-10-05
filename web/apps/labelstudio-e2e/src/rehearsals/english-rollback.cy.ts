/// <reference types="cypress" />

type Actor = 'manager' | 'annotator_a' | 'annotator_b' | 'reviewer';
type Fixture = {
  password: string;
  project_id: number;
  users: Record<Actor, { id: number; email: string }>;
  tasks: { a: { id: number }; b: { id: number } };
};
type SavedSessions = Record<'manager' | 'annotator_a', string>;
type Released = { submission_id: number; revision: number; result_hash: string; result_snapshot: unknown };

const phase = Cypress.env('rollbackPhase');
if (!['prepare', 'rollback', 'restore'].includes(phase)) throw new Error('An explicit rollbackPhase is required.');

describe(`installed wheel English rollback: ${phase}`, () => {
  let fixture: Fixture;
  const dataDir = '/data';
  const sessionsFile = `${dataDir}/browser-sessions.json`;
  const releaseFile = `${dataDir}/browser-release.json`;
  const page = () => `/projects/${fixture.project_id}/data`;
  const taskPage = () => `${page()}?task=${fixture.tasks.a.id}`;
  const closeModal = () => cy.get('button[aria-label="Close modal"], button[aria-label="关闭弹窗"]').first().click();

  before(() => {
    cy.readFile(`${dataDir}/fixture.json`, { log: false }).then((data) => { fixture = data; });
  });

  const readApi = (url: string) => cy.request({ url, log: false, failOnStatusCode: false }).then((response) => {
    expect(response.status, `GET ${url} status`).to.eq(200);
    return response;
  });

  // Keep the earlier actor's server session alive for the cross-version check.
  // cy.session unloads the previous document before clearing browser state;
  // each setup uses the real CSRF-protected form without logging out that actor.
  const signIn = (actor: Actor, path = page()) => {
    cy.session(['rollback-login', phase, actor, path], () => {
      cy.visit(`/user/login/?next=${encodeURIComponent(path)}`);
      cy.location('pathname').should('eq', '/user/login/');
      cy.get('#email').type(fixture.users[actor].email);
      cy.get('#password').type(fixture.password, { log: false });
      cy.get('form button[type="submit"]').click();
      cy.location('pathname', { timeout: 30000 }).should('eq', path.split('?')[0]);
    }, {
      validate() {
        readApi('/api/current-user/whoami').its('body.id').should('eq', fixture.users[actor].id);
      },
    });
    cy.visit(path);
    cy.location('pathname', { timeout: 30000 }).should('eq', path.split('?')[0]);
    readApi('/api/current-user/whoami').its('body.id').should('eq', fixture.users[actor].id);
  };

  const restoreSession = (actor: 'manager' | 'annotator_a', sessions: SavedSessions) => {
    cy.session(['preserved-browser-session', actor], () => {
      cy.setCookie('sessionid', sessions[actor], { log: false });
      cy.setCookie('ls_ui_locale', 'zh-CN', { log: false });
      readApi('/api/current-user/whoami').then((response) => {
        expect(response.body.id).to.eq(fixture.users[actor].id);
      });
    });
  };

  const readyEditor = () => {
    cy.window({ timeout: 30000 }).should((win) => {
      const annotation = win.Htx?.annotationStore?.selected;
      expect(Number(win.Htx?.task?.id), 'editor task').to.eq(fixture.tasks.a.id);
      expect(win.Htx?.isLoading, 'editor initialization complete').to.eq(false);
      expect(annotation?.editable, 'editable annotation').to.eq(true);
      expect(annotation?.history?.isFrozen, 'history ready').to.eq(false);
      expect(annotation?.autosave, 'autosave attached').to.be.a('function');
    });
  };

  const choose = (value: 'Positive' | 'Negative') => {
    readyEditor();
    const selector = `#label-studio-dm input[type="checkbox"][name="${value}"]`;
    cy.get(selector).should('not.be.disabled');
    cy.window().then((win) => { win.document.querySelector<HTMLInputElement>(selector)!.click(); });
    cy.get(selector).should('be.checked');
  };

  if (phase === 'prepare') {
    it('keeps two real browser sessions and a saved draft for the English wheel', () => {
      const sessions = {} as SavedSessions;
      signIn('manager');
      cy.get('html').should('have.attr', 'lang', 'zh-CN');
      cy.getCookie('sessionid', { log: false }).then((cookie) => { sessions.manager = cookie!.value; });
      signIn('annotator_a', taskPage());
      cy.get('html').should('have.attr', 'lang', 'zh-CN');
      choose('Positive');
      cy.window().then(async (win) => {
        const annotation = win.Htx.annotationStore.selected;
        annotation.autosave.cancel();
        await annotation.saveDraftImmediatelyWithResults();
      });
      readApi(`/api/tasks/${fixture.tasks.a.id}/drafts`).then((response) => {
        expect(response.body).to.have.length(1);
        expect(JSON.stringify(response.body[0].result)).to.contain('Positive');
      });
      readApi(`/api/tasks/${fixture.tasks.a.id}/`).its('body.annotations').should('have.length', 0);
      cy.getCookie('sessionid', { log: false }).then((cookie) => { sessions.annotator_a = cookie!.value; });
      cy.then(() => cy.writeFile(sessionsFile, sessions, { log: false }));
      cy.task('installedRollbackCheck', 'browser-checkpoint');
    });
  } else if (phase === 'rollback') {
    it('uses preserved sessions and draft in English, reviews two revisions, and rejects revoked stale writes', () => {
      cy.task('installedRollbackCheck', 'browser-verify');
      cy.readFile(sessionsFile, { log: false }).then((sessions: SavedSessions) => {
        restoreSession('manager', sessions);
        cy.visit(page());
        cy.get('html').should('have.attr', 'lang', 'en');
        cy.get('[data-testid="menu-language-select"]').should('not.exist');
        restoreSession('annotator_a', sessions);
      });
      cy.visit(taskPage());
      cy.get('html').should('have.attr', 'lang', 'en');
      readyEditor();
      cy.get('#label-studio-dm input[name="Positive"]').should('be.checked');
      cy.request({ url: `/api/tasks/${fixture.tasks.b.id}/`, failOnStatusCode: false }).its('status').should('eq', 404);

      let savedDraftId: number;
      cy.readFile(`${dataDir}/browser-rollback-checkpoint.json`).then((checkpoint) => {
        expect(checkpoint.drafts).to.have.length(1);
        savedDraftId = checkpoint.drafts[0].id;
        cy.window().should((win) => {
          expect(win.Htx.annotationStore.selected.draftId, 'restored draft id').to.eq(savedDraftId);
        });
      });
      let annotationId: number;
      let revision1Id: number;
      let revision1Hash: string;
      let revision2Id: number;
      cy.intercept('POST', `**/api/tasks/${fixture.tasks.a.id}/annotations*`).as('revision1');
      cy.get('[data-testid="bottombar-submit-button"]').click();
      cy.wait('@revision1').then((entry) => {
        expect(entry.response?.statusCode).to.be.oneOf([200, 201]);
        expect(entry.request.body.draft_id, 'submitted preserved draft').to.eq(savedDraftId);
        annotationId = entry.response!.body.id;
      });
      readApi(`/api/tasks/${fixture.tasks.a.id}/drafts`).its('body').should('have.length', 0);

      signIn('reviewer');
      cy.request({ url: `/api/tasks/${fixture.tasks.a.id}/`, failOnStatusCode: false }).its('status').should('eq', 404);
      readApi(`/api/submissions/?project=${fixture.project_id}`).then((response) => {
        // The authoritative annotation ID comes from the real Editor submission.
        const submission = response.body.find((item) => item.annotation === annotationId && item.revision === 1);
        expect(submission, 'new revision 1').to.exist;
        expect(submission.revision).to.eq(1);
        expect(submission.status).to.eq('pending');
        revision1Id = submission.id;
        revision1Hash = submission.result_hash;
      });
      cy.get('[data-testid="open-review-workspace"]').click();
      cy.then(() => cy.get(`[data-testid="review-submission-${revision1Id}"]`).click());
      cy.get('[data-testid="review-result-snapshot"]').should('contain.text', 'Positive');
      cy.get('[data-testid="review-reject-reason"]').type('English rollback correction');
      cy.get('[data-testid="review-reject"]').click();
      cy.then(() => cy.get(`[data-testid="review-history-${revision1Id}"]`).should('contain.text', 'rejected'));
      closeModal();

      signIn('annotator_a', taskPage());
      cy.then(() => cy.get(`[data-annotation-id="${annotationId}"]`).click());
      cy.get('#label-studio-dm input[name="Positive"]').should('be.checked');
      choose('Negative');
      cy.intercept('PATCH', '**/api/annotations/**').as('revision2');
      cy.get('[data-testid="bottombar-update-button"]').click();
      cy.wait('@revision2').its('response.statusCode').should('eq', 200);

      signIn('reviewer');
      cy.then(() => readApi(`/api/submissions/${revision1Id}/`).then((response) => {
        expect(response.body.status).to.eq('rejected');
        expect(response.body.result_hash).to.eq(revision1Hash);
        expect(JSON.stringify(response.body.result_snapshot)).to.contain('Positive');
      }));
      readApi(`/api/submissions/?project=${fixture.project_id}`).then((response) => {
        const row = response.body.find((item) => item.annotation === annotationId && item.revision === 2);
        expect(row, 'new pending revision 2').to.exist;
        expect(row.status).to.eq('pending');
        revision2Id = row.id;
        expect(JSON.stringify(row.result_snapshot)).to.contain('Negative');
      });
      cy.get('[data-testid="open-review-workspace"]').click();
      cy.then(() => cy.get(`[data-testid="review-submission-${revision2Id}"]`).click());
      cy.get('[data-testid="review-approve"]').click();
      cy.get('[data-testid="review-status"]').should('contain.text', 'approved');
      closeModal();

      signIn('manager');
      cy.get('[data-testid="open-release-workspace"]').click();
      cy.then(() => cy.get(`[data-testid="release-submission-${revision2Id}"]`).click());
      cy.get('[data-testid="release-result-snapshot"]').should('contain.text', 'Negative');
      cy.get('[data-testid="release-approved-submission"]').click();
      cy.get('[data-testid="release-success"]').should('contain.text', 'Released revision 2');
      cy.then(() => readApi(`/api/submissions/${revision2Id}/release/`).then((response) => {
        expect(response.body.submission_id).to.eq(revision2Id);
        expect(response.body.revision).to.eq(2);
        cy.writeFile(releaseFile, response.body);
      }));
      closeModal();

      signIn('annotator_a', taskPage());
      cy.then(() => cy.get(`[data-annotation-id="${annotationId}"]`).click());
      choose('Positive');
      cy.window().then(async (win) => {
        const annotation = win.Htx.annotationStore.selected;
        annotation.autosave.cancel();
        await annotation.saveDraftImmediatelyWithResults();
      });
      readApi(`/api/tasks/${fixture.tasks.a.id}/drafts`).then((response) => {
        expect(response.body).to.have.length(1);
        expect(JSON.stringify(response.body[0].result)).to.contain('Positive');
      });
      cy.get('[data-testid="bottombar-update-button"]').should('not.be.disabled');
      cy.task('installedRollbackCheck', 'browser-checkpoint');
      cy.task('installedRollbackCheck', 'browser-revoke');
      cy.intercept('PATCH', '**/api/annotations/**').as('revokedWrite');
      cy.get('[data-testid="bottombar-update-button"]').click();
      cy.wait('@revokedWrite').its('response.statusCode').should('eq', 401);
      cy.task('installedRollbackCheck', 'browser-verify');
    });
  } else {
    it('restores retained Chinese preferences and the same approved immutable release', () => {
      cy.task('installedRollbackCheck', 'browser-verify');
      cy.readFile(sessionsFile, { log: false }).then((sessions: SavedSessions) => {
        for (const actor of ['manager', 'annotator_a'] as const) {
          cy.clearCookies({ log: false });
          cy.setCookie('sessionid', sessions[actor], { log: false });
          cy.request({ url: '/api/current-user/whoami', log: false, failOnStatusCode: false })
            .its('status').should('eq', 401);
        }
      });
      signIn('manager');
      cy.get('html').should('have.attr', 'lang', 'zh-CN');
      readApi('/api/current-user/locale/').its('body').should('include', { resolvedLocale: 'zh-CN', source: 'user' });
      cy.readFile(releaseFile).then((released: Released) => {
        readApi(`/api/submissions/${released.submission_id}/release/`).its('body').should('deep.eq', released);
        cy.get('[data-testid="open-release-workspace"]').click();
        cy.get(`[data-testid="release-submission-${released.submission_id}"]`).click();
        cy.get('[data-testid="release-result-hash"]').should('contain.text', released.result_hash);
        cy.get('[data-testid="release-result-snapshot"]').should('contain.text', 'Negative');
      });
      signIn('annotator_a');
      cy.get('html').should('have.attr', 'lang', 'zh-CN');
      cy.request(`/api/tasks/${fixture.tasks.a.id}/`).its('status').should('eq', 200);
      cy.request({ url: `/api/tasks/${fixture.tasks.b.id}/`, failOnStatusCode: false }).its('status').should('eq', 404);
      cy.task('installedRollbackCheck', 'browser-verify');
    });
  }
});

export {};
