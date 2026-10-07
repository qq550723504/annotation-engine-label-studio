import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'cypress';
import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__dirname),
    testIsolation: true,
    supportFile: 'src/support/e2e.ts',
    specPattern: 'src/e2e/**/*.cy.{js,jsx,ts,tsx}',
    setupNodeEvents(on, config) {
      const repoRoot = resolve(__dirname, '../../..');
      const runManagementCommand = (args: string[]) => {
        const container = process.env.ENTERPRISE_E2E_CONTAINER;
        execFileSync(
          container ? 'docker' : 'poetry',
          container
            ? ['exec', container, '/deps/.venv/bin/python', 'label_studio/manage.py', ...args]
            : ['run', 'python', 'label_studio/manage.py', ...args],
          { cwd: repoRoot, stdio: 'inherit', env: process.env },
        );
      };
      on('task', {
        createEnterpriseE2ESubmission({ taskId, actor }: { taskId: number; actor: string }) {
          runManagementCommand(['create_enterprise_e2e_submission', String(taskId), actor]);
          return null;
        },
        setEnterpriseE2EAssignment({
          action,
          taskId,
          actor,
        }: {
          action: "assign" | "cancel" | "clear";
          taskId: number;
          actor: string;
        }) {
          runManagementCommand(['set_enterprise_e2e_assignment', action, String(taskId), actor]);
          return null;
        },
        setEnterpriseE2EMember({
          actor,
          enabled,
          projectId,
        }: {
          actor: string;
          enabled: boolean;
          projectId?: number;
        }) {
          runManagementCommand([
            'set_enterprise_e2e_member', actor,
            '--enabled', enabled ? 'true' : 'false',
            ...(projectId ? ['--project-id', String(projectId)] : []),
          ]);
          return null;
        },
      });

      return config;
    },
    // Please ensure you use `cy.origin()` when navigating between domains and remove this option.
    // See https://docs.cypress.io/app/references/migration-guide#Changes-to-cyorigin
    injectDocumentDomain: true,
  },
});
