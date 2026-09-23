import { useState } from "react";

export type MasterExportSection =
  | "drivers"
  | "vehicles"
  | "trailers"
  | "fuel-cards"
  | "sites"
  | "markets"
  | "fuel-prices";

const fallbackColumns: Record<MasterExportSection, string[]> = {
  drivers: ["id", "employeeNumber", "displayName", "mobileNumber", "driverType", "agencyName", "driverGroup", "skills", "coding", "tachoMasterDriverId", "tachoCardNumber", "drivingLicenceNumber", "licenceExpiry", "licenceStatus", "active"],
  vehicles: ["id", "registration", "fleetNumber", "abbreviation", "vehicleType", "cabMobile", "fuelProvider", "fuelPin", "shellCard", "bpRedCard", "bpPlainCard", "fleetioAssetId", "motExpiry", "tachoCalibrationExpiry", "active"],
  trailers: ["id", "trailerNumber", "type", "standardCapacity", "euroCapacity", "active"],
  "fuel-cards": ["id", "registration", "fleetNumber", "abbreviation", "cabMobile", "fuelProvider", "fuelPin", "shellCard", "bpRedCard", "bpPlainCard", "notes", "active"],
  sites: ["id", "externalCode", "name", "driverTextName", "collectionAddress", "collectionInstructions", "mapLink", "latitude", "longitude", "aliases", "operationalRegion", "active"],
  markets: ["id", "market", "name", "standOrLocation", "salesman", "sender", "active"],
  "fuel-prices": ["id", "weekCommencing", "provider", "pricePencePerLitre", "isPricingMaximum", "source", "notes", "createdAtUtc"],
};

function csvValue(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value: unknown) {
  const text = csvValue(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(section: MasterExportSection, rows: Record<string, unknown>[]) {
  const preferred = fallbackColumns[section];
  const discovered = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const columns = Array.from(new Set([...preferred, ...discovered]));
  const csv = [
    columns.map(escapeCsv).join(","),
    ...rows.map(row => columns.map(column => escapeCsv(row[column])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `slh-master-${section}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function MasterDataExportButton({ section, label, rows }: { section: MasterExportSection; label: string; rows: Record<string, unknown>[] }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();

  async function exportSection() {
    setExporting(true);
    setError(undefined);
    try {
      downloadCsv(section, rows);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : `Could not export ${label.toLowerCase()}.`);
    } finally {
      setExporting(false);
    }
  }

  return <>
    <button type="button" onClick={() => void exportSection()} disabled={exporting} title={error || undefined}>
      {exporting ? "Exporting…" : `Export ${label} CSV`}
    </button>
    {error && <span className="hint" role="alert">{error}</span>}
  </>;
}
