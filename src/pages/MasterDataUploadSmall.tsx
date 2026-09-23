import { useMemo, useState, type ChangeEvent } from 'react';
import { api, type StageBatchRequest } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type SupportedEntity = 'driver' | 'site' | 'vehicle' | 'trailer';
type JsonRecord = Record<string, string | number | boolean | undefined>;

type ParsedUpload = {
  records: StageBatchRequest[];
  counts: Record<SupportedEntity, number>;
  warnings: string[];
};

const supportedEntities: SupportedEntity[] = ['driver', 'site', 'vehicle', 'trailer'];
const pluralKeys: Record<SupportedEntity, string> = {
  driver: 'drivers',
  site: 'sites',
  vehicle: 'vehicles',
  trailer: 'trailers',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFlatRecord(value: unknown, label: string): JsonRecord {
  if (!isPlainObject(value)) throw new Error(`${label} must be a JSON object.`);
  const result: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[key] = item;
      continue;
    }
    throw new Error(`${label}.${key} must be a string, number or boolean. Nested objects and arrays are not accepted inside payload.`);
  }
  return result;
}

function recordIdentity(entity: SupportedEntity, payload: JsonRecord, index: number) {
  const candidates: Record<SupportedEntity, string[]> = {
    driver: ['employeeNumber', 'driverId', 'payrollNumber', 'displayName', 'name'],
    site: ['externalCode', 'siteCode', 'name'],
    vehicle: ['registration', 'fleetNumber', 'abbreviation'],
    trailer: ['trailerNumber', 'fleetNumber', 'registration'],
  };
  const value = candidates[entity]
    .map((key) => payload[key])
    .find((item) => item != null && String(item).trim().length > 0);
  return value == null ? `${entity}-${index + 1}` : String(value).trim();
}

function normaliseEntity(value: unknown): SupportedEntity | undefined {
  const candidate = String(value ?? '').trim().toLowerCase().replace(/s$/, '');
  return supportedEntities.find((entity) => entity === candidate);
}

function safeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
}

function parseUploadJson(text: string, fileName: string): ParsedUpload {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error('This file is not valid JSON. Check commas, quotes and brackets, then try again.');
  }

  const records: StageBatchRequest[] = [];
  const counts: Record<SupportedEntity, number> = { driver: 0, site: 0, vehicle: 0, trailer: 0 };
  const warnings: string[] = [];

  const add = (
    entityValue: unknown,
    payloadValue: unknown,
    index: number,
    suppliedIdempotencyKey?: unknown,
    suppliedSource?: unknown,
    label = `records[${index}]`,
  ) => {
    const entity = normaliseEntity(entityValue);
    if (!entity) throw new Error(`${label} needs entityType set to driver, site, vehicle or trailer.`);
    const payload = toFlatRecord(payloadValue, `${label}.payload`);
    const identity = recordIdentity(entity, payload, index);
    if (identity === `${entity}-${index + 1}`) warnings.push(`${label} has no obvious identity field; it will still be sent for API validation.`);
    const idempotencyKey = typeof suppliedIdempotencyKey === 'string' && suppliedIdempotencyKey.trim()
      ? suppliedIdempotencyKey.trim()
      : safeKey(`uploadsmall:${entity}:${identity}`);
    const source = typeof suppliedSource === 'string' && suppliedSource.trim()
      ? suppliedSource.trim()
      : `UploadSmall JSON · ${fileName}`;
    records.push({ entityType: entity, idempotencyKey, source, payload });
    counts[entity] += 1;
  };

  if (Array.isArray(json)) {
    json.forEach((item, index) => {
      if (!isPlainObject(item)) throw new Error(`Row ${index + 1} must be a JSON object.`);
      const payload = isPlainObject(item.payload)
        ? item.payload
        : Object.fromEntries(Object.entries(item).filter(([key]) => !['entityType', 'type', 'idempotencyKey', 'source'].includes(key)));
      add(item.entityType ?? item.type, payload, index, item.idempotencyKey, item.source, `rows[${index}]`);
    });
  } else if (isPlainObject(json)) {
    // Native export/update format used by SLH master-data update files:
    // { "records": [{ "entityType": "site", "idempotencyKey": "...", "payload": {...}, "source": "..." }], ... }
    if (Array.isArray(json.records)) {
      json.records.forEach((item, index) => {
        if (!isPlainObject(item)) throw new Error(`records[${index}] must be a JSON object.`);
        if (!isPlainObject(item.payload)) throw new Error(`records[${index}].payload must be a JSON object.`);
        add(item.entityType ?? item.type, item.payload, index, item.idempotencyKey, item.source, `records[${index}]`);
      });
      if (typeof json.updateRule === 'string' && json.updateRule.trim()) {
        warnings.push(`File rule: ${json.updateRule.trim()}`);
      }
    } else {
      let found = false;
      for (const entity of supportedEntities) {
        const value = json[pluralKeys[entity]] ?? json[entity];
        if (value == null) continue;
        found = true;
        if (!Array.isArray(value)) throw new Error(`${pluralKeys[entity]} must be a JSON array.`);
        value.forEach((row, index) => add(entity, row, index, undefined, undefined, `${pluralKeys[entity]}[${index}]`));
      }
      if (!found) {
        throw new Error('Use { "records": [...] }, grouped drivers/sites/vehicles/trailers arrays, or an array where each row has entityType.');
      }
    }
  } else {
    throw new Error('The JSON file must contain an object or an array.');
  }

  if (!records.length) throw new Error('No drivers, sites, vehicles or trailers were found in this file.');
  return { records, counts, warnings };
}

export function MasterDataUploadSmall({ onApplied }: { onApplied: () => void }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedUpload>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const total = parsed?.records.length || 0;
  const summary = useMemo(() => {
    if (!parsed) return '';
    return supportedEntities
      .filter((entity) => parsed.counts[entity] > 0)
      .map((entity) => `${parsed.counts[entity]} ${pluralKeys[entity]}`)
      .join(' · ');
  }, [parsed]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setMessage(undefined);
    setError(undefined);
    setParsed(undefined);
    if (!file) return;
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Choose a .json file.');
      return;
    }
    try {
      const result = parseUploadJson(await file.text(), file.name);
      setParsed(result);
      setMessage(`${result.records.length} record${result.records.length === 1 ? '' : 's'} ready to apply.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The JSON file could not be read.');
    }
  }

  async function apply() {
    if (!parsed?.records.length) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await api.applyMasterData(parsed.records, await token());
      const detail = `${result.applied} applied${result.failed ? ` · ${result.failed} failed` : ''}${result.linked ? ` · ${result.linked} linked` : ''}`;
      setMessage(`Upload complete: ${detail}.`);
      if (result.failed) {
        const failures = result.results.filter((item) => !item.applied).slice(0, 5).map((item) => item.error).filter(Boolean);
        if (failures.length) setError(failures.join(' · '));
      }
      onApplied();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Bulk master data could not be applied.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="panel" style={{ marginBottom: 18, border: '2px solid #d5e0e4' }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">UploadSmall</p>
        <h2>Bulk JSON master upload</h2>
        <p className="hint">Upload one JSON file containing drivers, sites, vehicles and trailers. The file is parsed in your browser first, then sent through the existing master-data apply endpoint.</p>
      </div>
      <button className={open ? '' : 'primary'} type="button" onClick={() => setOpen(value => !value)}>{open ? 'Close UploadSmall' : 'Upload JSON'}</button>
    </div>

    {open && <div style={{ display: 'grid', gap: 12 }}>
      <input type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} />
      <p className="hint">Accepted: SLH update files using <code>{'{ "records": [...] }'}</code>, grouped <code>drivers/sites/vehicles/trailers</code> arrays, or a flat array with <code>entityType</code>.</p>
      {fileName && <strong>{fileName}</strong>}
      {parsed && <div className="notice ready"><strong>{total} ready</strong><span>{summary}</span></div>}
      {parsed?.warnings.length ? <div className="notice"><strong>Review before applying</strong><span>{parsed.warnings.slice(0, 4).join(' · ')}</span></div> : null}
      {message && <p className="notice ready">{message}</p>}
      {error && <p className="notice">{error}</p>}
      <div className="actions">
        <button className="primary" type="button" disabled={!parsed?.records.length || saving} onClick={() => void apply()}>{saving ? 'Applying…' : `Apply ${total || ''} to Master Data`}</button>
        {parsed && <button type="button" disabled={saving} onClick={() => { setParsed(undefined); setFileName(''); setMessage(undefined); setError(undefined); }}>Clear file</button>}
      </div>
    </div>}
  </div>;
}
