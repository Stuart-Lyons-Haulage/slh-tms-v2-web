import type { DispatchAvailableTimeMap } from "./dispatchBoardState";
import type { DispatchDriverDto, DispatchLockFailure } from "./types";

type Props = {
  drivers: DispatchDriverDto[];
  availableTimes: DispatchAvailableTimeMap;
  failures: DispatchLockFailure[];
};

export function ComplianceWarningBanner({ drivers, availableTimes, failures }: Props) {
  const blocked = drivers.filter(driver => driver.isBlocked).length;
  const returnPriority = drivers.filter(driver => driver.needsReturn).length;
  const tachoWarnings = Object.values(availableTimes).filter(row => Boolean(row.breachDetail) || row.wtdStatus === "red").length;
  const uniqueFailedDrivers = new Set(failures.map(failure => failure.driverId).filter(Boolean)).size;

  if (blocked === 0 && returnPriority === 0 && tachoWarnings === 0 && failures.length === 0) {
    return <div className="smart-compliance-banner clear">
      <strong>Dispatch compliance clear</strong>
      <span>No current driver availability, return-priority or lock-validation warnings.</span>
    </div>;
  }

  return <div className="smart-compliance-banner warning" role="status">
    <strong>Planner attention</strong>
    <div className="smart-compliance-items">
      {blocked > 0 && <span><b>{blocked}</b> unavailable</span>}
      {returnPriority > 0 && <span><b>{returnPriority}</b> need return planning</span>}
      {tachoWarnings > 0 && <span><b>{tachoWarnings}</b> Tacho/WTD warnings</span>}
      {failures.length > 0 && <span><b>{uniqueFailedDrivers || failures.length}</b> lock failures</span>}
    </div>
  </div>;
}
