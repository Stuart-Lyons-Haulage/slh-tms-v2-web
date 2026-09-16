import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { SILENT_API_REFRESH_EVENT } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { SourceEmailEvidenceDrawer } from "../components/SourceEmailEvidenceDrawer";
import { IntakeHealthPanel } from "../components/IntakeHealthPanel";
import { JobsOperational } from "./JobsOperational";
import { OrderReviewBulk } from "./OrderReviewBulk";
import { UndatedOrderReviewQueue } from "./UndatedOrderReviewQueue";

type OrderControlTab = "review" | "live";
type NwfRepairResponse = { repaired: number; message: string };

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function refreshVisibleReviewData() {
  window.dispatchEvent(new Event(SILENT_API_REFRESH_EVENT));
}

export function OrderControl({ initialTab = "review" }: { initialTab?: OrderControlTab }) {
  const token = useAccessToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<OrderControlTab>(initialTab);
  const [repairNotice, setRepairNotice] = useState<string>();
  const reviewId = searchParams.get("reviewId")?.trim() || undefined;
  const sourceEmailStagingId = searchParams.get("sourceEmail") === "1" ? reviewId : undefined;
  const selectedDate = searchParams.get("date") || localDate();

  useEffect(() => { if (reviewId) setTab("review"); }, [reviewId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await request<NwfRepairResponse>("/api/v1/staging/orders/repair-nwf-references", await token(), { method: "POST" });
        if (!active || result.repaired <= 0) return;
        setRepairNotice(result.message);
        refreshVisibleReviewData();
      } catch { /* compatibility repair is optional; normal review loading remains authoritative */ }
    })();
    return () => { active = false; };
  }, [token]);

  useEffect(() => startVisiblePolling(refreshVisibleReviewData, 60_000), []);

  function updateDate(nextDate: string) {
    const next = new URLSearchParams(searchParams);
    if (nextDate) next.set("date", nextDate);
    else next.delete("date");
    setSearchParams(next, { replace: true });
  }

  function closeSourceEmail() {
    const next = new URLSearchParams(searchParams);
    next.delete("sourceEmail");
    setSearchParams(next, { replace: true });
  }

  return <>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end", gap: 16 }}>
        <div>
          <p className="eyebrow">Order control</p>
          <h1>Manage imported jobs</h1>
        </div>
        <div className="title-actions" style={{ alignItems: "center", gap: 8 }}>
          <label className="dashboard-date">Date <input type="date" value={selectedDate} onChange={(event) => updateDate(event.target.value)} /></label>
          <div role="tablist" aria-label="Order control view" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={tab === "review" ? "primary" : ""} onClick={() => setTab("review")} role="tab" aria-selected={tab === "review"}>Waiting for review</button>
            <button type="button" className={tab === "live" ? "primary" : ""} onClick={() => setTab("live")} role="tab" aria-selected={tab === "live"}>Approved / live loads</button>
          </div>
        </div>
      </div>
      {repairNotice && <p className="notice inline-notice" style={{ marginBottom: 0 }}>{repairNotice}</p>}
    </section>
    <IntakeHealthPanel />
    {tab === "review" ? <><UndatedOrderReviewQueue /><OrderReviewBulk date={selectedDate} /></> : <JobsOperational date={selectedDate} />}
    {sourceEmailStagingId && <SourceEmailEvidenceDrawer stagingId={sourceEmailStagingId} onClose={closeSourceEmail} />}
  </>;
}
