import "../mobile-planner.css";
import { RunPlannerLive } from "./RunPlannerLive";
import { useWorkingDate } from "../lib/workingDate";

function clickPlannerButton(pattern: RegExp) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".simple-planner-toolbar button"));
  const button = buttons.find(item => pattern.test(item.textContent || ""));
  button?.click();
}

export function PlannerEnhanced() {
  const [date] = useWorkingDate();

  return <section className="planner-enhanced-page">
    <div className="panel planner-action-bar">
      <button className="primary" type="button" onClick={() => clickPlannerButton(/add run/i)}>Add Run</button>
      <button type="button" onClick={() => clickPlannerButton(/^refresh$/i)}>Refresh</button>
      <span className="planner-action-spacer" />
      <span className="planner-highlight-dot" title="Warnings and planning guidance are shown on the item they relate to rather than taking permanent screen space.">!</span>
    </div>
    <RunPlannerLive planningDate={date} />
  </section>;
}
