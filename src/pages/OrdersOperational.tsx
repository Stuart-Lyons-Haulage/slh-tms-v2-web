import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../orders-operational.css";

type ImportOrder = {
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
  source: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
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
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])])),
  );
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
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
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
  const palletName = first(row, "Pallet Name", "Pallet Type", "Goods", "Product");
  const pallets = first(row, "PalletQty", "Pallet Qty", "Pallets", "Quantity", "Qty") || "1";
  const poRef = first(row, "PO REF", "PO Ref", "PO", "Purchase Order");
  const reference = salesOrder || poRef || customerRef || `ORDER-${index + 1}`;
  if (!requestedDate || !customer) return undefined;

  const notes = [
    collectionSite ? `Collection site: ${collectionSite}` : "",
    depotId ? `Depot ID: ${depotId}` : "",
    depotDescription ? `Depot: ${depotDescription}` : "",
    deliveryAddress ? `Delivery address: ${deliveryAddress}` : "",
    customerRef ? `Customer ref: ${customerRef}` : "",
    poRef ? `PO ref: ${poRef}` : "",
    palletName ? `Pallet: ${palletName}` : "",
  ].filter(Boolean).join(" · ");

  return {
    poNumber: reference,
    customerCode: customer,
    collectionDate: requestedDate,
    deliveryDate: requestedDate,
    pallets,
    sellerName: collectionSite,
    marketName: depotId,
    stallNumber: depotDescription,
    driverInstructions: notes,
    mapLink: deliveryAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress)}`
      : "",
    deliveryAddress,
    customerRef,
    palletName,
    source: "Customer CSV",
  };
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function OrdersOperational() {
  const token = useAccessToken();
  const [rows, setRows] = useState<ImportOrder[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [manual, setManual] = useState({
    reference: "",
    customer: "",
    collectionSite: "",
    depotId: "",
    destination: "",
    deliveryAddress: "",
    collectionDate: today(),
    pallets: "1",
    customerRef: "",
    poRef: "",
  });

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(undefined);
    setFileName(file.name);
    try {
      const parsed = parseCsvRows(await file.text());
      const mapped = parsed.flatMap((row, index) => {
        const item = mapRow(row, index);
        return item ? [item] : [];
      });
      setRows(mapped);
      setMessage(
        mapped.length
          ? `${mapped.length} structured order${mapped.length === 1 ? "" : "s"} recognised. Customer, collection site, depot and delivery address have been retained.`
          : "No valid orders were recognised. The file needs a requested/collection date and customer name.",
      );
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "The CSV could not be read.");
    }
  }

  async function submitRows() {
    if (!rows.length) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const accessToken = await token();
      for (const row of rows) {
        await api.stageOrder(
          {
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
          `structured-csv:${row.poNumber}:${row.customerCode}:${row.collectionDate}`,
          accessToken,
        );
      }
      setMessage(`${rows.length} order${rows.length === 1 ? "" : "s"} sent to Order Review.`);
      setRows([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order staging failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const notes = [
        manual.collectionSite ? `Collection site: ${manual.collectionSite}` : "",
        manual.depotId ? `Depot ID: ${manual.depotId}` : "",
        manual.destination ? `Depot: ${manual.destination}` : "",
        manual.deliveryAddress ? `Delivery address: ${manual.deliveryAddress}` : "",
        manual.customerRef ? `Customer ref: ${manual.customerRef}` : "",
        manual.poRef ? `PO ref: ${manual.poRef}` : "",
      ].filter(Boolean).join(" · ");
      const accessToken = await token();
      await api.stageOrder(
        {
          poNumber: manual.reference || manual.poRef,
          customerCode: manual.customer,
          collectionDate: manual.collectionDate,
          deliveryDate: manual.collectionDate,
          pallets: manual.pallets,
          sellerName: manual.collectionSite,
          marketName: manual.depotId,
          stallNumber: manual.destination,
          driverInstructions: notes,
          mapLink: manual.deliveryAddress
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(manual.deliveryAddress)}`
            : "",
        },
        `manual-structured:${manual.reference || manual.poRef}:${manual.collectionDate}`,
        accessToken,
      );
      setMessage("Order sent to Order Review.");
      setManual((current) => ({ ...current, reference: "", customer: "", depotId: "", destination: "", deliveryAddress: "", pallets: "1", customerRef: "", poRef: "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="orders-operational">
      <div className="title-row">
        <div>
          <p className="eyebrow">Order intake</p>
          <h1>Customer orders</h1>
          <p className="intro">Keep the customer, collection site, depot, delivery address and references intact from intake through planning.</p>
        </div>
        <Link className="button-like" to="/staging">Open Order Review</Link>
      </div>

      <div className="order-intake-grid">
        <article className="panel structured-import">
          <p className="eyebrow">Customer file</p>
          <h2>Import CSV</h2>
          <p>Recognises the Northway pallet report structure including Requested Ship Date, Collection Site, Customer, Depot, Delivery Address, Sales Order, Customer Ref, Pallets and PO Ref.</p>
          <label className="file-drop">
            <strong>Choose customer CSV</strong>
            <span>{fileName || "CSV files with quoted addresses are supported"}</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event)} />
          </label>
          {rows.length > 0 && (
            <button className="primary" disabled={submitting} onClick={() => void submitRows()}>
              {submitting ? "Submitting…" : `Send ${rows.length} to Order Review`}
            </button>
          )}
        </article>

        <form className="panel manual-structured" onSubmit={(event) => void submitManual(event)}>
          <p className="eyebrow">Single job</p>
          <h2>Manual order</h2>
          <div className="compact-fields">
            <label>Sales order / reference<input required value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} /></label>
            <label>Customer<input required value={manual.customer} onChange={(e) => setManual({ ...manual, customer: e.target.value })} /></label>
            <label>Collection site<input value={manual.collectionSite} onChange={(e) => setManual({ ...manual, collectionSite: e.target.value })} /></label>
            <label>Depot ID<input value={manual.depotId} onChange={(e) => setManual({ ...manual, depotId: e.target.value })} /></label>
            <label>Destination<input value={manual.destination} onChange={(e) => setManual({ ...manual, destination: e.target.value })} /></label>
            <label>Delivery address / postcode<input value={manual.deliveryAddress} onChange={(e) => setManual({ ...manual, deliveryAddress: e.target.value })} /></label>
            <label>Date<input required type="date" value={manual.collectionDate} onChange={(e) => setManual({ ...manual, collectionDate: e.target.value })} /></label>
            <label>Pallets<input required inputMode="numeric" value={manual.pallets} onChange={(e) => setManual({ ...manual, pallets: e.target.value })} /></label>
            <label>Customer ref<input value={manual.customerRef} onChange={(e) => setManual({ ...manual, customerRef: e.target.value })} /></label>
            <label>PO ref<input value={manual.poRef} onChange={(e) => setManual({ ...manual, poRef: e.target.value })} /></label>
          </div>
          <button className="primary" disabled={submitting}>Send for review</button>
        </form>
      </div>

      {message && <p className="notice inline-notice">{message}</p>}

      {rows.length > 0 && (
        <div className="structured-preview">
          <div className="preview-heading"><h2>Import preview</h2><span>{rows.length} jobs</span></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Collection</th><th>Depot</th><th>Destination</th><th>Address</th><th>Pallets</th><th>Customer ref</th></tr></thead>
              <tbody>
                {rows.slice(0, 250).map((row, index) => (
                  <tr key={`${row.poNumber}-${index}`}>
                    <td><strong>{row.poNumber}</strong></td><td>{row.customerCode}</td><td>{row.sellerName || "—"}</td><td>{row.marketName || "—"}</td><td>{row.stallNumber || "—"}</td><td>{row.deliveryAddress || "—"}</td><td>{row.pallets}</td><td>{row.customerRef || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
