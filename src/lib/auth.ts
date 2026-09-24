import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { useCallback } from 'react';

const productionApiScope = 'api://497f6ea5-9753-43ee-8ccf-afaa0a3869c2/Tms.Access';
const localSessionKey = 'slh-tms-local-session';
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/tms-api').replace(/\/$/, '');

export const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE || productionApiScope;
export const e2eAuthEnabled = import.meta.env.VITE_E2E_AUTH === 'true';
export const localTestAuthEnabled = import.meta.env.VITE_LOCAL_TEST_MODE === 'true';
export const localAuthEnabled = String(import.meta.env.VITE_AUTH_MODE || '').toLowerCase() === 'local';

export type LocalAuthSession = {
  accessToken: string;
  expiresAtUtc: string;
  username: string;
  displayName: string;
  role: string;
};

export function getLocalAuthSession(): LocalAuthSession | null {
  if (!localAuthEnabled) return null;
  try {
    const raw = sessionStorage.getItem(localSessionKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as LocalAuthSession;
    if (!session.accessToken || !session.expiresAtUtc || new Date(session.expiresAtUtc).getTime() <= Date.now()) {
      sessionStorage.removeItem(localSessionKey);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(localSessionKey);
    return null;
  }
}

export async function localLogin(username: string, password: string): Promise<LocalAuthSession> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || 'Sign in failed.');
  }
  const session = await response.json() as LocalAuthSession;
  sessionStorage.setItem(localSessionKey, JSON.stringify(session));
  return session;
}

export function localLogout() {
  sessionStorage.removeItem(localSessionKey);
}

export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return useCallback(async () => {
    if (localTestAuthEnabled) return 'local-test-browser-token';
    if (e2eAuthEnabled) return 'e2e-browser-token';
    if (localAuthEnabled) {
      const session = getLocalAuthSession();
      if (!session) throw new Error('Your TMS sign-in has expired. Please sign in again.');
      return session.accessToken;
    }
    if (!apiScope) throw new Error('Live API access is not configured.');
    const account: AccountInfo | undefined = instance.getActiveAccount() || accounts[0];
    if (!account) throw new Error('Your Microsoft sign-in has expired. Please sign in again.');
    try { return (await instance.acquireTokenSilent({ account, scopes: [apiScope] })).accessToken; }
    catch { throw new Error('Microsoft sign-in needs refreshing before live data can load. Reconnect securely, then retry this panel.'); }
  }, [accounts, instance]);
}
