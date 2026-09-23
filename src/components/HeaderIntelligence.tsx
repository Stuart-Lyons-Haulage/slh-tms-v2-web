import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type SystemState = {
  status: 'current' | 'pending' | 'attention';
  generatedAtUtc: string;
  lastPlatformUpdateUtc?: string;
  displaySource: string;
};

const age = (value?: string) => {
  if (!value) return 'No data';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : `${minutes}m`;
};

export function HeaderIntelligence() {
  const token = useAccessToken();
  const [system, setSystem] = useState<SystemState>();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const state = await request<SystemState>('/api/v1/system-sync/state', await token());
        if (alive) setSystem(state);
      } catch {
        // Keep the operational navigation available if the status feed is temporarily unavailable.
      }
    };

    void refresh();
    const id = window.setInterval(refresh, 180000);
    return () => { alive = false; window.clearInterval(id); };
  }, [token]);

  if (!system) return null;

  return <div className="header-intelligence">
    <div className="freshness-strip">
      <span className={`freshness ${system.status === 'current' ? 'ready' : system.status === 'attention' ? 'stale' : 'pending'}`} title={`${system.displaySource}. Last platform update ${system.lastPlatformUpdateUtc ? new Date(system.lastPlatformUpdateUtc).toLocaleString('en-GB') : 'unavailable'}`}>
        <i />TMS {system.status === 'current' ? 'current' : system.status} <b>{age(system.lastPlatformUpdateUtc)}</b>
      </span>
    </div>
  </div>;
}
