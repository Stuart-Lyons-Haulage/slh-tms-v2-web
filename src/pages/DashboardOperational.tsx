import { useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { api, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { useWorkingDate, workingDateLabel, shiftIsoDate } from "../lib/workingDate";
import { getMasterDispatchData, type MasterDriver } from "../api/master";

/**
 * Today: what needs someone now, worst first, each line opening the exact screen.
 * It shows exceptions only; the detail lives on the screen the line links to.
 */

type Tone = "red" | "amber" | "green" | "grey";
type Attention = { key: string; tone: Tone; count: number; title: string; detail: string; to: string; action: string };

type OrderChange = { id: string; change: { stage: "LiveRoute" | "OnRun" | "NotPlanned"; reference: string } };
type ComplianceSummary = { summary: { green: number; amber: number; red: number } };
type Feed = { name: string; configured: boolean; state: string; ageMinutes?: number | null };
type SyncState = { providers: Feed[] };
type ForecastDay = { date: string; dayRequired: number; nightRequired: number; availableDrivers: number; shortfall: number; agencyConfirmed: number; plannedRunCount: number };
type PalletSummary = { summary: { ordered: number; planned: number; outstanding: number; overplanned: number; orders: number; runs: number } };

const toneRank: Record<Tone, number> = { red: 0, amber: 1, grey: 2, green: 3 };

function daysUntil(value: string | undefined, today: string) {
  if (!value) return null;
  const target = Date.parse(`${value.slice(0, 10)}T12:00:00Z`);
  const base = Date.parse(`${today}T12:00:00Z`);
  return Number.isNaN(target) ? null : Math.round((target - base) / 86_400_000);
}

function documentExpiries(drivers: MasterDriver[] | undefined, today: string) {
  let expired = 0;
  let due = 0;
  for (const driver of drivers?.filter(item => item.isActive) || []) {
    for (const value of [driver.cpcExpiry, driver.digitalTachoCardExpiry, driver.licenceExpiry]) {
      const days = daysUntil(value, today);
      if (days == null) continue;
      if (days < 0) expired++;
      else if (days <= 30) due++;
    }
  }
  return { expired, due };
}

function plural(count: number, word: string) { return `${count} ${word}${count === 1 ? "" : "s"}`; }
function words(count: number, word: string) { return plural(count, word).replace(/^\d+\s/, ""); }

export function DashboardOperational() {
  const token = useAccessToken();
  const [date] = useWorkingDate();
  const today = todayIsoDate();

  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const pallets = useApi(useCallback(async () => request<PalletSummary>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token(), undefined, 40000), [date, token]));
  const reviewCounts = useApi(useCallback(async () => request<Record<string, number>>(`/api/v1/staging/queue/date-counts?from=${encodeURIComponent(shiftIsoDate(today, -3))}&to=${encodeURIComponent(shiftIsoDate(today, 10))}`, await token()), [today, token]));
  const changes = useApi(useCallback(async () => request<OrderChange[]>("/api/v1/order-changes?open=true", await token()), [token]));
  const forecast = useApi(useCallback(async () => request<ForecastDay[]>(`/api/v1/driver-forecast?from=${date}&to=${date}`, await token(), undefined, 30000), [date, token]));
  const messages = useApi(useCallback(async () => api.customerCommunications(await token(), "PendingReview", undefined, 100), [token]));
  const sync = useApi(useCallback(async () => request<SyncState>("/api/v1/system-sync/state", await token(), undefined, 30000), [token]));
  const compliance = useApi(useCallback(async () => request<ComplianceSummary>(`/api/v1/daily-compliance/report?date=${encodeURIComponent(today)}`, await token(), undefined, 90000), [today, token]));
  const master = useApi(useCallback(async () => getMasterDispatchData(await token()), [token]));

  const { refresh: refreshReadiness } = readiness;
  const { refresh: refreshPallets } = pallets;
  const { refresh: refreshReviewCounts } = reviewCounts;
  const { refresh: refreshChanges } = changes;
  const { refresh: refreshMessages } = messages;
  const { refresh: refreshSync } = sync;
  const { refresh: refreshForecast } = forecast;
  const { refresh: refreshCompliance } = compliance;
  const { refresh: refreshMaster } = master;
  const refreshFast = useCallback(() => Promise.allSettled([refreshReadiness(), refreshPallets(), refreshReviewCounts(), refreshChanges(), refreshMessages(), refreshSync()]).then(() => undefined),
    [refreshReadiness, refreshPallets, refreshReviewCounts, refreshChanges, refreshMessages, refreshSync]);
  const refreshSlow = useCallback(() => Promise.allSettled([refreshForecast(), refreshCompliance(), refreshMaster()]).then(() => undefined), [refreshForecast, refreshCompliance, refreshMaster]);
  useEffect(() => startVisiblePolling(refreshFast, 60_000), [refreshFast]);
  useEffect(() => startVisiblePolling(refreshSlow, 300_000), [refreshSlow]);

  const items = useMemo(() => {
    const list: Attention[] = [];
    const add = (item: Attention) => { if (item.count > 0) list.push(item); };
    const dateQuery = `?date=${date}`;
    const open = changes.data || [];
    const liveChanges = open.filter(item => item.change.stage === "LiveRoute");
    const runChanges = open.filter(item => item.change.stage === "OnRun");
    add({ key: "live-changes", tone: "red", count: liveChanges.length, title: `${words(liveChanges.length, "order")} changed after dispatch`, detail: `Amend the Samsara route and tell the driver: ${liveChanges.slice(0, 3).map(item => item.change.reference).join(", ")}${liveChanges.length > 3 ? "…" : ""}`, to: "/driver-dispatch", action: "Open Dispatch" });
    add({ key: "run-changes", tone: "amber", count: runChanges.length, title: `${words(runChanges.length, "change")} to check on planned runs`, detail: "Amended or cancelled after the run was built.", to: "/driver-dispatch", action: "Open Dispatch" });

    const counts = reviewCounts.data || {};
    const forDate = counts[date] || 0;
    const otherDates = Object.entries(counts).filter(([day, count]) => day !== date && count);
    const elsewhere = otherDates.reduce((sum, [, count]) => sum + (count || 0), 0);
    add({ key: "review", tone: "amber", count: forDate, title: `${words(forDate, "order")} waiting for review`, detail: `For ${workingDateLabel(date)}. Approve them to get them into the plan.`, to: `/staging${dateQuery}`, action: "Review orders" });
    add({ key: "review-other", tone: "grey", count: elsewhere, title: `${words(elsewhere, "order")} waiting on other dates`, detail: otherDates.slice(0, 5).map(([day, count]) => `${workingDateLabel(day)}: ${count}`).join(" · "), to: "/staging", action: "Review orders" });

    const summary = pallets.data?.summary;
    if (summary) {
      add({ key: "to-plan", tone: "amber", count: summary.outstanding, title: `${words(summary.outstanding, "pallet")} still to plan`, detail: `${summary.planned} of ${summary.ordered} planned for ${workingDateLabel(date)}.`, to: `/pallet-control${dateQuery}`, action: "Open Pallet Order" });
      add({ key: "over-plan", tone: "red", count: summary.overplanned, title: `${words(summary.overplanned, "pallet")} over-planned`, detail: "More on runs than was ordered.", to: `/pallet-control${dateQuery}`, action: "Open Pallet Order" });
    }

    const ready = readiness.data;
    if (ready) {
      add({ key: "vor", tone: "red", count: ready.vorConflicts, title: `${words(ready.vorConflicts, "run")} on a vehicle that is off road`, detail: "Swap the vehicle before the run goes out.", to: `/driver-dispatch${dateQuery}`, action: "Open Dispatch" });
      add({ key: "unallocated", tone: "amber", count: ready.missingAllocations, title: `${words(ready.missingAllocations, "run")} without a driver or vehicle`, detail: `${ready.runs - ready.missingAllocations} of ${ready.runs} runs fully allocated.`, to: `/driver-dispatch${dateQuery}`, action: "Open Dispatch" });
      add({ key: "tacho", tone: "amber", count: ready.tachoConcerns, title: `${words(ready.tachoConcerns, "driver")} with an hours or rest concern`, detail: "Check driving time and weekly rest before allocating.", to: `/driver-dispatch${dateQuery}`, action: "Open Dispatch" });
      add({ key: "no-location", tone: "amber", count: ready.stopCoordinateGaps, title: `${words(ready.stopCoordinateGaps, "stop")} without a map location`, detail: "Samsara cannot route these. Fix the site in Master data.", to: "/master-data", action: "Open Master data" });
    }

    const day = forecast.data?.[0];
    if (day) add({ key: "drivers-short", tone: "red", count: day.shortfall, title: `${words(day.shortfall, "driver")} short`, detail: `${day.dayRequired + day.nightRequired} needed, ${day.availableDrivers} available, ${day.agencyConfirmed} agency confirmed.`, to: "/staffing", action: "Open Drivers" });

    if (compliance.data) {
      add({ key: "checks-red", tone: "red", count: compliance.data.summary.red, title: `${words(compliance.data.summary.red, "vehicle")} used without a walkround check`, detail: "Today. Chase the driver or record the paper check.", to: "/compliance?status=red", action: "Open Vehicle checks" });
      add({ key: "checks-amber", tone: "amber", count: compliance.data.summary.amber, title: `${words(compliance.data.summary.amber, "vehicle check")} to confirm`, detail: "Today. Evidence is incomplete or late.", to: "/compliance?status=amber", action: "Open Vehicle checks" });
    }

    const expiries = documentExpiries(master.data?.drivers, today);
    add({ key: "docs-expired", tone: "red", count: expiries.expired, title: `${words(expiries.expired, "driver document")} expired`, detail: "Licence, CPC or tacho card. The driver cannot be used until renewed.", to: "/staffing?tab=files", action: "Open Drivers" });
    add({ key: "docs-due", tone: "amber", count: expiries.due, title: `${words(expiries.due, "driver document")} due in 30 days`, detail: "Licence, CPC or tacho card renewals.", to: "/staffing?tab=files", action: "Open Drivers" });

    const waiting = messages.data?.length || 0;
    add({ key: "messages", tone: "amber", count: waiting, title: `${words(waiting, "customer message")} to answer`, detail: "Requests and questions from the info mailbox that are not orders.", to: "/customer-comms", action: "Open Customer Comms" });

    const feeds = sync.data?.providers.filter(feed => feed.configured) || [];
    const down = feeds.filter(feed => feed.state !== "current" && feed.state !== "delayed");
    const slow = feeds.filter(feed => feed.state === "delayed");
    add({ key: "feeds-down", tone: "red", count: down.length, title: `${words(down.length, "data feed")} not updating`, detail: down.map(feed => feed.name).join(", "), to: "/admin/integrations", action: "Open System health" });
    add({ key: "feeds-slow", tone: "grey", count: slow.length, title: `${words(slow.length, "data feed")} running late`, detail: slow.map(feed => feed.name).join(", "), to: "/admin/integrations", action: "Open System health" });

    return list.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  }, [changes.data, compliance.data, date, forecast.data, master.data, messages.data, pallets.data, readiness.data, reviewCounts.data, sync.data, today]);

  const failures = [readiness, pallets, reviewCounts, changes, forecast, messages, sync].filter(item => item.error).length;
  const loading = [readiness, pallets, reviewCounts, changes].some(item => item.loading && !item.data);
  const summary = pallets.data?.summary;
  const ready = readiness.data;
  const day = forecast.data?.[0];
  const redCount = items.filter(item => item.tone === "red").length;

  return <section className="ui-page today-page">
    <div className="ui-page-head">
      <div>
        <h1>Today</h1>
        <p>{redCount ? `${plural(redCount, "thing")} need action now.` : items.length ? "Nothing urgent. A few things to check." : loading ? "Checking…" : "All clear."} Plan figures are for {workingDateLabel(date)}.</p>
      </div>
      <div className="ui-page-actions"><button type="button" onClick={() => void Promise.allSettled([refreshFast(), refreshSlow()])}>Refresh</button></div>
    </div>

    <div className="ui-grid today-strip">
      <Link className="ui-metric" to={`/staging?tab=live&date=${date}`}><span>Orders</span><strong>{summary?.orders ?? "—"}</strong><small>approved for {workingDateLabel(date)}</small></Link>
      <Link className={`ui-metric ${summary?.outstanding ? "amber" : summary ? "green" : ""}`} to={`/pallet-control?date=${date}`}><span>Pallets planned</span><strong>{summary ? `${summary.planned}/${summary.ordered}` : "—"}</strong><small>{summary ? `${summary.outstanding} to plan` : "loading"}</small></Link>
      <Link className={`ui-metric ${ready?.missingAllocations ? "amber" : ready ? "green" : ""}`} to={`/driver-dispatch?date=${date}`}><span>Runs allocated</span><strong>{ready ? `${ready.runs - ready.missingAllocations}/${ready.runs}` : "—"}</strong><small>{ready ? `${ready.missingAllocations} need a driver or vehicle` : "loading"}</small></Link>
      <Link className={`ui-metric ${day && day.shortfall > 0 ? "red" : day ? "green" : ""}`} to="/staffing"><span>Drivers</span><strong>{day ? `${day.availableDrivers}/${day.dayRequired + day.nightRequired}` : "—"}</strong><small>{day ? day.shortfall > 0 ? `${day.shortfall} short` : "available / needed" : "loading"}</small></Link>
    </div>

    <section className="ui-card">
      <div className="ui-card-head"><h2>Needs you now</h2>{failures > 0 && <span className="ui-chip amber">{plural(failures, "check")} could not load</span>}</div>
      {loading && !items.length ? <div className="ui-empty">Checking orders, runs and drivers…</div>
        : items.length ? <div className="ui-attention">
          {items.map(item => <Link key={item.key} to={item.to} className={item.tone}>
            <div className="ui-attention-row"><b>{item.count}</b><div><strong>{item.title}</strong><small>{item.detail}</small></div></div>
            <span className="ui-go">{item.action} →</span>
          </Link>)}
        </div>
          : <div className="ui-empty">Nothing needs action. Orders are reviewed, runs are allocated and drivers are covered.</div>}
    </section>
  </section>;
}
