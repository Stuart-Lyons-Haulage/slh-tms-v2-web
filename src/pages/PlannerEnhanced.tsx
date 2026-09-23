import { useState } from "react";
import { RunPlannerLive } from "./RunPlannerLive";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clickPlannerButton(pattern: RegExp) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".simple-planner-toolbar button"));
  const button = buttons.find(item => pattern.test(item.textContent || ""));
  button?.click();
}

export function PlannerEnhanced() {
  const [date, setDate] = useState(localDate());

  return <section className="planner-enhanced-page">
    <div className="panel planner-action-bar">
      <label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <button className="primary" type="button" onClick={() => clickPlannerButton(/add run/i)}>Add Run</button>
      <button type="button" onClick={() => clickPlannerButton(/^refresh$/i)}>Refresh</button>
      <span className="planner-action-spacer" />
      <span className="planner-highlight-dot" title="Warnings and planning guidance are shown on the item they relate to rather than taking permanent screen space.">!</span>
    </div>
    <RunPlannerLive planningDate={date} />
  </section>;
}
