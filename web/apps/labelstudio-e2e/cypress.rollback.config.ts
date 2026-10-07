import { execFileSync } from 'node:child_process';
import { defineConfig } from 'cypress';
import baseConfig from './cypress.config';

if (process.env.I18N_SYNTHETIC_ROLLBACK_REHEARSAL !== '1' || !process.env.I18N_ROLLBACK_HELPER) {
  throw new Error('Run only with the guarded helper and disposable synthetic rollback database.');
}

export default defineConfig({
  ...baseConfig,
  e2e: {
    ...baseConfig.e2e,
    specPattern: 'src/rehearsals/english-rollback.cy.ts',
    setupNodeEvents(on, config) {
      on('task', {
        installedRollbackCheck(phase: string) {
          if (!['browser-checkpoint', 'browser-verify', 'browser-revoke'].includes(phase)) {
            throw new Error('Unsupported browser rollback helper phase.');
          }
          execFileSync('/deps/.venv/bin/python', [process.env.I18N_ROLLBACK_HELPER!, phase], {
            stdio: 'inherit', env: { ...process.env, PYTHONPATH: '' },
          });
          return null;
        },
      });
      return config;
    },
  },
});
