import { useCallback, useMemo, useState } from "react";
import { ExportCentre as LegacyExportCentre } from "./Pages";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

type CustomerEtaEvidenceRecord = {
  loadId: string;
  loadReference: string;
  loadStatus: string;
  stopId: string;
  sequence: number;
  stopName: string;
  isDelivery: boolean;
  orderReference?: string;
  customerCode?: string;
  plannedDriverName?: string;
  tachoDriverName?: string;
  driverEvidenceStatus: string;
  vehicleRegistration?: string;
  latestTrackingUtc?: string;
  etaUtc?: string;
  etaSource: string;
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  risk: string;
  breakMinutesIncluded: number;
  tachoStatus: string;
  evidenceStatus: string;
  customerPromiseReady: boolean;
};

type CustomerEtaEvidenceSummary = {
  planningDate: string;
  generatedAtUtc: string;
  source: string;
  recordCount: number;
  deliveryCount: number;
  customerPromiseReadyCount: number;
  records: CustomerEtaEvidenceRecord[];
};

type CustomerContact = {
  id: string;
  customerCode: string;
  name: string;
  email?: string;
  mobileNumber?: string;
  receivesEtaUpdates: boolean;
  active: boolean;
};

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/tms-api").replace(/\/$/, "");

function localDateTime(value?: string) {
  if (!value) return "TBC";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportCentre() {
  const token = useAccessToken();
  const [date, setDate] = useState(todayIsoDate());
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [manualRecipient, setManualRecipient] = useState("");
  const [customerMessage, setCustomerMessage] = useState<string>();

  const evidence = useApi(useCallback(async () =>
    request<CustomerEtaEvidenceSummary>(
      `/api/v1/operations/customer-eta-evidence?date=${encodeURIComponent(date)}`,
      await token(),
      undefined,
      60000,
    ), [date, token]));

  const contacts = useApi(useCallback(async () =>
    request<CustomerContact[]>("/api/v1/lookups/customer-contacts", await token()), [token]));

  const customerCodes = useMemo(() => [...new Set((evidence.data?.records || [])
    .filter(record => record.isDelivery && record.customerCode)
    .map(record => record.customerCode!))].sort((a, b) => a.localeCompare(b)), [evidence.data]);

  const effectiveCustomer = selectedCustomer && customerCodes.includes(selectedCustomer)
    ? selectedCustomer
    : customerCodes[0] || "";

  const customerRecords = useMemo(() => (evidence.data?.records || [])
    .filter(record => record.isDelivery && record.customerCode === effectiveCustomer)
    .sort((left, right) => (left.etaUtc || "").localeCompare(right.etaUtc || "")), [evidence.data, effectiveCustomer]);

  const customerContacts = useMemo(() => (contacts.data || [])
    .filter(contact => contact.active && contact.customerCode === effectiveCustomer && contact.email)
    .sort((left, right) => Number(right.receivesEtaUpdates) - Number(left.receivesEtaUpdates) || left.name.localeCompare(right.name)), [contacts.data, effectiveCustomer]);

  const selectedContacts = customerContacts.filter(contact => selectedContactIds.includes(contact.id));
  const selectedRecipients = [...new Set([
    ...selectedContacts.map(contact => contact.email!).filter(Boolean),
    ...manualRecipient.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean),
  ])];

  const etaBody = useMemo(() => {
    if (!effectiveCustomer || customerRecords.length === 0) return "";
    const lines = customerRecords.map(record => [
      `${record.orderReference || record.loadReference} · ${record.stopName}`,
      `ETA: ${localDateTime(record.etaUtc)} (${record.etaSource})`,
      `Vehicle: ${record.vehicleRegistration || "TBC"} · Driver: ${record.tachoDriverName || record.plannedDriverName || "TBC"}`,
      `Delivery window: ${localDateTime(record.deliveryWindowStartUtc)} - ${localDateTime(record.deliveryWindowEndUtc)}`,
      `Status: ${record.risk}${record.customerPromiseReady ? " · Customer promise ready" : " · Planner verification required"}`,
    ].join("\n"));
    return [
      `Good morning,`,
      ``,
      `Please find the current ETA update for ${effectiveCustomer} for ${date}.`,
      ``,
      ...lines.flatMap((line, index) => index === lines.length - 1 ? [line] : [line, ""]),
      ``,
      `Regards,`,
      `Stuart Lyons Haulage`,
    ].join("\n");
  }, [customerRecords, date, effectiveCustomer]);

  function changeCustomer(value: string) {
    setSelectedCustomer(value);
    setSelectedContactIds([]);
    setManualRecipient("");
    setCustomerMessage(undefined);
  }

  function toggleContact(contactId: string) {
    setSelectedContactIds(current => current.includes(contactId)
      ? current.filter(id => id !== contactId)
      : [...current, contactId]);
  }

  function selectSuggestedContacts() {
    setSelectedContactIds(customerContacts.filter(contact => contact.receivesEtaUpdates).map(contact => contact.id));
  }

  async function copyCustomerExport() {
    if (!effectiveCustomer) {
      setCustomerMessage("Select a customer before preparing an ETA export.");
      return;
    }
    if (selectedRecipients.length === 0) {
      setCustomerMessage("Select at least one customer contact, or enter a recipient manually.");
      return;
    }
    const subject = `SLH ETA Update - ${effectiveCustomer} - ${date}`;
    await navigator.clipboard.writeText([
      `To: ${selectedRecipients.join("; ")}`,
      `Subject: ${subject}`,
      ``,
      etaBody,
    ].join("\n"));
    setCustomerMessage(`ETA email copy prepared for ${effectiveCustomer}. Nothing has been sent automatically.`);
  }

  function downloadCustomerExport() {
    if (!effectiveCustomer || customerRecords.length === 0) {
      setCustomerMessage("No customer ETA rows are available for the selected customer and date.");
      return;
    }
    downloadCsv(`SLH-${effectiveCustomer}-ETA-${date}.csv`, [
      ["Customer", "Order", "Run", "Delivery stop", "Vehicle", "Driver", "ETA", "ETA source", "Window start", "Window end", "Risk", "Customer promise ready", "Recipients selected"],
      ...customerRecords.map(record => [
        effectiveCustomer,
        record.orderReference,
        record.loadReference,
        record.stopName,
        record.vehicleRegistration,
        record.tachoDriverName || record.plannedDriverName,
        record.etaUtc,
        record.etaSource,
        record.deliveryWindowStartUtc,
        record.deliveryWindowEndUtc,
        record.risk,
        record.customerPromiseReady ? "Yes" : "No",
        selectedRecipients.join("; "),
      ]),
    ]);
    setCustomerMessage(`${effectiveCustomer} ETA export downloaded. Nothing has been emailed automatically.`);
  }

  async function downloadEvidence() {
    setDownloading(true);
    setMessage(undefined);
    try {
      const accessToken = await token();
      const response = await fetch(
        `${baseUrl}/api/v1/operations/customer-eta-evidence/export.csv?date=${encodeURIComponent(date)}`,
        { headers: { Accept: "text/csv", Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail || detail?.message || `ETA evidence export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SLH-customer-ETA-evidence-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Customer ETA evidence exported with Tacho, tracking, geofence and route proof.");
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Customer ETA evidence could not be exported.");
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Customer service evidence</p>
          <h1>Customer ETA export</h1>
          <p className="intro">Select the customer and recipients yourself, review the live ETA evidence, then copy or export it. Recipient suggestions come from Customer Contacts; nothing is emailed automatically.</p>
        </div>
        <label className="dashboard-date">Operating date <input type="date" value={date} onChange={event => { setDate(event.target.value); setSelectedCustomer(""); setSelectedContactIds([]); setManualRecipient(""); }} /></label>
      </div>
      <div className="metrics">
        <article><span>Delivery stops</span><strong>{evidence.data?.deliveryCount ?? "—"}</strong><small>In the evidence export</small></article>
        <article><span>Customer-ready ETA</span><strong>{evidence.data?.customerPromiseReadyCount ?? "—"}</strong><small>Fresh live tracking + matched Tacho duty</small></article>
        <article><span>Customers</span><strong>{customerCodes.length || "—"}</strong><small>Available for individual ETA export</small></article>
      </div>
      {evidence.error && <p className="notice inline-notice">ETA evidence check: {evidence.error}</p>}
      {contacts.error && <p className="notice inline-notice">Customer contacts could not refresh: {contacts.error}</p>}

      <div className="panel">
        <div className="title-row">
          <div>
            <p className="eyebrow">Planner controlled</p>
            <h2>Prepare customer ETA</h2>
          </div>
          <span>{customerRecords.length} delivery{customerRecords.length === 1 ? "" : "ies"}</span>
        </div>
        <div className="field-grid">
          <label>Customer
            <select value={effectiveCustomer} onChange={event => changeCustomer(event.target.value)} disabled={customerCodes.length === 0}>
              {customerCodes.length === 0 && <option value="">No customer ETA records</option>}
              {customerCodes.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="wide">Additional recipient
            <input type="text" value={manualRecipient} onChange={event => setManualRecipient(event.target.value)} placeholder="Optional email address; separate multiple with ;" />
          </label>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="title-row">
            <div><strong>Recipient suggestions</strong><p className="hint">Select explicitly. Contacts marked for ETA updates are suggested, never auto-selected.</p></div>
            <button type="button" onClick={selectSuggestedContacts} disabled={!customerContacts.some(contact => contact.receivesEtaUpdates)}>Select suggested ETA contacts</button>
          </div>
          {customerContacts.length === 0
            ? <p className="hint">No active customer contact with an email address is stored for {effectiveCustomer || "this customer"}. Add one in Master Data or enter a recipient manually.</p>
            : <div className="data-list">{customerContacts.map(contact => <label key={contact.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0" }}>
              <input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} />
              <span><strong>{contact.name}</strong><small style={{ display: "block" }}>{contact.email}{contact.receivesEtaUpdates ? " · ETA contact" : " · Customer contact"}</small></span>
            </label>)}</div>}
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Order</th><th>Delivery</th><th>Vehicle / driver</th><th>ETA</th><th>Window</th><th>Status</th></tr></thead>
            <tbody>{customerRecords.map(record => <tr key={`${record.loadId}-${record.stopId}`}>
              <td><strong>{record.orderReference || record.loadReference}</strong><small>{record.loadReference}</small></td>
              <td>{record.stopName}</td>
              <td>{record.vehicleRegistration || "TBC"}<small>{record.tachoDriverName || record.plannedDriverName || "Driver TBC"}</small></td>
              <td>{localDateTime(record.etaUtc)}<small>{record.etaSource}</small></td>
              <td>{localDateTime(record.deliveryWindowStartUtc)}<small>to {localDateTime(record.deliveryWindowEndUtc)}</small></td>
              <td><span className={`status ${record.customerPromiseReady ? "promoted" : "pendingreview"}`}>{record.customerPromiseReady ? "Customer ready" : record.risk}</span></td>
            </tr>)}</tbody>
          </table>
        </div>

        <label className="wide" style={{ display: "block", marginTop: 12 }}>Email preview
          <textarea rows={Math.min(18, Math.max(8, customerRecords.length * 5 + 5))} value={etaBody} readOnly />
        </label>
        <p className="hint">Selected recipients: {selectedRecipients.length ? selectedRecipients.join("; ") : "none yet"}. Copy/export does not send an email.</p>
        <div className="actions">
          <button className="primary" type="button" onClick={() => void copyCustomerExport()} disabled={!effectiveCustomer || customerRecords.length === 0}>Copy email for selected customer</button>
          <button type="button" onClick={downloadCustomerExport} disabled={!effectiveCustomer || customerRecords.length === 0}>Download selected customer CSV</button>
        </div>
        {customerMessage && <p className="notice inline-notice">{customerMessage}</p>}
      </div>

      <div className="panel">
        <h2>Download full ETA evidence</h2>
        <p>This is the operational audit export across all customers. It remains separate from customer communication and includes Tacho, tracking, geofence, route and legal-hours evidence.</p>
        <button type="button" disabled={downloading || evidence.loading} onClick={() => void downloadEvidence()}>{downloading ? "Building evidence…" : "Download full ETA evidence CSV"}</button>
        {message && <p className="notice inline-notice">{message}</p>}
      </div>
    </section>
    <LegacyExportCentre />
  </>;
}
