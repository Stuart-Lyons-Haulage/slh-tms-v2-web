import { useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { signalPlanningChange } from "../lib/planningEvents";

type ProposalWarning = { code: string; severity: string; message: string };
type ScoreComponent = { code: string; value: number; explanation: string };
type ProposalAllocation = {
  id: string;
  sourceLineId: string;
  pallets: number;
  palletType?: string;
  collectionSite?: string;
  deliverySite?: string;
  collectionSequence: number;
  deliverySequence: number;
};
type ProposalRun = {
  id: string;
  sequence: number;
  reference: string;
  classification: string;
  capacityPallets: number;
  plannedPallets: number;
  score: number;
  scoreComponents: ScoreComponent[];
  explanations: string[];
  allocations: ProposalAllocation[];
};
type Proposal = {
  id: string;
  planningDate: string;
  version: number;
  status: string;
  classification: string;
  evidenceCapturedAtUtc: string;
  warnings: ProposalWarning[];
  runs: ProposalRun[];
};
type ApplyResult = {
  proposalId: string;
  status: string;
  createdRunCount: number;
  createdLoadIds: string[];
  warnings: string[];
};

type RouteStop = { sequence: number; label: string; kind: "Collect" | "Deliver" };

function routeStops(run: ProposalRun): RouteStop[] {
  const stops: RouteStop[] = [];
  for (const allocation of run.allocations) {
    if (allocation.collectionSite) stops.push({ sequence: allocation.collectionSequence, label: allocation.collectionSite, kind: "Collect" });
    if (allocation.deliverySite) stops.push({ sequence: allocation.deliverySequence, label: allocation.deliverySite, kind: "Deliver" });
  }
  return stops
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label))
    .filter((stop, index, list) => index === 0 || stop.sequence !== list[index - 1].sequence || stop.label !== list[index - 1].label || stop.kind !== list[index - 1].kind);
}

export function BetaRouteProposalReview() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [acknowledgeUnverified, setAcknowledgeUnverified] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string>();

  const totals = useMemo(() => {
    const runs = proposal?.runs || [];
    return {
      runs: runs.length,
      pallets: runs.reduce((sum, run) => sum + run.plannedPallets, 0),
      orderLines: new Set(runs.flatMap((run) => run.allocations.map((allocation) => allocation.sourceLineId))).size,
      warnings: proposal?.warnings.length || 0,
    };
  }, [proposal]);

  async function buildRoutes() {
    setBusy(true);
    setMessage(undefined);
    setProposal(undefined);
    setAcknowledgeUnverified(false);
    try {
      const result = await request<Proposal>(
        `/api/v1/beta-optimiser/day-plan/proposal?planningDate=${encodeURIComponent(planningDate)}`,
        await token(),
        { method: "POST" },
        180000,
      );
      setProposal(result);
      setExpandedRun(result.runs[0]?.id);
      setMessage(result.runs.length
        ? `Beta built ${result.runs.length} proposed route${result.runs.length === 1 ? "" : "s"} from currently unplanned TMS orders. Review them before submitting.`
        : "There is no currently unplanned order work for this date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Beta Optimiser could not build a route proposal.");
    } finally {
      setBusy(false);
    }
  }

  async function submitToRuns() {
    if (!proposal) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await request<ApplyResult>(
        `/api/v1/planning/optimiser/proposals/${proposal.id}/apply`,
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acknowledgeUnverified }),
        },
        180000,
      );
      setProposal((current) => current ? { ...current, status: result.status } : current);
      signalPlanningChange();
      setMessage(`${result.createdRunCount} draft Run${result.createdRunCount === 1 ? "" : "s"} created. Driver, vehicle and trailer allocation remains in Dispatch so the optimiser can use live positioning, yesterday's work and Tacho context.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reviewed proposal could not be submitted to Runs.");
    } finally {
      setBusy(false);
    }
  }

  const unverified = proposal?.classification === "Unverified";
  const blocked = proposal?.classification === "Blocked";
  const canSubmit = Boolean(proposal && proposal.status === "Generated" && proposal.runs.length > 0 && !blocked && (!unverified || acknowledgeUnverified));

  return <section className="panel" style={{ marginBottom: 18, border: "1px solid #b8d6cc", borderRadius: 14, padding: 16, background: "linear-gradient(135deg,#f7fbff 0%,#f4fbf6 100%)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 14, flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Beta Optimiser · route builder</p>
        <h2 style={{ margin: 0 }}>Build routes from TMS orders</h2>
        <p className="hint" style={{ maxWidth: 760, marginBottom: 0 }}>Builds a separate proposal from currently unplanned orders only. Existing/manual Runs stay untouched. Submit only after review; submitted routes become Draft Runs and remain fully editable.</p>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label>Planning date <input type="date" value={planningDate} onChange={(event) => { setPlanningDate(event.target.value); setProposal(undefined); setMessage(undefined); }} disabled={busy} /></label>
        <button type="button" className="primary" onClick={() => void buildRoutes()} disabled={busy || !planningDate}>{busy ? "Optimising…" : "Build Optimised Routes"}</button>
      </div>
    </div>

    {message && <p className="notice inline-notice" style={{ marginTop: 12 }}>{message}</p>}

    {proposal && <div style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
        <div className="panel"><small>Proposed Runs</small><div><strong>{totals.runs}</strong></div></div>
        <div className="panel"><small>Order lines</small><div><strong>{totals.orderLines}</strong></div></div>
        <div className="panel"><small>Pallets</small><div><strong>{totals.pallets}</strong></div></div>
        <div className="panel"><small>Classification</small><div><strong>{proposal.classification}</strong></div></div>
        <div className="panel"><small>Warnings</small><div><strong>{totals.warnings}</strong></div></div>
      </div>

      {proposal.warnings.map((warning) => <p key={`${warning.code}-${warning.message}`} className="notice inline-notice"><strong>{warning.severity}</strong> · {warning.message}</p>)}

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {[...proposal.runs].sort((a, b) => a.sequence - b.sequence).map((run) => {
          const stops = routeStops(run);
          const open = expandedRun === run.id;
          const utilisation = run.capacityPallets > 0 ? Math.round(run.plannedPallets / run.capacityPallets * 100) : undefined;
          return <article key={run.id} className="panel" style={{ borderLeft: `5px solid ${run.classification === "Unverified" ? "#9a6700" : "#2f6f44"}` }}>
            <button type="button" onClick={() => setExpandedRun((current) => current === run.id ? undefined : run.id)} style={{ width: "100%", border: 0, background: "transparent", padding: 0, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div><strong>{run.reference}</strong><br/><small>{stops.map((stop) => stop.label).filter((label, index, list) => index === 0 || label !== list[index - 1]).join(" → ") || "Route evidence unavailable"}</small></div>
                <div style={{ textAlign: "right" }}><strong>{run.plannedPallets}/{run.capacityPallets || "—"} pallets</strong><br/><small>{utilisation == null ? "Capacity unknown" : `${utilisation}% utilisation`} · {open ? "Hide" : "Review"}</small></div>
              </div>
            </button>
            {open && <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {stops.map((stop, index) => <div key={`${run.id}-${stop.sequence}-${stop.kind}-${stop.label}-${index}`}><small><b>{stop.sequence}. {stop.kind}</b> · {stop.label}</small></div>)}
              {run.scoreComponents.map((component) => <div key={`${run.id}-${component.code}`}><small><b>{component.code}</b> · {component.explanation}</small></div>)}
              {run.explanations.map((explanation, index) => <div key={`${run.id}-ex-${index}`}><small>{explanation}</small></div>)}
            </div>}
          </article>;
        })}
      </div>

      <div style={{ borderTop: "1px solid #c8d7df", marginTop: 12, paddingTop: 12 }}>
        {blocked && <p className="notice inline-notice"><strong>Blocked:</strong> this proposal cannot be submitted until its hard constraint is resolved.</p>}
        {unverified && <label style={{ display: "flex", gap: 8, alignItems: "start", marginBottom: 10 }}><input type="checkbox" checked={acknowledgeUnverified} onChange={(event) => setAcknowledgeUnverified(event.target.checked)} disabled={busy || proposal.status !== "Generated"}/><span><strong>Acknowledge incomplete route evidence</strong><br/><small>This permits the route proposal to be copied to Draft Runs; it never overrides a known Tacho/legal-hours breach.</small></span></label>}
        <button type="button" className="primary" disabled={!canSubmit || busy} onClick={() => void submitToRuns()}>{proposal.status === "Applied" ? "Submitted to Runs" : busy ? "Submitting…" : "Submit Plan to Runs"}</button>
      </div>
    </div>}
  </section>;
}
