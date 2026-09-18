import { useState } from "react";
import { ManualContingencyImport } from "./ManualContingencyImport";
import { OrdersOperationalV2 } from "./OrdersOperationalV2";
import { PlannerPlanImport } from "./PlannerPlanImport";

type ImportTab = "planner" | "orders" | "contingency";

export function ImportCentre({ initialTab = "planner" }: { initialTab?: ImportTab }) {
  const [tab, setTab] = useState<ImportTab>(initialTab);
  return <section className="import-centre">
    <section className="panel import-centre-heading">
      <div className="title-row"><div>
        <p className="eyebrow">Contingency tools</p>
        <h1>Imports</h1>
        <p className="intro">These are fallback and reconciliation tools, not part of the normal daily workflow. Info-mailbox orders should continue through Review orders automatically.</p>
      </div></div>
      <div className="import-centre-tabs" role="tablist" aria-label="Import type">
        <button type="button" className={tab === "planner" ? "primary" : ""} onClick={() => setTab("planner")}>Planner plan</button>
        <button type="button" className={tab === "orders" ? "primary" : ""} onClick={() => setTab("orders")}>Orders</button>
        <button type="button" className={tab === "contingency" ? "primary" : ""} onClick={() => setTab("contingency")}>Manual contingency</button>
      </div>
    </section>
    <div className="import-centre-body">
      {tab === "planner" && <PlannerPlanImport />}
      {tab === "orders" && <OrdersOperationalV2 />}
      {tab === "contingency" && <ManualContingencyImport />}
    </div>
  </section>;
}
