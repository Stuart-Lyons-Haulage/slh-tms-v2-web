export type CoverageSite = {
  id: string;
  externalCode?: string;
  name?: string;
  driverTextName?: string;
  aliases?: string;
  active?: boolean;
};

export type CoverageStatus = {
  siteId: string;
  siteCode: string;
  siteName: string;
  linkedGeofences: string[];
  geofenceLinked: boolean;
  needsReview: boolean;
};

export type SiteCoverage = {
  sourceLabel: string;
  state: 'linked' | 'unlinked' | 'unresolved';
  siteCode?: string;
  siteName?: string;
  geofenceName?: string;
  action?: string;
  suggestedSiteId?: string;
  suggestedSiteCode?: string;
  suggestedSiteName?: string;
  suggestedSiteAliases?: string;
  suggestionReason?: string;
  suggestionConfidence?: 'high' | 'medium';
};

export function normaliseCoverageKey(value?: string) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function splitAliases(value?: string) {
  return String(value || '').split(/[,;|\n\r]+/).map(item => item.trim()).filter(Boolean);
}

function variants(value: string) {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (candidate?: string) => {
    const clean = candidate?.trim();
    if (clean && !seen.has(clean)) { seen.add(clean); values.push(clean); }
  };
  add(value);
  add(value.replace(/^\s*(collect|deliver)\s*[·:-]\s*/i, ''));
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    add(candidate.replace(/\(\s*[+-]?\d+(?:\.\d+)?\s*°?\s*C\s*\)/gi, '').trim());
    add(candidate.replace(/\s+(CHILL|FRV)$/i, '').trim());
    // DOT/order names often append a store/location number that is not part of Site Master.
    add(candidate.replace(/\s+\d{2,6}\s*$/, '').trim());
    const separator = candidate.indexOf('-');
    if (separator > 0) {
      const prefix = candidate.slice(0, separator).trim().toUpperCase();
      if (['BAR', 'BARFOOTS', 'LAN', 'LANGMEADS', 'SB', 'GHS', 'SLH', 'NWF', 'WAITROSE', 'MORRISONS', 'ALDI'].includes(prefix)) {
        add(candidate.slice(separator + 1));
      }
    }
    const open = candidate.lastIndexOf('(');
    if (open > 0 && candidate.endsWith(')')) {
      const before = candidate.slice(0, open).trim();
      const inside = candidate.slice(open + 1, -1).trim();
      add(before);
      if (inside && !inside.includes('°')) add(inside);
    }
  }
  return values.map(normaliseCoverageKey).filter(Boolean);
}

function siteCandidates(site: CoverageSite) {
  return [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases)]
    .flatMap(candidate => variants(candidate || ''))
    .filter(Boolean);
}

function rawSiteCandidates(site: CoverageSite, status?: CoverageStatus) {
  return [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases), ...(status?.linkedGeofences || [])]
    .map(normaliseCoverageKey)
    .filter(Boolean);
}

const GENERIC_BRANDS = new Set(['MORRISONS', 'WAITROSE', 'ALDI', 'NWF', 'GHS', 'BARFOOTS', 'LANGMEADS']);
const BRANDS = ['MORRISONS', 'WAITROSE', 'ALDI', 'NWF', 'GHS', 'BARFOOTS', 'LANGMEADS'];

function aliasSuggestionKeys(value: string) {
  const raw = String(value || '').trim();
  const keys = new Set(variants(raw));
  const withoutNumber = raw.replace(/\s+\d{2,6}\s*$/, '').trim();
  if (withoutNumber) keys.add(normaliseCoverageKey(withoutNumber));

  const clean = withoutNumber.replace(/^\s*(collect|deliver)\s*[·:-]\s*/i, '').trim();
  const upper = clean.toUpperCase();
  const brand = BRANDS.find(item => upper === item || upper.startsWith(`${item} `) || upper.startsWith(`${item}-`));
  if (brand && upper !== brand) {
    let locality = clean.slice(brand.length).replace(/^\s*[-–—:]?\s*/, '').trim();
    // Morrisons order feeds commonly insert FRUIT before the locality while Site Master
    // correctly stores the physical depot as Morrisons <locality>.
    if (brand === 'MORRISONS') locality = locality.replace(/^FRUIT\s*/i, '').trim();
    if (locality) {
      keys.add(normaliseCoverageKey(locality));
      keys.add(normaliseCoverageKey(`${brand} ${locality}`));
    }
  }

  return [...keys].filter(key => key.length >= 4);
}

function suggestAliasSite(label: string, sites: CoverageSite[]) {
  const sourceKey = normaliseCoverageKey(label);
  if (!sourceKey || GENERIC_BRANDS.has(sourceKey)) return undefined;
  const sourceKeys = aliasSuggestionKeys(label);
  const candidates = sites.filter(site => site.active !== false).filter(site => {
    const candidateKeys = [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases)]
      .flatMap(value => aliasSuggestionKeys(value || ''));
    return candidateKeys.some(candidate => sourceKeys.includes(candidate));
  });
  const unique = Array.from(new Map(candidates.map(site => [site.id, site])).values());
  if (unique.length !== 1) return undefined;
  const site = unique[0];
  const siteKey = normaliseCoverageKey(site.name || site.driverTextName || '');
  const withoutNumber = normaliseCoverageKey(label.replace(/\s+\d{2,6}\s*$/, ''));
  const high = Boolean(siteKey && aliasSuggestionKeys(label).includes(siteKey)) || withoutNumber === siteKey;
  return {
    site,
    confidence: high ? 'high' as const : 'medium' as const,
    reason: high
      ? 'The order wording reduces to one unique Site Master name after removing a source/store suffix.'
      : 'The order wording has one unique Site Master locality match.'
  };
}

export function resolveSiteCoverage(label: string, sites: CoverageSite[], statuses: CoverageStatus[]): SiteCoverage {
  const keys = variants(label);
  const sourceKey = normaliseCoverageKey(label);
  const activeSites = sites.filter(site => site.active !== false);
  const exactMatches = activeSites.filter(site => rawSiteCandidates(site, statuses.find(status => status.siteId === site.id)).includes(sourceKey));
  const variantMatches = activeSites.filter(site => {
    const linkedNames = statuses.find(status => status.siteId === site.id)?.linkedGeofences || [];
    const candidates = [...siteCandidates(site), ...linkedNames.flatMap(variants)];
    return candidates.some(candidate => keys.includes(candidate));
  });
  const matches = exactMatches.length > 0 ? exactMatches : variantMatches;
  const unique = Array.from(new Map(matches.map(site => [site.id, site])).values());
  if (unique.length !== 1) {
    const suggestion = unique.length === 0 ? suggestAliasSite(label, activeSites) : undefined;
    return {
      sourceLabel: label,
      state: 'unresolved',
      action: unique.length > 1
        ? 'More than one Site matches this wording. Remove duplicate/ambiguous aliases in Site CRM.'
        : suggestion
          ? `Likely ${suggestion.site.name || suggestion.site.driverTextName || suggestion.site.externalCode}. Confirm once and this wording can be retained as a Site Master alias.`
          : 'Add this wording as an alias to the correct Site CRM record.',
      suggestedSiteId: suggestion?.site.id,
      suggestedSiteCode: suggestion?.site.externalCode,
      suggestedSiteName: suggestion?.site.name || suggestion?.site.driverTextName,
      suggestedSiteAliases: suggestion?.site.aliases,
      suggestionReason: suggestion?.reason,
      suggestionConfidence: suggestion?.confidence,
    };
  }
  const site = unique[0];
  const status = statuses.find(item => item.siteId === site.id);
  if (!status?.geofenceLinked) {
    return {
      sourceLabel: label,
      state: 'unlinked',
      siteCode: status?.siteCode || site.externalCode,
      siteName: status?.siteName || site.driverTextName || site.name,
      action: 'Site is recognised but has no active geofence. Link the correct geofence in Site CRM / Geofence Integrity.',
    };
  }
  return {
    sourceLabel: label,
    state: 'linked',
    siteCode: status.siteCode || site.externalCode,
    siteName: status.siteName || site.driverTextName || site.name,
    geofenceName: status.linkedGeofences.join(', '),
  };
}
