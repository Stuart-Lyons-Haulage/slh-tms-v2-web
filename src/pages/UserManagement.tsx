import { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type TmsUserRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  createdAtUtc: string;
  lastLoginAtUtc?: string;
};

const roles = ['TMS.Admin', 'TMS.Management', 'TMS.Planner', 'TMS.Transport', 'TMS.Warehouse', 'TMS.Accounts', 'TMS.ReadOnly'];

export function UserManagement() {
  const accessToken = useAccessToken();
  const [users, setUsers] = useState<TmsUserRow[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('TMS.ReadOnly');
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await accessToken();
    setUsers(await request<TmsUserRow[]>('/api/v1/auth/users', token));
  }, [accessToken]);

  useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : 'Could not load users.')); }, [load]);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const token = await accessToken();
      await request('/api/v1/auth/users', token, {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password, role })
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('TMS.ReadOnly');
      setMessage('User created.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'User could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (user: TmsUserRow, active: boolean) => {
    const token = await accessToken();
    await request(`/api/v1/auth/users/${user.id}/active`, token, {
      method: 'POST',
      body: JSON.stringify({ active })
    });
    await load();
  };

  const resetPassword = async (user: TmsUserRow) => {
    const next = window.prompt(`Enter a new password for ${user.displayName}. Minimum 10 characters with letters and numbers.`);
    if (!next) return;
    const token = await accessToken();
    await request(`/api/v1/auth/users/${user.id}/password`, token, {
      method: 'POST',
      body: JSON.stringify({ password: next })
    });
    setMessage(`Password reset for ${user.displayName}.`);
  };

  return <section style={{ padding: 24, display: 'grid', gap: 20 }}>
    <div>
      <p className="eyebrow">Administration</p>
      <h1>TMS user accounts</h1>
      <p>Create individual accounts, assign a role, disable leavers and reset passwords. Passwords are stored only as secure hashes.</p>
    </div>

    <form onSubmit={createUser} style={{ display: 'grid', gap: 12, maxWidth: 720, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" required /></label>
      <label>Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} required /></label>
      <label>Initial password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
      <label>Role<select value={role} onChange={e => setRole(e.target.value)}>{roles.map(item => <option key={item} value={item}>{item.replace('TMS.', '')}</option>)}</select></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
    </form>

    {message && <p role="status">{message}</p>}

    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id}>
          <td>{user.displayName}</td>
          <td>{user.username}</td>
          <td>{user.role.replace('TMS.', '')}</td>
          <td>{user.active ? 'Active' : 'Disabled'}</td>
          <td>{user.lastLoginAtUtc ? new Date(user.lastLoginAtUtc).toLocaleString() : 'Never'}</td>
          <td style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void resetPassword(user)}>Reset password</button>
            <button type="button" onClick={() => void setActive(user, !user.active)}>{user.active ? 'Disable' : 'Enable'}</button>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
