import { useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { api, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../orders-operational.css";

type ImportOrder = {
  rowIndex: number;
  poNumber: string;
  customerCode: string;
  collectionDate: string;
  deliveryDate: string;
  pallets: string;
  sellerName: string;
  marketName: string;
  stallNumber: string;
  driverInstructions: string;
  mapLink: string;
  deliveryAddress: string;
  customerRef: string;
  palletName: string;
  poRef: string;
  orderType: string;
  collectionTime: string;
  deliveryTime: string;
  planningPeriod: "AM" | "PM" | "TBC";
};

type ManualOrderLine = {
  key: string;
  poNumber: string;
  customerCode: string;
  collectionSite: string;
  destination: string;
  deliveryAddress: string;
  collectionDate: string;
  pallets: string;
  customerRef: string;
  poRef: string;
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function normaliseHeader(value: unknown) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function blankManualLine(): ManualOrderLine {
  return {
    key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    poNumber: "",
    customerCode: "",
    collectionSite: "",
    destination: "",
    deliveryAddress: "",
    collectionDate: today(),
    pallets: "1",
    customerRef: "",
    poRef: "",
  };
}
function first(row: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = row[normaliseHeader(name)];
    if (clean(value)) return clean(value);
  }
  return "";
}
function dateValue(value: string) {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const uk = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (uk) {
    const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${year}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }
  return "";
}
function timeValue(value: string) {
  const raw = clean(value);
  if (!raw) return "";
  const twelveHour = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toLowerCase() === "pm") hour += 12;
    return `${String(hour).padStart(2, "0")}:${twelveHour[2] || "00"}`;
  }
  const twentyFour = raw.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (twentyFour) return `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}`;
  const excelFraction = Number(raw);
  if (Number.isFinite(excelFraction) && excelFraction >= 0 && excelFraction < 1) {
    const minutes = Math.round(excelFraction * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return "";
}
function periodFor(time: string): "AM" | "PM" | "TBC" {
  if (!time) return "TBC";
  return Number(time.slice(0, 2)) < 12 ? "AM" : "PM";
}
function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) { row.push(field.trim()); field = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])])));
}
function mapRow(row: Record<string, string>, index: number): ImportOrder | undefined {
  const requestedDate = dateValue(first(row, "Requested Ship Date", "Collection Date", "Date"));
  const collectionSite = first(row, "04. Collection Site", "Collection Site", "Collection", "Origin");
  const customer = first(row, "Customer Name", "Customer", "Customer Code", "Account");
  const depotId = first(row, "DepotID", "Depot ID", "Delivery Depot", "Destination Code");
  const depotDescription = first(row, "Depot Description", "Destination", "Delivery Location", "Consignee");
  const deliveryAddress = first(row, "Delivery Address", "Address", "Postcode", "Delivery Postcode");
  const salesOrder = first(row, "Sales Order ID", "Sales Order", "Order Number", "Order Ref");
  const customerRef = first(row, "CustomerRef", "Customer Ref", "Customer Reference");
  const palletName = first(row, "Pallet Name", "Pallet Type", "Goods", "Product", "Crate Type");
  const crateQty = first(row, "CrateQty", "Crate Qty", "Crates", "Crate Quantity");
  const palletQty = first(row, "PalletQty", "Pallet Qty", "Pallets", "Quantity", "Qty");
  const explicitType = first(row, "Order Type", "Job Type", "Type", "Movement Type");
  const typeEvidence = `${explicitType} ${palletName} ${first(row, "Description", "Notes")}`;
  const orderType = explicitType || (crateQty || /\bcrate(s)?\b/i.test(typeEvidence) ? "Crates" : "Pallets");
  const pallets = orderType.toLowerCase().includes("crate") ? (crateQty || palletQty || "1") : (palletQty || "1");
  const poRef = first(row, "PO REF", "PO Ref", "PO", "Purchase Order");
  const collectionTime = timeValue(first(row,
    "Requested Ship Time", "Collection Time", "Collect Time", "Pickup Time", "Ready Time", "Start Time"));
  const deliveryTime = timeValue(first(row,
    "Requested Delivery Time", "Delivery Time", "Deliver Time", "Booking Time", "Time Slot", "Appointment Time"));
  const planningTime = collectionTime || deliveryTime;
  const planningPeriod = periodFor(planningTime);
  const reference = salesOrder || poRef || customerRef || `ORDER-${index + 1}`;
  if (!requestedDate || !customer) return undefined;
  const notes = [
    `Order type: ${orderType}`,
    `Planning period: ${planningPeriod}`,
    collectionTime ? `Collection time: ${collectionTime}` : "",
    deliveryTime ? `Delivery time: ${deliveryTime}` : "",
    collectionSite ? `Collection site: ${collectionSite}` : "",
    depotId ? `Depot ID: ${depotId}` : "",
    depotDescription ? `Depot: ${depotDescription}` : "",
    deliveryAddress ? `Delivery address: ${deliveryAddress}` : "",
    customerRef ? `Customer ref: ${customerRef}` : "",
    poRef ? `PO ref: ${poRef}` : "",
    palletName ? `${orderType.toLowerCase().includes("crate") ? "Product" : "Pallet"}: ${palletName}` : "",
  ].filter(Boolean).join(" · ");
  return {
    rowIndex: index,
    poNumber: reference,
    customerCode: customer,
    collectionDate: requestedDate,
    deliveryDate: requestedDate,
    pallets,
    sellerName: collectionSite,
    marketName: depotId,
    stallNumber: depotDescription,
    driverInstructions: notes,
    mapLink: deliveryAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress)}` : "",
    deliveryAddress,
    customerRef,
    palletName,
    poRef,
    orderType,
    collectionTime,
    deliveryTime,
    planningPeriod,
  };
}

export function OrdersOperationalV2() {
  const token = useAccessToken();
  const [rows, setRows] = useState<ImportOrder[]>([]);
  const [manualLines, setManualLines] = useState<ManualOrderLine[]>(() => [blankManualLine()]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setMessage(undefined);
    const parsed = parseCsvRows(await file.text());
    const mapped = parsed.flatMap((row, index) => {
      const item = mapRow(row, index);
      return item ? [item] : [];
    });
    setRows(mapped);
    const crates = mapped.filter((item) => item.orderType.toLowerCase().includes("crate")).length;
    const am = mapped.filter((item) => item.planningPeriod === "AM").length;
    const pm = mapped.filter((item) => item.planningPeriod === "PM").length;
    const tbc = mapped.filter((item) => item.planningPeriod === "TBC").length;
    setMessage(mapped.length
      ? `${mapped.length} jobs recognised. ${am} AM, ${pm} PM, ${tbc} time TBC.${crates ? ` ${crates} identified as crate work.` : ""}`
      : "No valid orders were recognised.");
  }

  async function submitRows() {
    if (!rows.length || submitting) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const records: StageBatchRequest[] = rows.map((row) => ({
        entityType: "order",
        idempotencyKey: `structured-csv-v4:${row.collectionDate}:${row.poNumber}:${row.marketName}:${row.customerRef}:${row.orderType}:${row.planningPeriod}:${row.palletName}:${row.rowIndex}`.slice(0, 200),
        source: `Customer CSV · ${fileName || "upload"}`,
        payload: {
          poNumber: row.poNumber,
          customerCode: row.customerCode,
          collectionDate: row.collectionDate,
          deliveryDate: row.deliveryDate,
          pallets: row.pallets,
          sellerName: row.sellerName,
          marketName: row.marketName,
          stallNumber: row.stallNumber,
          driverInstructions: row.driverInstructions,
          mapLink: row.mapLink,
        },
      }));
      const result = await api.stageBatch(records, await token());
      const pending = result.records.filter((item) => String(item.status).toLowerCase() === "pendingreview" || String(item.status) === "0").length;
      setMessage(`${result.received} submitted. ${result.created} new Order Review item${result.created === 1 ? "" : "s"}; ${result.existing} already existed. ${pending} currently pending review.`);
      setRows([]);
      window.dispatchEvent(new Event("slh:orders-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order staging failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateManual(key: string, field: keyof Omit<ManualOrderLine, "key">, value: string) {
    setManualLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  }

  async function submitManualLines() {
    if (submitting) return;
    const entered = manualLines.filter((line) => [line.poNumber, line.customerCode, line.collectionSite, line.destination, line.deliveryAddress, line.customerRef, line.poRef].some((value) => clean(value)));
    if (!entered.length) { setMessage("Enter an order before sending it to Order Review."); return; }
    const invalid = entered.find((line) => !clean(line.poNumber || line.poRef) || !clean(line.customerCode) || !clean(line.collectionDate) || !Number.isInteger(Number(line.pallets)) || Number(line.pallets) <= 0);
    if (invalid) { setMessage("Each order line needs a reference, customer, date and a positive whole pallet quantity."); return; }

    setSubmitting(true);
    setMessage(undefined);
    try {
      const records: StageBatchRequest[] = entered.map((line, index) => {
        const reference = clean(line.poNumber) || clean(line.poRef);
        const notes = [
          line.collectionSite ? `Collection site: ${clean(line.collectionSite)}` : "",
          line.destination ? `Depot: ${clean(line.destination)}` : "",
          line.deliveryAddress ? `Delivery address: ${clean(line.deliveryAddress)}` : "",
          line.customerRef ? `Customer ref: ${clean(line.customerRef)}` : "",
          line.poRef ? `PO ref: ${clean(line.poRef)}` : "",
        ].filter(Boolean).join(" · ");
        return {
          entityType: "order",
          idempotencyKey: `manual-order-v2:${line.collectionDate}:${reference}:${line.customerCode}:${index}`.slice(0, 200),
          source: "Manual order entry · Import Centre",
          payload: {
            poNumber: reference,
            customerCode: clean(line.customerCode),
            collectionDate: line.collectionDate,
            deliveryDate: line.collectionDate,
            pallets: clean(line.pallets),
            sellerName: clean(line.collectionSite),
            stallNumber: clean(line.destination),
            driverInstructions: notes,
            mapLink: line.deliveryAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean(line.deliveryAddress))}` : "",
          },
        };
      });
      const result = await api.stageBatch(records, await token());
      setMessage(`${result.created} new manual order${result.created === 1 ? "" : "s"} sent to Order Review. ${result.existing} already existed.`);
      setManualLines([blankManualLine()]);
      window.dispatchEvent(new Event("slh:orders-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual orders could not be staged.");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="orders-operational">
    <div className="title-row">
      <div><p className="eyebrow">Order intake</p><h1>Customer orders</h1><p className="intro">Enter a single order or import the customer file, then submit it into Order Review for approval.</p></div>
      <Link className="button-like" to="/staging">Open Order Review</Link>
    </div>

    <article className="panel structured-import" style={{ marginBottom: 16 }}>
      <div className="title-row">
        <div><p className="eyebrow">Manual order entry</p><h2>Order lines</h2><p className="hint">One line is shown by default. Add another line only when you need to enter another order.</p></div>
        <button type="button" onClick={() => setManualLines((current) => [...current, blankManualLine()])} disabled={submitting}>Add line</button>
      </div>
      <div className="table-scroll">
        <table style={{ minWidth: 1180 }}>
          <thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th>Collection</th><th>Destination</th><th>Postcode / address</th><th>Pallets</th><th>Customer ref</th><th>PO ref</th><th /></tr></thead>
          <tbody>{manualLines.map((line, index) => <tr key={line.key}>
            <td><input value={line.poNumber} onChange={(e) => updateManual(line.key, "poNumber", e.target.value)} placeholder="Order / sales ref" /></td>
            <td><input value={line.customerCode} onChange={(e) => updateManual(line.key, "customerCode", e.target.value)} placeholder="Customer" /></td>
            <td><input type="date" value={line.collectionDate} onChange={(e) => updateManual(line.key, "collectionDate", e.target.value)} /></td>
            <td><input value={line.collectionSite} onChange={(e) => updateManual(line.key, "collectionSite", e.target.value)} placeholder="Collection site" /></td>
            <td><input value={line.destination} onChange={(e) => updateManual(line.key, "destination", e.target.value)} placeholder="Destination" /></td>
            <td><input value={line.deliveryAddress} onChange={(e) => updateManual(line.key, "deliveryAddress", e.target.value)} placeholder="Postcode preferred" /></td>
            <td><input type="number" min="1" step="1" value={line.pallets} onChange={(e) => updateManual(line.key, "pallets", e.target.value)} style={{ width: 80 }} /></td>
            <td><input value={line.customerRef} onChange={(e) => updateManual(line.key, "customerRef", e.target.value)} /></td>
            <td><input value={line.poRef} onChange={(e) => updateManual(line.key, "poRef", e.target.value)} /></td>
            <td>{manualLines.length > 1 && <button type="button" onClick={() => setManualLines((current) => current.filter((item) => item.key !== line.key))} disabled={submitting} aria-label={`Remove order line ${index + 1}`}>Remove</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button className="primary" type="button" disabled={submitting} onClick={() => void submitManualLines()}>{submitting ? "Submitting…" : `Send ${manualLines.length} line${manualLines.length === 1 ? "" : "s"} to Order Review`}</button>
    </article>

    <article className="panel structured-import">
      <p className="eyebrow">Customer file</p><h2>Import CSV</h2>
      <p>Recognises pallet and crate work, collection and delivery times, requested date, collection site, customer, depot, delivery address, sales order, quantity and PO ref.</p>
      <label className="file-drop"><strong>Choose customer CSV</strong><span>{fileName || "CSV files with quoted addresses are supported"}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event)} /></label>
      {rows.length > 0 && <button className="primary" disabled={submitting} onClick={() => void submitRows()}>{submitting ? "Submitting…" : `Send ${rows.length} to Order Review`}</button>}
    </article>
    {message && <p className="notice inline-notice">{message}</p>}
    {rows.length > 0 && <div className="structured-preview"><div className="preview-heading"><h2>Import preview</h2><span>{rows.length} jobs</span></div><div className="table-scroll"><table><thead><tr><th>Order</th><th>Period</th><th>Collect time</th><th>Deliver time</th><th>Type</th><th>Customer</th><th>Collection</th><th>Destination</th><th>Address</th><th>Qty</th></tr></thead><tbody>{rows.slice(0, 250).map((row) => <tr key={`${row.rowIndex}-${row.poNumber}`}><td><strong>{row.poNumber}</strong></td><td><strong>{row.planningPeriod}</strong></td><td>{row.collectionTime || "—"}</td><td>{row.deliveryTime || "—"}</td><td>{row.orderType}</td><td>{row.customerCode}</td><td>{row.sellerName || "—"}</td><td>{row.stallNumber || row.marketName || "—"}</td><td>{row.deliveryAddress || "—"}</td><td>{row.pallets}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
