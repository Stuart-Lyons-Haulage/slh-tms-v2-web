import { describe, expect, it } from 'vitest';
import { resolveSiteCoverage, type CoverageSite, type CoverageStatus } from './siteGeofenceCoverageLogic';

const linked: CoverageStatus[] = [{
  siteId: 'latimer',
  siteCode: 'SITE401',
  siteName: 'Morrisons Latimer',
  linkedGeofences: ['Morrisons LATIMER'],
  geofenceLinked: true,
  needsReview: false,
}];

describe('Approved Orders Site Master coverage', () => {
  it('resolves an order suffix number through the canonical Site name', () => {
    const sites: CoverageSite[] = [{ id: 'latimer', externalCode: 'SITE401', name: 'Morrisons Latimer', active: true }];

    expect(resolveSiteCoverage('Morrisons LATIMER 952', sites, linked)).toMatchObject({
      state: 'linked',
      siteCode: 'SITE401',
      geofenceName: 'Morrisons LATIMER',
    });
  });

  it('matches structured variants on both the order wording and Site Master wording', () => {
    const sites: CoverageSite[] = [{ id: 'merston', externalCode: 'SITE329', name: 'NWF - Merston', active: true }];
    const statuses: CoverageStatus[] = [{ siteId: 'merston', siteCode: 'SITE329', siteName: 'NWF - Merston', linkedGeofences: [], geofenceLinked: false, needsReview: true }];

    expect(resolveSiteCoverage('Merston (Natures Way)', sites, statuses)).toMatchObject({
      state: 'unlinked',
      siteCode: 'SITE329',
    });
  });

  it('resolves order wording through the geofence already linked to Site Master', () => {
    const sites: CoverageSite[] = [{ id: 'bridgwater', externalCode: 'SITE718', name: 'Morrisons Bridgwater', active: true }];
    const statuses: CoverageStatus[] = [{
      siteId: 'bridgwater',
      siteCode: 'SITE718',
      siteName: 'Morrisons Bridgwater',
      linkedGeofences: ['Morrisons FRUITBRIDGWATER 718'],
      geofenceLinked: true,
      needsReview: false,
    }];

    expect(resolveSiteCoverage('Morrisons FRUITBRIDGWATER 718', sites, statuses)).toMatchObject({
      state: 'linked',
      siteCode: 'SITE718',
      geofenceName: 'Morrisons FRUITBRIDGWATER 718',
    });
  });

  it('suggests the unique canonical Stockton Site for the Morrisons fruit-feed wording', () => {
    const sites: CoverageSite[] = [
      { id: 'stockton', externalCode: 'SITE993', name: 'Morrisons Stockton', aliases: 'Morrisons STOCKTON 994', active: true },
      { id: 'wakefield', externalCode: 'SITE990', name: 'Morrisons Wakefield', active: true },
    ];

    expect(resolveSiteCoverage('Morrisons FRUITSTOCKTON 993', sites, [])).toMatchObject({
      state: 'unresolved',
      suggestedSiteId: 'stockton',
      suggestedSiteName: 'Morrisons Stockton',
      suggestionConfidence: 'high',
    });
  });

  it('suggests Wakefield and Bridgwater fruit-feed aliases when each locality is unique', () => {
    const sites: CoverageSite[] = [
      { id: 'wakefield', externalCode: 'SITE990', name: 'Morrisons Wakefield', active: true },
      { id: 'bridgwater', externalCode: 'SITE718', name: 'Morrisons Bridgwater', active: true },
    ];

    expect(resolveSiteCoverage('Morrisons FRUITWAKEFIELD 990', sites, [])).toMatchObject({ suggestedSiteId: 'wakefield', suggestionConfidence: 'high' });
    expect(resolveSiteCoverage('Morrisons FRUITBRIDGWATER 718', sites, [])).toMatchObject({ suggestedSiteId: 'bridgwater', suggestionConfidence: 'high' });
  });

  it('never suggests a generic supermarket brand as an automatic alias', () => {
    const sites: CoverageSite[] = [
      { id: 'one', externalCode: 'SITE1', name: 'Morrisons Stockton', active: true },
      { id: 'two', externalCode: 'SITE2', name: 'Morrisons Wakefield', active: true },
    ];

    expect(resolveSiteCoverage('Morrisons', sites, [])).toMatchObject({ state: 'unresolved', suggestedSiteId: undefined });
  });

  it('never chooses automatically when a variant matches multiple Sites', () => {
    const sites: CoverageSite[] = [
      { id: 'one', externalCode: 'SITE1', name: 'Morrisons - Sittingbourne', active: true },
      { id: 'two', externalCode: 'SITE2', name: 'Sittingbourne', aliases: 'Morrisons - Sittingbourne', active: true },
    ];

    expect(resolveSiteCoverage('Morrisons - Sittingbourne 389', sites, [])).toMatchObject({ state: 'unresolved', suggestedSiteId: undefined });
  });

  it('prefers one exact full Site name over a shorter derived variant', () => {
    const sites: CoverageSite[] = [
      { id: 'one', externalCode: 'SITE389', name: 'Morrisons - Sittingbourne', active: true },
      { id: 'two', externalCode: 'SITE2', name: 'Sittingbourne', active: true },
    ];
    const statuses: CoverageStatus[] = [{ siteId: 'one', siteCode: 'SITE389', siteName: 'Morrisons - Sittingbourne', linkedGeofences: [], geofenceLinked: false, needsReview: true }];

    expect(resolveSiteCoverage('Morrisons - Sittingbourne', sites, statuses)).toMatchObject({
      state: 'unlinked',
      siteCode: 'SITE389',
    });
  });
});
