import { useCallback, useMemo, useState } from 'react';
import { api, type Driver } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { MasterDocuments } from './MasterDocuments';

export function DriverDocumentsIndex() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Driver>();
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (drivers.data || []).filter(driver => !needle || [driver.displayName, driver.employeeNumber, driver.tachoName, driver.driverType]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [drivers.data, query]);

  return <div className="panel" style={{ marginTop: 18 }}>
    <div className="title-row">
      <div><p className="eyebrow">Driver documents</p><h2>Driver document libraries</h2><p className="hint">Each driver has a separate controlled document index. Use this for licence/CPC evidence, agency paperwork and authorised compliance documents. The file itself remains in SharePoint/OneDrive.</p></div>
      <label>Find driver<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Driver or employee no." /></label>
    </div>
    <div style={{ overflowX:'auto', maxHeight: 420 }}><table><thead><tr><th>Driver</th><th>Employee</th><th>Type</th><th></th></tr></thead>
      <tbody>{visible.map(driver => <tr key={driver.id}><td><strong>{driver.displayName}</strong></td><td>{driver.employeeNumber}</td><td>{driver.driverType || '—'}</td><td><button className={selected?.id === driver.id ? 'primary' : undefined} onClick={()=>setSelected(selected?.id === driver.id ? undefined : driver)}>{selected?.id === driver.id ? 'Close documents' : 'Documents'}</button></td></tr>)}</tbody></table></div>
    {selected && <MasterDocuments entityType="Driver" entityId={selected.id} title={selected.displayName} />}
  </div>;
}
