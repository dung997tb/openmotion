import { expect, it } from 'vitest';
import { isKnownMessage } from './messages';

const cloudAccountAndGatewayMessages = [
  'OpenDesign Model Gateway',
  'Model gateway',
  'Default models',
  'Local Dev Mode',
  'Local Mock Model Gateway',
  'Personal access tokens',
  'Workspaces',
  'Switch workspace',
  'Workspace switched',
  'Could not switch workspace',
  'Signed out',
  'Could not sign out',
  'Create token',
  'Personal access token created',
  'Could not create token',
  'Token revoked',
  'Could not revoke token',
  'Token copied',
  'Could not copy token',
  'Could not sync models',
  'Workspace admin permission is required to change default models.',
];

// Cloud account and gateway notices are translated by exact source text, so regressions must not fall back silently.
it('has a Chinese translation for every maintained cloud account and gateway UI message', () => {
  expect(cloudAccountAndGatewayMessages.length).toBeGreaterThan(10);
  expect(cloudAccountAndGatewayMessages.filter(message => !isKnownMessage(message))).toEqual([]);
});
