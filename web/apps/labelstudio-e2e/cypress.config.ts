import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'cypress';
import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__dirname),
    supportFile: 'src/support/e2e.ts',
    specPattern: 'src/e2e/**/*.cy.{js,jsx,ts,tsx}',
    setupNodeEvents(on, config) {
      on('task', {
        createEnterpriseE2ESubmission({ taskId, actor }: { taskId: number; actor: string }) {
          const repoRoot = resolve(__dirname, '../../..');
          execFileSync(
            'poetry',
            [
              'run',
              'python',
              'label_studio/manage.py',
              'create_enterprise_e2e_submission',
              String(taskId),
              actor,
            ],
            {
              cwd: repoRoot,
              stdio: 'inherit',
              env: process.env,
            },
          );
          return null;
        },
        setEnterpriseE2EAssignment({
          action,
          taskId,
          actor,
        }: {
          action: "assign" | "cancel";
          taskId: number;
          actor: string;
        }) {
          const repoRoot = resolve(__dirname, '../../..');
          execFileSync(
            'poetry',
            [
              'run',
              'python',
              'label_studio/manage.py',
              'set_enterprise_e2e_assignment',
              action,
              String(taskId),
              actor,
            ],
            {
              cwd: repoRoot,
              stdio: 'inherit',
              env: process.env,
            },
          );
          return null;
        },
        setEnterpriseE2EMember({ actor, enabled }: { actor: string; enabled: boolean }) {
          const repoRoot = resolve(__dirname, '../../..');
          execFileSync(
            'poetry',
            [
              'run',
              'python',
              'label_studio/manage.py',
              'set_enterprise_e2e_member',
              actor,
              '--enabled',
              enabled ? 'true' : 'false',
            ],
            {
              cwd: repoRoot,
              stdio: 'inherit',
              env: process.env,
            },
          );
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
