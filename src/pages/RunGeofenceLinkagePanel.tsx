import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";

type LinkageRecord = {
  loadId: string;
  run: string;
  stopId: string;
  sequence: number;
  stopName: string;
  siteMatched: boolean;
  siteCode?: string;
  siteName?: string;
  geofenceLinked: boolean;
  geofenceName?: string;
  issue?: string;
  visitRecorded: boolean;
  latestEnterUtc?: string;
  latestExitUtc?: string;
  confirmedAtUtc?: string;
  evidence?: string;
};
type LinkageResponse = {
  linkedStops: number;
  stops: number;
  siteNameUnresolved: number;
  siteMatchedButGeofenceUnlinked: number;
  records: LinkageRecord[];
};
type RunLinkage = {
  loadId: string;
  run: string;
  stops: LinkageRecord[];
  linked: number;
  hits: number;
};

function evidenceState(stop: LinkageRecord) {
  if (!stop.geofenceLinked) return stop.siteMatched ? "NO GEOFENCE" : "SITE UNRESOLVED";
  if (stop.latestExitUtc) return "DEPARTED";
  if (stop.visitRecorded) return "ON SITE";
  return "LINKED";
}

function time(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function InlineRunLinkage({ run }: { run: RunLinkage }) {
  return <details className={`ops-row-geofence ${run.linked < run.stops.length ? "needs-link" : ""}`}>
    <summary>
      <strong>Geofences {run.linked}/{run.stops.length} linked</strong>
      <span>{run.hits} hit{run.hits === 1 ? "" : "s"} · open for time in / time out</span>
    </summary>
    <div className="ops-row-geofence-stops">
      {run.stops.map(stop => <div key={stop.stopId} className={`ops-row-geofence-stop ${stop.visitRecorded ? "hit" : ""} ${!stop.geofenceLinked ? "needs-link" : ""}`}>
        <span className="stop-name"><b>{stop.sequence}. {stop.stopName}</b><small>{stop.geofenceName || stop.siteName || "Geofence not resolved"}</small></span>
        <span><small>Status</small><b>{evidenceState(stop)}</b></span>
        <span><small>Time in</small><b>{time(stop.latestEnterUtc)}</b></span>
        <span><small>Time out</small><b>{time(stop.latestExitUtc)}</b></span>
      </div>)}
    </div>
  </details>;
}

/**
 * Per-run geofence linkage and hit evidence shared by the signed-in wallboard and a
 * paired read-only TV. Both modes call the same API projection and portal the same strip
 * into the matching run row, so progress cannot diverge just because the display is public.
 */
export function RunGeofenceLinkagePanel({ tvAccessKey }: { tvAccessKey?: string } = {}) {
  const token = useAccessToken();
  const date = todayIsoDate();
  const [data, setData] = useState<LinkageResponse>();
  const [, setError] = useState<string>();
  const [targetVersion, setTargetVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const access = tvAccessKey ? undefined : await token();
      const init = tvAccessKey
        ? { cache: "no-store" as const, headers: { "X-TV-Display-Key": tvAccessKey, "X-TMS-TV-Key": tvAccessKey } }
        : { cache: "no-store" as const };
      const response = await request<LinkageResponse>(`/api/v1/planning/geofence-linkage?date=${encodeURIComponent(date)}`, access, init, 90000);
      setData(response);
      setError(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Geofence linkage diagnostics unavailable.");
    }
  }, [date, token, tvAccessKey]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const table = document.querySelector(".ops-board-table");
    const root = table || document.body;
    const syncTargets = () => setTargetVersion(value => value + 1);
    const observer = new MutationObserver(syncTargets);
    observer.observe(root, { childList: true, subtree: true });
    syncTargets();
    return () => observer.disconnect();
  }, []);

  const runs = useMemo<RunLinkage[]>(() => {
    const grouped = new Map<string, LinkageRecord[]>();
    for (const record of data?.records || []) {
      const rows = grouped.get(record.loadId) || [];
      rows.push(record);
      grouped.set(record.loadId, rows);
    }
    return [...grouped.values()].map(stops => ({
      loadId: stops[0].loadId,
      run: stops[0].run,
      stops: [...stops].sort((a, b) => a.sequence - b.sequence),
      linked: stops.filter(stop => stop.geofenceLinked).length,
      hits: stops.filter(stop => stop.visitRecorded).length,
    }));
  }, [data]);

  void targetVersion;
  return <>{runs.map(run => {
    const target = document.querySelector<HTMLElement>(`.ops-board-row[data-row-id="${run.loadId}"]`);
    return target ? createPortal(<InlineRunLinkage run={run} />, target, run.loadId) : null;
  })}</>;
}
