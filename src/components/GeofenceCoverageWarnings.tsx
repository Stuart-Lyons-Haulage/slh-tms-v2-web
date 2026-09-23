/* eslint-disable react-refresh/only-export-components */
import { Link } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { normaliseCoverageKey, resolveSiteCoverage, type CoverageSite, type CoverageStatus, type SiteCoverage } from "./siteGeofenceCoverageLogic";

type RunLinkageIssue = {
  loadId: string;
  run: string;
  stopId: string;
  sequence: number;
  stopName: string;
  finalDelivery: boolean;
  siteMatched: boolean;
  siteCode?: string;
  siteName?: string;
  geofenceLinked: boolean;
  geofenceName?: string;
  issue?: string | null;
  evidence?: string;
};

type RunLinkageResponse = {
  planningDate: string;
  runs: number;
  stops: number;
  siteNameUnresolved: number;
  siteMatchedButGeofenceUnlinked: number;
  linkedStops: number;
  stopsWithVisitEvidence: number;
  issues: RunLinkageIssue[];
  records: RunLinkageIssue[];
};

export function useSiteGeofenceCoverage(labels: string[]) {
  const token = useAccessToken();
  const cleanLabels = useMemo(() => Array.from(new Set(labels.map(value => String(value || "").trim()).filter(Boolean))), [labels]);
  const key = cleanLabels.join("\u001f");
  const lookup = useApi(useCallback(async () => {
    if (!cleanLabels.length) return [] as SiteCoverage[];
    const access = await token();
    const [sites, statuses] = await Promise.all([
      request<CoverageSite[]>("/api/v1/sites", access),
      request<CoverageStatus[]>("/api/v1/site-geofence-sync/sites", access, { cache: "no-store" }),
    ]);
    return cleanLabels.map(label => resolveSiteCoverage(label, sites, statuses));
  // key intentionally represents the complete label set so edits/additions rerun the check.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]));

  const byLabel = useMemo(() => new Map((lookup.data || []).map(item => [normaliseCoverageKey(item.sourceLabel), item])), [lookup.data]);
  const resultFor = useCallback((label?: string) => label ? byLabel.get(normaliseCoverageKey(label)) : undefined, [byLabel]);
  const issues = useMemo(() => (lookup.data || []).filter(item => item.state !== "linked"), [lookup.data]);
  return { ...lookup, resultFor, issues };
}

export function GeofenceStatusBadge({ result }: { result?: SiteCoverage }) {
  if (!result) return null;
  if (result.state === "linked") {
    return <small title={result.geofenceName || "Active geofence linked"} style={{ display: "block", marginTop: 4, color: "#18794e", fontWeight: 800 }}>● GEOFENCE LINKED</small>;
  }
  const unresolved = result.state === "unresolved";
  return <small title={result.action} style={{ display: "block", marginTop: 4, color: "#b42318", fontWeight: 900 }}>⚠ {unresolved ? "SITE NAME NOT RECOGNISED" : "GEOFENCE MISSING"}</small>;
}

type SiteCoverageWarningPanelProps = {
  issues: SiteCoverage[];
  title?: string;
  onApplySuggestedAlias?: (issue: SiteCoverage) => void;
  onApplyAllSuggestedAliases?: () => void;
  aliasBusy?: boolean;
};

export function SiteCoverageWarningPanel({
  issues,
  title = "Geofence coverage needs attention",
  onApplySuggestedAlias,
  onApplyAllSuggestedAliases,
  aliasBusy = false,
}: SiteCoverageWarningPanelProps) {
  if (!issues.length) return null;
  const unresolved = issues.filter(item => item.state === "unresolved").length;
  const unlinked = issues.filter(item => item.state === "unlinked").length;
  const suggestions = issues.filter(item => item.state === "unresolved" && item.suggestedSiteId);
  return <div className="notice" style={{ border: "2px solid #b42318", background: "#fff1f0", marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <strong style={{ color: "#b42318" }}>⚠ {title}</strong>
        <div style={{ marginTop: 5 }}>{unresolved} site name{unresolved === 1 ? "" : "s"} need an alias · {unlinked} recognised Site{unlinked === 1 ? "" : "s"} need a geofence link.</div>
        {suggestions.length > 0 && <small style={{ display: "block", marginTop: 5, color: "#365b42" }}>{suggestions.length} warning{suggestions.length === 1 ? " has" : "s have"} one clear Site Master suggestion and can be fixed here without opening Site CRM.</small>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {suggestions.length > 0 && onApplyAllSuggestedAliases && <button className="primary" type="button" disabled={aliasBusy} onClick={onApplyAllSuggestedAliases}>{aliasBusy ? "Applying aliases…" : `Apply ${suggestions.length} clear alias${suggestions.length === 1 ? "" : "es"}`}</button>}
        <Link className="button-like" to="/sites">Open Site CRM</Link>
        <Link className="button-like" to="/geofences">Geofence Integrity</Link>
      </div>
    </div>
    <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
      {issues.slice(0, 10).map((item, index) => <div key={`${item.sourceLabel}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span><strong>{item.sourceLabel}</strong> — {item.state === "unresolved" ? "Site name not recognised" : `${item.siteCode || "Site"} · ${item.siteName || "Site recognised"} has no linked geofence`}. <span>{item.action}</span></span>
        {item.state === "unresolved" && item.suggestedSiteId && onApplySuggestedAlias && <button type="button" disabled={aliasBusy} onClick={() => onApplySuggestedAlias(item)} title={item.suggestionReason || "Add this exact incoming wording as an alias to the suggested Site Master record"} style={{ minHeight: 30, padding: "4px 9px" }}>
          Use {item.suggestedSiteCode ? `${item.suggestedSiteCode} · ` : ""}{item.suggestedSiteName || "suggested Site"}
        </button>}
        {item.state === "unlinked" && <Link className="button-like" to="/geofences" style={{ minHeight: 30, padding: "4px 9px" }}>Link geofence</Link>}
      </div>)}
      {issues.length > 10 && <small>+ {issues.length - 10} more location warning{issues.length - 10 === 1 ? "" : "s"}.</small>}
    </div>
  </div>;
}

export function RunGeofenceWarningPanel({ planningDate }: { planningDate: string }) {
  const token = useAccessToken();
  const check = useApi(useCallback(async () => request<RunLinkageResponse>(`/api/v1/planning/geofence-linkage?date=${encodeURIComponent(planningDate)}`, await token(), { cache: "no-store" }), [planningDate, token]));
  const issues = check.data?.issues || [];
  if (!check.loading && !check.error && !issues.length) return null;
  if (check.error) return <div className="notice" style={{ borderColor: "#b42318" }}>⚠ Geofence coverage check could not be loaded. Runs remain available, but Site/geofence linkage has not been confirmed.</div>;
  if (!issues.length) return null;
  return <div className="notice" style={{ border: "2px solid #b42318", background: "#fff1f0", marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <strong style={{ color: "#b42318" }}>⚠ RUN GEOFENCE COVERAGE — {issues.length} STOP{issues.length === 1 ? "" : "S"} NEED ACTION</strong>
        <div style={{ marginTop: 5 }}>{check.data?.siteNameUnresolved || 0} site name{check.data?.siteNameUnresolved === 1 ? "" : "s"} need an alias · {check.data?.siteMatchedButGeofenceUnlinked || 0} recognised Site{check.data?.siteMatchedButGeofenceUnlinked === 1 ? "" : "s"} need a geofence link.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="button-like" to="/sites">Fix Site aliases</Link>
        <Link className="button-like" to="/geofences">Link geofences</Link>
      </div>
    </div>
    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
      {issues.slice(0, 12).map(issue => <div key={`${issue.loadId}-${issue.stopId}`}>
        <strong>{issue.run} · Stop {issue.sequence} · {issue.stopName.replace(/^Collect · |^Deliver · /i, "")}</strong> — {issue.issue === "SiteNameNotResolved"
          ? "Site name not recognised. Add this wording to the correct Site's aliases."
          : `${issue.siteCode || "Site"} · ${issue.siteName || "Site recognised"} has no active linked geofence.`}
      </div>)}
      {issues.length > 12 && <small>+ {issues.length - 12} more affected run stop{issues.length - 12 === 1 ? "" : "s"}.</small>}
    </div>
  </div>;
}
