import { todayIsoDate, tomorrowIsoDate } from "../lib/dateUtils";
import { shiftIsoDate, useWorkingDate, workingDateLabel } from "../lib/workingDate";

/** The one date control in the header. Every page follows it. */
export function WorkingDateControl() {
  const [date, setDate] = useWorkingDate();
  const today = todayIsoDate();
  const tomorrow = tomorrowIsoDate();
  return <div className="working-date" role="group" aria-label="Working date">
    <button type="button" className="working-date-step" onClick={() => setDate(shiftIsoDate(date, -1))} aria-label="Previous day">‹</button>
    <label className="working-date-pick" title="Change the date every screen shows">
      <span>{workingDateLabel(date)}</span>
      <input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Working date" />
    </label>
    <button type="button" className="working-date-step" onClick={() => setDate(shiftIsoDate(date, 1))} aria-label="Next day">›</button>
    <button type="button" className={`working-date-quick${date === today ? " on" : ""}`} onClick={() => setDate(today)}>Today</button>
    <button type="button" className={`working-date-quick${date === tomorrow ? " on" : ""}`} onClick={() => setDate(tomorrow)}>Tomorrow</button>
  </div>;
}
