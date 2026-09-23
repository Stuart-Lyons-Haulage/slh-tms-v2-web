import { useCallback, useMemo, useState } from "react";
import { api, type MarketContact } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { ALL_MARKETS, marketRowsForTab, marketTabs } from "./MarketsMasterLogic";
import { MasterDataExportButton } from "../components/MasterDataExportButton";

function clean(value?: string) { return String(value || "").trim(); }
function normal(value?: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function inferredStand(contact: MarketContact) {
  if (clean(contact.standOrLocation)) return clean(contact.standOrLocation);
  const name = clean(contact.name);
  return name.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || name.match(/\b(?:stall|stand)\s*#?\s*([a-z]?\d{1,4}[a-z]?)\s*$/i)?.[1]?.trim() || name.match(/\s((?:s)?\d{1,3}[a-z]?|[a-z]\d{1,3})\s*$/i)?.[1]?.trim() || "";
}

function marketTabLabel(market: string) { return market === "Sender" ? "Senders" : market; }

export function MarketsMasterClean() {
  const token = useAccessToken();
  const contacts = useApi(useCallback(async () => api.marketContacts(await token()), [token]));
  const [activeMarket, setActiveMarket] = useState(ALL_MARKETS);
  const [editing, setEditing] = useState<MarketContact>();
  const [draft, setDraft] = useState<MarketContact>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const rows = useMemo(() => contacts.data || [], [contacts.data]);
  const tabs = useMemo(() => marketTabs(rows), [rows]);
  const visibleRows = useMemo(() => marketRowsForTab(rows, activeMarket), [rows, activeMarket]);
  const summary = useMemo(() => {
    const missingRequired = rows.filter(row => !clean(row.market) || !clean(row.name)).length;
    const duplicateGroups = Object.values(rows.reduce<Record<string, MarketContact[]>>((groups, row) => {
      if (!clean(row.market) || !clean(row.name)) return groups;
      const key = `${normal(row.market)}|${normal(row.name)}|${normal(inferredStand(row))}`;
      (groups[key] ||= []).push(row);
      return groups;
    }, {})).filter(group => group.length > 1).length;
    const missingStand = rows.filter(row => clean(row.market).toLowerCase() !== "sender" && !inferredStand(row)).length;
    const missingSalesman = rows.filter(row => clean(row.market).toLowerCase() !== "sender" && !clean(row.salesman)).length;
    return { total: rows.length, blocking: missingRequired + duplicateGroups, missingRequired, duplicateGroups, missingStand, missingSalesman };
  }, [rows]);

  async function saveMarketContact() {
    if (!draft) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const { id, ...payload } = draft;
      await api.updateMarketContact(id, payload, await token());
      setEditing(undefined);
      setDraft(undefined);
      await contacts.refresh();
      setMessage("Market details saved to the SQL master.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Market details could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="market-clean-wrapper">
    <section className="panel" style={{ marginBottom: 18 }}>
      <p className="eyebrow">Market master quality</p>
      <h2>{summary.blocking} blocking validation issue{summary.blocking === 1 ? "" : "s"}</h2>
      <p>{summary.total} market records checked. Missing stall/stand and salesman details are tracked as advisory completion gaps rather than each being counted as a broken record.</p>
      <div className="metrics">
        <span><strong>{summary.missingRequired}</strong> missing market/name</span>
        <span><strong>{summary.duplicateGroups}</strong> exact duplicate groups</span>
        <span><strong>{summary.missingStand}</strong> stall/stand to enrich</span>
        <span><strong>{summary.missingSalesman}</strong> salesman to enrich</span>
      </div>
      {contacts.error && <p className="notice inline-notice">Market quality check: {contacts.error}</p>}
    </section>

    <section>
      <div className="title-row">
        <div><p className="eyebrow">Master data</p><h1>Markets &amp; senders</h1></div>
        <div className="title-actions"><button onClick={() => void contacts.refresh()}>Refresh</button><MasterDataExportButton section="markets" label="Markets" rows={(rows) as unknown as Record<string, unknown>[]} /></div>
      </div>
      <p className="intro">Market orders use this list for sellers, stall details, salesman and sender dropdowns. Choose a market below to work with one list at a time.</p>

      {editing && draft && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit market Master Data" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { setEditing(undefined); setDraft(undefined); } }}>
        <div className="crm-modal">
          <div className="crm-modal-header"><div><p className="eyebrow">Market Master Data record</p><h2>{editing.name}</h2><p className="hint">Maintain the canonical seller/sender, stand, salesman and market identity here.</p></div><button type="button" disabled={saving} onClick={() => { setEditing(undefined); setDraft(undefined); }}>Close</button></div>
          <div className="crm-modal-body"><section><h3>Market details</h3><div className="crm-form-grid">
            <label>Market<input value={draft.market} onChange={event => setDraft({ ...draft, market: event.target.value })} /></label>
            <label>Seller / sender<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>Stall / stand<input value={draft.standOrLocation || ""} onChange={event => setDraft({ ...draft, standOrLocation: event.target.value })} /></label>
            <label>Salesman<input value={draft.salesman || ""} onChange={event => setDraft({ ...draft, salesman: event.target.value })} /></label>
            <label>Sender<input value={draft.sender || ""} onChange={event => setDraft({ ...draft, sender: event.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} /> Active</label>
          </div></section></div>
          <div className="crm-modal-actions"><button type="button" className="primary" disabled={saving || !clean(draft.market) || !clean(draft.name)} onClick={() => void saveMarketContact()}>{saving ? "Saving…" : "Save Master Data record"}</button><button type="button" disabled={saving} onClick={() => { setEditing(undefined); setDraft(undefined); }}>Cancel</button></div>
        </div>
      </div>}
      {message && <p className="notice inline-notice">{message}</p>}

      <div className="market-subtabs" role="tablist" aria-label="Markets">
        <button type="button" role="tab" aria-selected={activeMarket === ALL_MARKETS} className={activeMarket === ALL_MARKETS ? "primary" : ""} onClick={() => setActiveMarket(ALL_MARKETS)}>All Markets <span>{rows.length}</span></button>
        {tabs.map(market => {
          const count = marketRowsForTab(rows, market).length;
          return <button type="button" role="tab" aria-selected={activeMarket === market} className={activeMarket === market ? "primary" : ""} key={market} onClick={() => setActiveMarket(market)}>{marketTabLabel(market)} <span>{count}</span></button>;
        })}
      </div>

      {contacts.loading && <div className="state">Loading market records…</div>}
      {!contacts.loading && contacts.error && <div className="state error">{contacts.error}</div>}
      {!contacts.loading && !contacts.error && visibleRows.length === 0 && <div className="state">No records are available for this market.</div>}
      {!contacts.loading && !contacts.error && visibleRows.length > 0 && <div className="master-table-wrap">
        <table className="master-table">
          <thead><tr>{activeMarket === ALL_MARKETS && <th>Market</th>}<th>{activeMarket === "Sender" ? "Sender" : "Seller / sender"}</th><th>Stall / stand</th><th>Salesman</th><th>Sender</th><th>Active</th><th>Action</th></tr></thead>
          <tbody>{visibleRows.map(row => <tr key={row.id}>{activeMarket === ALL_MARKETS && <td>{row.market}</td>}<td>{row.name || "—"}</td><td>{row.standOrLocation || "—"}</td><td>{row.salesman || "—"}</td><td>{row.sender || "—"}</td><td>{row.active ? "Yes" : "No"}</td><td><button type="button" onClick={() => { setEditing(row); setDraft({ ...row }); setMessage(undefined); }}>Edit</button></td></tr>)}</tbody>
        </table>
      </div>}

    </section>
    <style>{`.market-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}.market-subtabs button{display:inline-flex;align-items:center;gap:7px}.market-subtabs button span{opacity:.72;font-size:.85em}`}</style>
  </div>;
}
