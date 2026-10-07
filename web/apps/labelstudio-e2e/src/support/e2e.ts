// ***********************************************************
// This example support/index.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands';
import { redactFailure } from './failure-diagnostics.cjs';

// https://docs.cypress.io/api/cypress-api/catalog-of-events#Cypress-Events
// Rethrowing is required: a diagnostic redaction must never make a test pass.
Cypress.on('fail', (error) => {
  throw redactFailure(error);
});
