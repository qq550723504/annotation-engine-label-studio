import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'cypress';
import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__dirname),
    supportFile: 'src/support/e2e.ts',
    specPattern: 'src/e2e/**/*.cy.{js,jsx,ts,tsx}',
    setupNodeEvents(on, config) {
      on('task', {
        setEnterpriseE2EMember({ actor, enabled }: { actor: string; enabled: boolean }) {
          const repoRoot = path.resolve(__dirname, '../../..');
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
