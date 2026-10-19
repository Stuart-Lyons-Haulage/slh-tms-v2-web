import { CustomerDeliveryTimesActions } from "../components/CustomerDeliveryTimesActions";
import { CustomerLoadPlanActions } from "../components/CustomerLoadPlanActions";
import { CustomerMessagesPanel } from "../components/CustomerMessagesPanel";
import { CustomerCommsSchedule } from "../components/CustomerCommsSchedule";
import { useWorkingDate } from "../lib/workingDate";
import "../customer-comms.css";

/**
 * One place for customer communication: outbound load plans and delivery times built
 * from the live Dispatch plan, and inbound customer messages that are not new orders.
 */
export function CustomerComms() {
  const [date] = useWorkingDate();

  return <div className="customer-comms-page">
    <header className="customer-comms-header">
      <div>
        <span className="smart-eyebrow">Info mailbox</span>
        <h2>Customer comms</h2>
        <p>Send load plans and delivery times from the live plan, and deal with customer requests that are not new orders.</p>
      </div>
      <div className="customer-comms-actions">
        <CustomerLoadPlanActions date={date} />
        <CustomerDeliveryTimesActions date={date} />
      </div>
    </header>
    <CustomerCommsSchedule />
    <CustomerMessagesPanel />
  </div>;
}
