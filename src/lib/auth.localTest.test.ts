import { describe, expect, it } from 'vitest';
import {
  canUseMicrosoftAuthenticationFor,
  isApplicationAuthenticatedFor,
  localTestAccessToken,
} from './auth';

describe('local test authentication contract', () => {
  it('treats the controlled local test user as authenticated so protected routes render', () => {
    expect(isApplicationAuthenticatedFor(true, false)).toBe(true);
  });

  it('does not permit Microsoft sign-in or sign-out operations in local test mode', () => {
    expect(canUseMicrosoftAuthenticationFor(true)).toBe(false);
  });

  it('uses only the controlled browser token for the local test path', () => {
    expect(localTestAccessToken).toBe('local-test-browser-token');
  });

  it('retains normal Entra authentication behaviour outside local test mode', () => {
    expect(isApplicationAuthenticatedFor(false, false)).toBe(false);
    expect(isApplicationAuthenticatedFor(false, true)).toBe(true);
    expect(canUseMicrosoftAuthenticationFor(false)).toBe(true);
  });
});
