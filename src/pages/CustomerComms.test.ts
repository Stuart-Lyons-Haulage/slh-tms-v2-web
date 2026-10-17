import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import page from "./CustomerComms.tsx?raw";
import deliveryTimes from "../components/CustomerDeliveryTimesActions.tsx?raw";
import messages from "../components/CustomerMessagesPanel.tsx?raw";
import dispatch from "./DriverDispatchOperational.tsx?raw";

describe("customer comms page", () => {
  it("is routed and in the main navigation", () => {
    expect(app).toContain("['/customer-comms', 'Customer Comms']");
    expect(app).toContain('<Route path="/customer-comms" element={<CustomerComms />} />');
  });

  it("puts load plans, delivery times and customer messages together, keeping Dispatch uncluttered", () => {
    expect(page).toContain("<CustomerLoadPlanActions date={date} />");
    expect(page).toContain("<CustomerDeliveryTimesActions date={date} />");
    expect(page).toContain("<CustomerMessagesPanel />");
    expect(dispatch).not.toContain("CustomerLoadPlanActions");
    expect(dispatch).not.toContain("CustomerDeliveryTimesActions");
  });

  it("sends delivery times through the existing load-plan outbox endpoints", () => {
    expect(deliveryTimes).toContain("/api/v1/customer-load-plans/delivery-times?date=");
    expect(deliveryTimes).toContain("/api/v1/customer-load-plans/delivery-times/queue");
  });

  it("lists pending customer messages and marks them handled", () => {
    expect(messages).toContain('api.customerCommunications(await token(), "PendingReview"');
    expect(messages).toContain("api.approveCustomerCommunication(");
    expect(messages).toContain("BookingChange");
  });
});
