import { useEffect, useState } from "react";
import { BackloadMatchNotifications } from "../components/BackloadMatchNotifications";
import { DispatchBoard } from "../components/dispatch/DispatchBoard";
import { DispatchResourceQuickAdd } from "../components/dispatch/DispatchResourceQuickAdd";
import "../authoritative-dispatch.css";
import "../dispatch-resource-quick-add.css";
import { tomorrowIsoDate } from "../lib/dateUtils";

function currentDispatchDate() {
  return new URLSearchParams(window.location.search).get("date") || tomorrowIsoDate();
}

export function DriverDispatchOperational() {
  const [dispatchDate, setDispatchDate] = useState(currentDispatchDate);
  const [dispatchRevision, setDispatchRevision] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("date", dispatchDate);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [dispatchDate]);

  return <>
    <BackloadMatchNotifications />
    <DispatchBoard
      key={`${dispatchDate}-${dispatchRevision}`}
      planningDate={dispatchDate}
      onPlanningDateChange={setDispatchDate}
      extraActions={<>
        <DispatchResourceQuickAdd onSaved={() => setDispatchRevision(value => value + 1)} />
      </>}
    />
  </>;
}
