import { useState } from "react";
import type { DriverMessageMode } from "./dispatchMessaging";

type Props = {
  reference: string;
  initialText: string;
  mode: DriverMessageMode;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSend: (text: string, reason?: string) => void;
};

export function DispatchMessageDialog({ reference, initialText, mode, busy, error, onClose, onSend }: Props) {
  const [text, setText] = useState(initialText);
  const [reason, setReason] = useState("");
  const reasonRequired = mode !== "initial";
  const title = mode === "initial" ? "Dispatch text preview" : mode === "amendment" ? "Amendment text preview" : "Free-form update text";
  const hint = mode === "update"
    ? "Write any update you need to send to the driver. This is free-form and editable."
    : "Review the exact SMS below before sending. You can edit it.";
  const sendLabel = mode === "initial" ? "SEND DISPATCH" : mode === "amendment" ? "SEND AMENDMENT" : "SEND UPDATE";

  return <div className="smart-dispatch-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <div className="smart-dispatch-modal">
      <div className="smart-dispatch-modal-head">
        <div>
          <span className="smart-eyebrow">{title}</span>
          <h2>{reference}</h2>
          <p>{hint}</p>
        </div>
        <button type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <textarea rows={16} value={text} onChange={event => setText(event.target.value)} autoFocus={mode === "update"} />
      {reasonRequired && <label className="smart-dispatch-change-reason"><strong>Reason for amendment <span aria-hidden="true">*</span></strong><textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain what changed and why…" /></label>}
      {error && <div className="smart-dispatch-error inline" role="alert">{error}</div>}
      <div className="smart-dispatch-modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="smart-action primary" type="button" onClick={() => onSend(text, reason.trim() || undefined)} disabled={busy || !text.trim() || (reasonRequired && !reason.trim())}>
          {busy ? "Sending…" : sendLabel}
        </button>
      </div>
    </div>
  </div>;
}
