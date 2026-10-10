import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { useCallback } from 'react';

const productionApiScope = 'api://497f6ea5-9753-43ee-8ccf-afaa0a3869c2/Tms.Access';
const tokenAcquisitionTimeoutMs = 15_000;

export const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE || productionApiScope;
export const e2eAuthEnabled = import.meta.env.VITE_E2E_AUTH === 'true';
export const localTestAuthEnabled = import.meta.env.VITE_LOCAL_TEST_MODE === 'true';

export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return useCallback(async () => {
    if (localTestAuthEnabled) return 'local-test-browser-token';
    if (e2eAuthEnabled) return 'e2e-browser-token';
    if (!apiScope) throw new Error('Live API access is not configured.');
    const account: AccountInfo | undefined = instance.getActiveAccount() || accounts[0];
    if (!account) throw new Error('Your Microsoft sign-in has expired. Please sign in again.');

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const tokenRequest = instance.acquireTokenSilent({ account, scopes: [apiScope] });
      const tokenTimeout = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Microsoft token acquisition timed out. Please sign in again, then retry.')), tokenAcquisitionTimeoutMs);
      });
      return (await Promise.race([tokenRequest, tokenTimeout])).accessToken;
    } catch (exception) {
      if (exception instanceof Error && exception.message.includes('token acquisition timed out')) throw exception;
      throw new Error('Microsoft sign-in needs refreshing before live data can load. Sign in with Microsoft again, then retry this panel.');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }, [accounts, instance]);
}
