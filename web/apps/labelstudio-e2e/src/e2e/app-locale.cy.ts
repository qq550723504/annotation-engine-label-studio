/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: {
    manager: { email: string };
    manager_b: { email: string };
  };
};

describe('main application display locale', () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile('.enterprise-e2e.json').then((data) => { fixture = data as Fixture; });
  });

  const chooseAccountLocale = (value: 'auto' | 'en-US' | 'zh-CN') => {
    cy.get('[data-testid="language-preference-select"]').select(value);
  };

  const ensureAccountLocale = (value: 'auto' | 'en-US' | 'zh-CN') => {
    cy.get('[data-testid="language-preference-select"]').then(($select) => {
      if ($select.val() !== value) chooseAccountLocale(value);
    });
    cy.get('[data-testid="language-preference-select"]').should('have.value', value);
  };

  it('switches anonymous login copy without clearing entered credentials', () => {
    cy.visit('/user/login/');
    cy.get('[data-testid="anonymous-language-select"]').should('be.visible');
    cy.get('#email').type('typed@example.com');
    cy.get('[data-testid="anonymous-language-select"]').select('zh-CN');
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.get('form button[type="submit"]').should('have.attr', 'aria-label', '登录');
    cy.get('#email').should('have.value', 'typed@example.com');
    cy.reload();
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.get('[data-testid="anonymous-language-select"]').should('have.value', 'zh-CN');
    cy.get('[data-testid="anonymous-language-select"]').select('auto');
    cy.get('[data-testid="anonymous-language-select"]').should('have.value', 'auto');
  });

  it('submits the Chinese login form and reaches the project list', () => {
    cy.visit('/user/login/?next=%2Fprojects');
    cy.get('[data-testid="anonymous-language-select"]').select('zh-CN');
    cy.get('form button[type="submit"]').should('have.attr', 'aria-label', '登录');
    cy.get('#email').type(fixture.users.manager_b.email);
    cy.get('#password').type(fixture.password, { log: false });
    cy.get('form button[type="submit"]').click();
    cy.location('pathname').should('eq', '/projects');
    // The authenticated preference or Accept-Language takes over after login.
    cy.get('body').should('contain.text', 'Enterprise Browser E2E');
  });

  it('saves a confirmed account preference and preserves unsaved profile values', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('auto');
    cy.get('input[name="first_name"]').should('be.visible').clear().type('Unsubmitted name');
    let profileWrites = 0;
    cy.intercept({ method: /POST|PATCH|PUT/, url: '**/api/users/**' }, () => { profileWrites += 1; });
    cy.intercept('PATCH', '**/api/current-user/locale*').as('saveLocale');
    chooseAccountLocale('zh-CN');
    cy.wait('@saveLocale').its('request.body').should('deep.equal', { preference: 'zh-CN' });
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.get('input[name="first_name"]').should('have.value', 'Unsubmitted name');
    cy.get('[data-testid="language-preference-select"]').should('have.value', 'zh-CN');
    cy.then(() => expect(profileWrites, 'locale switch must not save profile').to.eq(0));

    cy.reload();
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.get('[data-testid="language-preference-select"]').should('have.value', 'zh-CN');
    cy.visit('/projects');
    cy.get('[data-testid="create-project-context"]').should('contain.text', '创建');
    cy.get('body').should('contain.text', 'Enterprise Browser E2E');
  });

  it('keeps the confirmed locale on save failure, supports Automatic, and isolates another user', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.intercept({ method: 'PATCH', url: '**/api/current-user/locale*', times: 1 }, { statusCode: 503, body: { detail: 'synthetic failure' } }).as('failedLocale');
    chooseAccountLocale('en-US');
    cy.wait('@failedLocale');
    cy.get('[data-testid="account-language-preference"] [role="alert"]').should('contain.text', '无法保存语言设置');
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.get('[data-testid="language-preference-select"]').should('have.value', 'zh-CN');

    cy.intercept('PATCH', '**/api/current-user/locale*').as('clearPreference');
    chooseAccountLocale('auto');
    cy.wait('@clearPreference').its('request.body').should('deep.equal', { preference: null });
    cy.get('[data-testid="language-preference-select"]').should('have.value', 'auto');
    cy.loginAs(fixture.users.manager_b.email, fixture.password, '/user/account/personal-info');
    cy.get('[data-testid="language-preference-select"]').should('have.value', 'auto');
  });

  for (const [locale, copy] of [
    ['en-US', { create: 'Create', projectName: 'Project Name', general: 'General Settings', save: 'Save', import: 'Upload file', unsupported: 'The file type of raw_日本語.exe is not supported.' }],
    ['zh-CN', { create: '创建', projectName: '项目名称', general: '通用设置', save: '保存', import: '上传文件', unsupported: '不支持文件 raw_日本語.exe 的类型。' }],
  ] as const) {
    it(`completes the project creation and settings path in ${locale} without saving draft fields on language switch`, () => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      ensureAccountLocale(locale);
      cy.visit('/projects');
      cy.get('html').should('have.attr', 'lang', locale);
      cy.get('[data-testid="create-project-context"]').should('contain.text', copy.create).click();
      cy.get('label[for="project_name"]').should('contain.text', copy.projectName);
      const title = `Locale browser ${locale} ${Date.now()}`;
      cy.get('#project_name').should('not.have.value', '');
      cy.get('#project_name').clear().type(title);
      cy.get('#project_description').type('Raw description 日本語 123');
      cy.get('[data-testid="toggle-import"]').click();
      cy.get('button[aria-label]').filter(`[aria-label="${copy.import}"]`).should('be.visible');
      cy.get('#file-input').selectFile({ contents: Cypress.Buffer.from('x'), fileName: 'raw_日本語.exe', mimeType: 'application/octet-stream' }, { force: true });
      cy.get('[role="alert"]').should('contain.text', copy.unsupported);
      cy.get('[data-testid="toggle-name"]').click();
      cy.get('#project_name').should('have.value', title);
      cy.get('#project_description').should('have.value', 'Raw description 日本語 123');
      cy.get('button').contains(copy.save).click();
      cy.location('pathname').should('match', /^\/projects\/\d+\/data$/).then((pathname) => {
        const projectId = pathname.match(/\/projects\/(\d+)\//)?.[1];
        cy.visit(`/projects/${projectId}/settings`);
      });
      cy.get('h1').should('contain.text', copy.general);
      cy.get('input[name="title"]').should('have.value', title);
      cy.get('textarea[name="description"]').should('have.value', 'Raw description 日本語 123');
      cy.get('textarea[name="description"]').clear().type('Unsaved draft 日本語 456');
      let projectWrites = 0;
      cy.intercept({ method: /PATCH|PUT|POST/, url: '**/api/projects/**' }, () => { projectWrites += 1; });
      cy.get('[data-testid="user-menu-trigger"]').click();
      cy.get('[data-testid="menu-language-select"]').select(locale === 'en-US' ? 'zh-CN' : 'en-US');
      cy.get('html').should('have.attr', 'lang', locale === 'en-US' ? 'zh-CN' : 'en-US');
      cy.get('textarea[name="description"]').should('have.value', 'Unsaved draft 日本語 456');
      cy.then(() => expect(projectWrites, 'language switch must not submit project').to.eq(0));
    });
  }

  for (const [locale, emptyTitle] of [
    ['en-US', "Heidi doesn't see any projects here!"],
    ['zh-CN', '这里还没有项目！'],
  ] as const) {
    it(`shows the translated empty project state in ${locale}`, () => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      ensureAccountLocale(locale);
      cy.intercept('GET', '**/api/projects*', { statusCode: 200, body: { count: 0, results: [] } }).as('emptyProjects');
      cy.visit('/projects');
      cy.wait('@emptyProjects');
      cy.get('[data-testid="empty-projects-header"]').should('have.text', emptyTitle);
      cy.get('[data-testid="create-project-empty"]').should('be.visible');
    });
  }

  it('uses a controlled Chinese fallback for a server error without a language header', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.intercept('GET', '**/api/projects*', { statusCode: 503, body: { detail: 'untrusted English detail' } }).as('failedProjects');
    cy.visit('/projects');
    cy.wait('@failedProjects');
    cy.get('body').should('contain.text', '请求未能完成，请重试。');
    cy.get('body').should('not.contain.text', 'untrusted English detail');
  });

  it('shows the current-language fallback when another tab changes the server locale', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.intercept('GET', '**/api/projects*', {
      statusCode: 503,
      headers: { 'content-language': 'en-US' },
      body: {
        detail: 'untrusted English detail',
        exc_info: 'internal traceback',
        validation_errors: { title: ['untrusted validation'] },
      },
    }).as('failedProjects');
    cy.visit('/projects');
    cy.wait('@failedProjects');
    cy.get('body').should('contain.text', '请求未能完成，请重试。')
      .and('not.contain.text', 'untrusted English detail')
      .and('not.contain.text', 'internal traceback')
      .and('not.contain.text', 'untrusted validation');
  });

  it('keeps profile update errors in the active language', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.intercept('PATCH', '**/api/users/*', {
      statusCode: 400,
      headers: { 'content-language': 'en-US' },
      body: { detail: 'untrusted English profile detail' },
    }).as('profileRejected');
    cy.get('input[name="first_name"]').clear().type('Unsaved profile name');
    cy.get('input[name="first_name"]').closest('form').find('button').contains('保存').click();
    cy.wait('@profileRejected');
    cy.get('body').should('contain.text', '无法更新个人资料。')
      .and('not.contain.text', 'untrusted English profile detail');
  });

  it('keeps configuration validation errors in the active language', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.intercept('POST', '**/api/projects/*/validate', {
      statusCode: 400,
      headers: { 'content-language': 'en-US' },
      body: { detail: 'untrusted English config detail', validation_errors: { label_config: ['untrusted English validation'] } },
    }).as('configRejected');
    cy.visit(`/projects/${fixture.project_id}/settings/labeling`);
    cy.wait('@configRejected');
    cy.get('body').should('contain.text', '无法验证标注配置，请检查后重试。')
      .and('not.contain.text', 'untrusted English config detail')
      .and('not.contain.text', 'untrusted English validation');
  });

  it('localizes fixed project settings breadcrumbs without changing the project title', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.visit(`/projects/${fixture.project_id}/settings/danger-zone`);
    cy.get('.lsf-breadcrumbs').should('contain.text', '危险操作').and('not.contain.text', 'Danger Zone');
    cy.get('.lsf-breadcrumbs').should('contain.text', 'Enterprise Browser E2E');
  });

  for (const [locale, titleError] of [
    ['en-US', 'The project name is too long.'],
    ['zh-CN', '项目名称过长。'],
  ] as const) {
    it(`shows actionable project-name validation in ${locale}`, () => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      ensureAccountLocale(locale);
      cy.visit('/projects');
      cy.get('[data-testid="create-project-context"]').click();
      cy.intercept('PATCH', '**/api/projects/*', {
        statusCode: 400,
        headers: { 'content-language': locale },
        body: { validation_errors: { title: [titleError] }, exc_info: 'internal traceback' },
      }).as('nameRejected');
      cy.get('#project_name').clear().type('Invalid project name');
      cy.get('#project_description').click();
      cy.wait('@nameRejected');
      cy.get('[role="alert"]').should('contain.text', titleError)
        .and('not.contain.text', 'internal traceback');
    });
  }

  it('shows a controlled error when saving a project name loses its response', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('en-US');
    cy.visit('/projects');
    cy.get('[data-testid="create-project-context"]').click();
    cy.intercept('PATCH', '**/api/projects/*', { forceNetworkError: true }).as('nameNetworkError');
    cy.get('#project_name').clear().type('Unsaved project name');
    cy.get('#project_description').click();
    cy.wait('@nameNetworkError');
    cy.get('#project_name').closest('form').find('[role="alert"]')
      .should('contain.text', 'Could not save the project name');
  });

  for (const [locale, detail, fieldError] of [
    ['en-US', 'The CSV header is invalid.', 'Column text is required.'],
    ['zh-CN', 'CSV 表头无效。', '缺少 text 列。'],
  ] as const) {
    it(`shows actionable import validation in ${locale} without exposing internal error data`, () => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      ensureAccountLocale(locale);
      cy.intercept({ method: 'POST', pathname: `/api/projects/${fixture.project_id}/import` }, {
        statusCode: 400,
        headers: { 'content-language': locale },
        body: { detail, validation_errors: { data: [fieldError] }, exc_info: 'internal traceback' },
      }).as('importRejected');
      cy.visit(`/projects/${fixture.project_id}/data/import`);
      cy.get('#file-input').selectFile({ contents: Cypress.Buffer.from('text\n'), fileName: 'broken.csv', mimeType: 'text/csv' }, { force: true });
      cy.wait('@importRejected');
      cy.get('[role="alert"]').should('contain.text', detail).and('contain.text', fieldError)
        .and('not.contain.text', 'internal traceback');
    });
  }

  it('keeps a mismatched-language import error behind the controlled fallback', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    ensureAccountLocale('zh-CN');
    cy.intercept({ method: 'POST', pathname: `/api/projects/${fixture.project_id}/import` }, {
      statusCode: 400,
      headers: { 'content-language': 'en-US' },
      body: { detail: 'The CSV header is invalid.' },
    }).as('importRejected');
    cy.visit(`/projects/${fixture.project_id}/data/import`);
    cy.get('#file-input').selectFile({ contents: Cypress.Buffer.from('text\n'), fileName: 'broken.csv', mimeType: 'text/csv' }, { force: true });
    cy.wait('@importRejected');
    cy.get('[role="alert"]').should('contain.text', '无法导入数据，请重试。')
      .and('not.contain.text', 'The CSV header is invalid.');
  });

  for (const [locale, copy] of [
    ['en-US', { title: 'Home', welcome: 'Welcome', resources: 'Resources', invite: 'Invite Members', inviteCopy: 'Copy invite link' }],
    ['zh-CN', { title: '首页', welcome: '欢迎', resources: '资源', invite: '邀请成员', inviteCopy: '复制邀请链接' }],
  ] as const) {
    it(`localizes the feature-flagged Home entry and invitation dialog in ${locale}`, () => {
      cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
      ensureAccountLocale(locale);
      // The Home dialog requests an instance invite link on mount. Keep this test synthetic.
      cy.intercept('POST', '**/invite/reset-token', { statusCode: 200, body: { invite_url: '/synthetic-invite' } });
      cy.visit('/');
      cy.get('html').should('have.attr', 'lang', locale);
      cy.title().should('contain', copy.title);
      cy.get('main').should('contain.text', copy.welcome);
      cy.get('[data-testid="resources-card"]').should('contain.text', copy.resources);
      cy.viewport(1280, 720);
      cy.document().then((document) => { document.documentElement.style.zoom = '200%'; });
      cy.get('[data-testid="home-action-createProject"]').scrollIntoView().should('be.visible');
      cy.get('[data-testid="home-action-inviteMembers"]').scrollIntoView().should('contain.text', copy.invite).click();
      cy.get(`button[aria-label="${copy.inviteCopy}"]`).scrollIntoView().should('be.visible');
    });
  }

  it('keeps the language controls reachable by keyboard and at 200% scale', () => {
    cy.loginAs(fixture.users.manager.email, fixture.password, '/user/account/personal-info');
    cy.viewport(1280, 720);
    cy.document().then((document) => { document.documentElement.style.zoom = '200%'; });
    cy.get('[data-testid="language-preference-select"]').scrollIntoView().should('be.visible').focus().should('have.focus');
    cy.get('[data-testid="user-menu-trigger"]').scrollIntoView().focus().type('{enter}');
    cy.get('[data-testid="menu-language-select"]').should('be.visible').focus().should('have.focus');
  });
});
