import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DispatchCalculatedStarts } from "./DispatchCalculatedStarts";

export function DispatchCalculatedStartsPortal() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const resolve = () => setTarget(document.querySelector(".driver-dispatch-page .dispatch-actions"));
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target ? createPortal(<DispatchCalculatedStarts />, target) : null;
}
