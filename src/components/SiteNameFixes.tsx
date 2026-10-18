import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Suggestion = { id: string; name: string; externalCode: string };
type UnmatchedName = { kind: "Delivery" | "Collection"; name: string; orders: number; flaggedUnusual: number; customers: string[]; suggestions: Suggestion[] };

/**
 * Site names in waiting orders that the Site master does not recognise. Adding one as an
 * alias of the right site clears the "Unusual: new …" warnings on every waiting order.
 */
export function SiteNameFixes() {
  const token = useAccessToken();
  const names = useApi(useCallback(async () => request<UnmatchedName[]>("/api/v1/order-intake/site-names", await token(), undefined, 60000), [token]));
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function addAlias(item: UnmatchedName) {
    const key = `${item.kind}|${item.name}`;
    const siteId = choice[key] || item.suggestions[0]?.id;
    if (!siteId) return;
    setBusy(key); setMessage(undefined);
    try {
      const result = await request<{ site: string; rechecked: number }>("/api/v1/order-intake/site-names/alias", await token(), { method: "POST", body: JSON.stringify({ siteId, alias: item.name }) }, 120000);
      setMessage(`"${item.name}" added to ${result.site}. ${result.rechecked} waiting order${result.rechecked === 1 ? "" : "s"} re-checked.`);
      await names.refresh();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Could not add the alias."); }
    finally { setBusy(undefined); }
  }

  async function recheck() {
    setBusy("recheck"); setMessage(undefined);
    try {
      const result = await request<{ rechecked: number }>("/api/v1/order-intake/site-names/recheck", await token(), { method: "POST" }, 120000);
      setMessage(`${result.rechecked} waiting order${result.rechecked === 1 ? "" : "s"} updated.`);
      await names.refresh();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Re-check failed."); }
    finally { setBusy(undefined); }
  }

  const rows = names.data || [];
  return <section className="ui-card">
    <div className="ui-card-head">
      <h2>Site names not recognised</h2>
      <div className="ui-page-actions">
        <button type="button" onClick={() => void recheck()} disabled={Boolean(busy)}>{busy === "recheck" ? "Re-checking…" : "Re-check waiting orders"}</button>
        <button type="button" onClick={() => void names.refresh()} disabled={names.loading}>Refresh</button>
      </div>
    </div>
    <p className="hint">Names in orders waiting for review that don't match any site in Master data. Add each one as an alias of the right site once; future orders then match automatically and the "Unusual" warning clears.</p>
    {message && <p className="notice inline-notice">{message}</p>}
    {names.error && <p className="ui-error">{names.error}</p>}
    {names.loading && !names.data ? <div className="ui-empty">Checking waiting orders…</div> : rows.length === 0 ? <div className="ui-empty">Every site name in the waiting orders is recognised.</div> : <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Name in the email</th><th>Used as</th><th>Orders</th><th>Is the same site as</th><th /></tr></thead>
      <tbody>{rows.map(item => {
        const key = `${item.kind}|${item.name}`;
        return <tr key={key}>
          <td><strong>{item.name}</strong><br /><small>{item.customers.join(", ")}</small></td>
          <td>{item.kind}</td>
          <td>{item.orders}{item.flaggedUnusual > 0 && <><br /><span className="ui-chip amber">{item.flaggedUnusual} flagged</span></>}</td>
          <td>{item.suggestions.length ? <select aria-label={`Site for ${item.name}`} value={choice[key] || item.suggestions[0].id} onChange={event => setChoice(current => ({ ...current, [key]: event.target.value }))}>
            {item.suggestions.map(site => <option key={site.id} value={site.id}>{site.name} ({site.externalCode})</option>)}
          </select> : <small>No likely match. Add the site in Master data, or add this name as an alias there.</small>}</td>
          <td>{item.suggestions.length > 0 && <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void addAlias(item)}>{busy === key ? "Adding…" : "Add as alias"}</button>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
