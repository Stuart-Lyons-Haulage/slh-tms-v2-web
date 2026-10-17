export type MarketRecord = {
  market?: string;
  name?: string;
  standOrLocation?: string;
  stallNumber?: string;
  originalName?: string;
  [key: string]: unknown;
};

type MasterRecord = { entityType?: string; payload?: MarketRecord; [key: string]: unknown };

function clean(value?: string) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function looksLikeStandToken(value: string) {
  const token = clean(value);
  return Boolean(token && (
    /^(?:stall|stand|unit|block|rail\s+arch)\s*#?\s*[a-z]?\d{1,4}[a-z]?$/i.test(token) ||
    /^(?:s)?\d{1,3}[a-z]?$/i.test(token) ||
    /^[a-z]\d{1,3}$/i.test(token) ||
    /^\d{1,4}\s*[-/]\s*\d{1,4}$/i.test(token)
  ));
}

export function splitEmbeddedMarketStand(value?: string) {
  const original = clean(value);
  if (!original) return { name: '', standOrLocation: '' };

  const bracketed = original.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (bracketed && looksLikeStandToken(bracketed[2])) return { name: clean(bracketed[1]), standOrLocation: clean(bracketed[2]) };

  const labelled = original.match(/^(.*?)\s+(?:stall|stand)\s*#?\s*([a-z]?\d{1,4}[a-z]?)\s*$/i);
  if (labelled) return { name: clean(labelled[1]), standOrLocation: clean(labelled[2]) };

  const dashed = original.match(/^(.*?)\s+[-–—]\s*([a-z]?\d{1,4}[a-z]?)\s*$/i);
  if (dashed && looksLikeStandToken(dashed[2])) return { name: clean(dashed[1]), standOrLocation: clean(dashed[2]) };

  const trailing = original.match(/^(.*?)\s+((?:s)?\d{1,3}[a-z]?|[a-z]\d{1,3})\s*$/i);
  if (trailing) {
    const seller = clean(trailing[1]);
    if (seller.replace(/[^a-z]/gi, '').length >= 3 && !/^\d+$/.test(seller)) {
      return { name: seller, standOrLocation: clean(trailing[2]) };
    }
  }
  return { name: original, standOrLocation: '' };
}

export function normaliseMarketPayload(payload: MarketRecord): MarketRecord {
  const market = clean(payload.market);
  const originalName = clean(payload.name);
  const explicitStand = clean(payload.standOrLocation) || clean(payload.stallNumber);
  if (!originalName || market.toLowerCase() === 'sender' || explicitStand) {
    return { ...payload, ...(explicitStand ? { standOrLocation: explicitStand } : {}) };
  }
  const parsed = splitEmbeddedMarketStand(originalName);
  if (!parsed.standOrLocation || parsed.name === originalName) return payload;
  return { ...payload, name: parsed.name, standOrLocation: parsed.standOrLocation, originalName };
}

export function normaliseMarketMasterRecords<T>(body: T): T {
  if (!Array.isArray(body)) return body;
  return body.map((record: MasterRecord) => {
    if (record?.entityType?.toLowerCase() !== 'marketcontact' || !record.payload) return record;
    return { ...record, payload: normaliseMarketPayload(record.payload) };
  }) as T;
}

export function normaliseMarketContacts<T extends MarketRecord[]>(rows: T): T {
  return rows.map(row => normaliseMarketPayload(row)) as T;
}
