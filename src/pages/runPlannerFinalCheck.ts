export type FinalCheckOrder = {
  id: string;
  palletType?: string;
  loadUnitType?: string;
};

export type FinalCheckLine = {
  orderId: string;
  collectionSite: string;
  deliverySite: string;
  pallets: number;
};

export type FinalCheckRun = {
  key: string;
  label: string;
  period?: "" | "AM" | "PM";
  complete: boolean;
  lines: FinalCheckLine[];
};

export type FinalCheckMovement = {
  fromRunKey: string;
  fromRunLabel: string;
  toRunKey: string;
  toRunLabel: string;
  collectionSite: string;
  deliverySite: string;
  pallets: number;
  palletLabel: "Standard" | "Euro";
};

export type FinalRunCheckSuggestion = {
  id: string;
  sourceRunKey: string;
  sourceRunLabel: string;
  targetRunKey: string;
  targetRunLabel: string;
  reliefRunKey?: string;
  reliefRunLabel?: string;
  movements: FinalCheckMovement[];
  resultingUtilisation: Array<{ runKey: string; runLabel: string; percent: number }>;
  timingCheckRequired: true;
};

type KnownLine = FinalCheckLine & { kind: "Standard" | "Euro"; fraction: number };
type KnownRun = Omit<FinalCheckRun, "lines"> & { lines: KnownLine[]; utilisation: number };

const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();

function palletKind(order?: FinalCheckOrder) {
  const value = `${order?.loadUnitType || ""} ${order?.palletType || ""}`.toLowerCase();
  if (value.includes("euro")) return "Euro" as const;
  if (value.includes("standard") || value.includes("std")) return "Standard" as const;
  return undefined;
}

const perPalletFraction = (kind: KnownLine["kind"]) => kind === "Euro" ? 1 / 33 : 1 / 26;
const compatiblePeriod = (left: KnownRun, right: KnownRun) => !left.period || !right.period || left.period === right.period;
const percent = (utilisation: number) => Math.round(utilisation * 1000) / 10;

function knownRuns(runs: FinalCheckRun[], orders: FinalCheckOrder[]) {
  const byId = new Map(orders.map((order) => [order.id, order]));
  return runs.flatMap<KnownRun>((run) => {
    if (!run.complete || run.lines.length === 0) return [];
    const lines = run.lines.flatMap<KnownLine>((line) => {
      const kind = palletKind(byId.get(line.orderId));
      if (!kind || !Number.isFinite(line.pallets) || line.pallets <= 0) return [];
      return [{ ...line, kind, fraction: line.pallets * perPalletFraction(kind) }];
    });
    if (lines.length !== run.lines.length) return [];
    return [{ ...run, lines, utilisation: lines.reduce((sum, line) => sum + line.fraction, 0) }];
  });
}

function allDeliveriesAlreadyOn(source: KnownRun, target: KnownRun) {
  const targetDeliveries = new Set(target.lines.map((line) => normalise(line.deliverySite)));
  return source.lines.every((line) => targetDeliveries.has(normalise(line.deliverySite)));
}

function sourceMovements(source: KnownRun, target: KnownRun): FinalCheckMovement[] {
  return source.lines.map((line) => ({
    fromRunKey: source.key,
    fromRunLabel: source.label,
    toRunKey: target.key,
    toRunLabel: target.label,
    collectionSite: line.collectionSite,
    deliverySite: line.deliverySite,
    pallets: line.pallets,
    palletLabel: line.kind,
  }));
}

function directSuggestion(source: KnownRun, target: KnownRun): FinalRunCheckSuggestion | undefined {
  const targetResult = target.utilisation + source.utilisation;
  if (targetResult > 1 + 1e-9) return undefined;
  return {
    id: `direct:${source.key}:${target.key}`,
    sourceRunKey: source.key,
    sourceRunLabel: source.label,
    targetRunKey: target.key,
    targetRunLabel: target.label,
    movements: sourceMovements(source, target),
    resultingUtilisation: [{ runKey: target.key, runLabel: target.label, percent: percent(targetResult) }],
    timingCheckRequired: true,
  };
}

function splitSuggestion(source: KnownRun, target: KnownRun, runs: KnownRun[]): FinalRunCheckSuggestion | undefined {
  const deficit = target.utilisation + source.utilisation - 1;
  if (deficit <= 1e-9) return undefined;

  for (const movable of target.lines) {
    const quantity = Math.ceil((deficit / perPalletFraction(movable.kind)) - 1e-9);
    if (quantity <= 0 || quantity > movable.pallets) continue;
    const movedFraction = quantity * perPalletFraction(movable.kind);

    for (const relief of runs) {
      if (relief.key === source.key || relief.key === target.key || !compatiblePeriod(target, relief)) continue;
      const sharesCollection = relief.lines.some((line) => normalise(line.collectionSite) === normalise(movable.collectionSite));
      if (!sharesCollection || relief.utilisation + movedFraction > 1 + 1e-9) continue;

      return {
        id: `split:${source.key}:${target.key}:${relief.key}:${movable.orderId}`,
        sourceRunKey: source.key,
        sourceRunLabel: source.label,
        targetRunKey: target.key,
        targetRunLabel: target.label,
        reliefRunKey: relief.key,
        reliefRunLabel: relief.label,
        movements: [{
          fromRunKey: target.key,
          fromRunLabel: target.label,
          toRunKey: relief.key,
          toRunLabel: relief.label,
          collectionSite: movable.collectionSite,
          deliverySite: movable.deliverySite,
          pallets: quantity,
          palletLabel: movable.kind,
        }, ...sourceMovements(source, target)],
        resultingUtilisation: [
          { runKey: target.key, runLabel: target.label, percent: percent(target.utilisation - movedFraction + source.utilisation) },
          { runKey: relief.key, runLabel: relief.label, percent: percent(relief.utilisation + movedFraction) },
        ],
        timingCheckRequired: true,
      };
    }
  }
  return undefined;
}

export function findFinalRunSavings(
  runs: FinalCheckRun[],
  orders: FinalCheckOrder[],
  limit = 3,
): FinalRunCheckSuggestion[] {
  const allRuns = knownRuns(runs, orders);
  const candidates = allRuns.filter((run) => run.utilisation <= 0.75 + 1e-9);
  const suggestions: FinalRunCheckSuggestion[] = [];
  const suggestedPairs = new Set<string>();

  for (const source of [...candidates].sort((left, right) => left.utilisation - right.utilisation)) {
    const targets = allRuns
      .filter((target) => {
        const pair = [source.key, target.key].sort().join(":");
        return target.key !== source.key
          && !suggestedPairs.has(pair)
          && compatiblePeriod(source, target)
          && allDeliveriesAlreadyOn(source, target);
      })
      .sort((left, right) => right.utilisation - left.utilisation);
    let suggestion: FinalRunCheckSuggestion | undefined;
    for (const target of targets) {
      suggestion = directSuggestion(source, target) || splitSuggestion(source, target, allRuns);
      if (suggestion) break;
    }
    if (suggestion) {
      suggestions.push(suggestion);
      suggestedPairs.add([suggestion.sourceRunKey, suggestion.targetRunKey].sort().join(":"));
    }
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}
