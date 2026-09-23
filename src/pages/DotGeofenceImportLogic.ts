import type { Site } from '../lib/api';

export type DotImportStatus = 'Matched' | 'NeedsLinking' | 'AlreadyImported' | 'PossibleRename' | 'Invalid';

export type DotImportRow = {
  index?: number;
  clientKey: string;
  name: string;
  status: DotImportStatus;
  error?: string | null;
  suggestedSiteId?: string | null;
  suggestedSiteCode?: string | null;
  suggestedSiteName?: string | null;
  existingGeofenceId?: string | null;
  possibleRenameGeofenceId?: string | null;
};

export type DotImportDecision = {
  siteId?: string;
  skip?: boolean;
  confirmRenameGeofenceId?: string;
};

export type SiteOption = Pick<Site, 'id' | 'externalCode' | 'name' | 'active'>;

export function filterImportSites(sites: SiteOption[], query: string): SiteOption[] {
  const term = query.trim().toLocaleLowerCase();
  return sites.filter(site => site.active && (!term
    || site.externalCode.toLocaleLowerCase().includes(term)
    || site.name.toLocaleLowerCase().includes(term)));
}

export function importRowsReady(rows: DotImportRow[], decisions: Record<string, DotImportDecision>): boolean {
  return rows.every(row => {
    const decision = decisions[row.clientKey];
    if (decision?.skip) return true;
    if (row.status === 'Invalid') return false;
    const siteId = decision?.siteId || row.suggestedSiteId;
    if (!siteId) return false;
    return row.status !== 'PossibleRename'
      || Boolean(row.possibleRenameGeofenceId && decision?.confirmRenameGeofenceId === row.possibleRenameGeofenceId);
  });
}
