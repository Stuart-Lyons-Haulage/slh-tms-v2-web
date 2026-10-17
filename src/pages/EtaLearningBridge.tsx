import { useEffect } from "react";

type EtaCorrection = {
  destinationKey: string;
  sampleCount: number;
  medianHistoricalErrorMinutes: number;
  correctionMinutes: number;
  confidence: string;
};
type EtaLearningResponse = { corrections?: EtaCorrection[] };

type TimingRecord = {
  completed?: boolean;
  finalEtaUtc?: string;
  finalDestinationName?: string;
  currentGeofenceName?: string;
};

type EtaRecord = {
  etaUtc?: string;
  stopName?: string;
  source?: string;
};

let cachedAt = 0;
let cached = new Map<string, EtaCorrection>();
let loading: Promise<Map<string, EtaCorrection>> | undefined;

function destinationKey(value?: string) {
  let text = String(value || "").trim();
  for (const prefix of ["Collect · ", "Deliver · ", "Collect - ", "Deliver - "]) {
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  return text.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers();
  try {
    if (typeof Request !== "undefined" && input instanceof Request) input.headers.forEach((value, key) => headers.set(key, value));
  } catch { /* old TV browser */ }
  try { new Headers(init?.headers).forEach((value, key) => headers.set(key, value)); } catch { /* keep headers found above */ }
  headers.set("Accept", "application/json");
  return headers;
}

async function correctionsFor(
  baseFetch: typeof window.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const now = Date.now();
  if (cached.size > 0 && now - cachedAt < 15 * 60 * 1000) return cached;
  if (loading) return loading;
  loading = (async () => {
    try {
      const response = await baseFetch("/tms-api/api/v1/operations/eta-learning?lookbackDays=42", {
        method: "GET",
        headers: requestHeaders(input, init),
        cache: "no-store",
      });
      if (!response.ok) return cached;
      const payload = await response.json() as EtaLearningResponse;
      cached = new Map((payload.corrections || [])
        .filter(item => item.sampleCount >= 3 && Number.isFinite(item.correctionMinutes))
        .map(item => [item.destinationKey, item]));
      cachedAt = Date.now();
      return cached;
    } catch {
      return cached;
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

function shifted(value: string | undefined, correctionMinutes: number) {
  if (!value || !correctionMinutes) return value;
  const original = Date.parse(value);
  if (!Number.isFinite(original)) return value;
  return new Date(original + correctionMinutes * 60000).toISOString();
}

function responseWithJson(original: Response, payload: unknown) {
  const headers = new Headers(original.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

/**
 * Applies the conservative SLH history correction to live Azure HGV ETA responses.
 * Azure Maps still owns the road route and current traffic. The learned value only
 * nudges that ETA using prior geofence-confirmed arrival error for the same destination.
 * This bridge is deliberately fail-open: if history cannot be read, the untouched Azure
 * ETA is returned to the wallboard.
 */
export function EtaLearningBridge() {
  useEffect(() => {
    const baseFetch = window.fetch.bind(window);
    const learnedFetch: typeof window.fetch = async (input, init) => {
      const response = await baseFetch(input, init);
      if (!response.ok) return response;

      let pathname = "";
      try {
        const inputUrl = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        pathname = new URL(inputUrl, window.location.origin).pathname;
      } catch {
        return response;
      }

      const deliveryEtas = pathname.endsWith("/api/v1/operations/delivery-etas");
      const runTiming = pathname.endsWith("/api/v1/run-timing");
      if (!deliveryEtas && !runTiming) return response;

      try {
        const correctionMap = await correctionsFor(baseFetch, input, init);
        if (correctionMap.size === 0) return response;
        const payload = await response.clone().json() as { records?: Array<EtaRecord & TimingRecord> };
        if (!Array.isArray(payload.records)) return response;

        if (deliveryEtas) {
          payload.records = payload.records.map(record => {
            if (!record.etaUtc || (record.source !== "Live" && record.source !== "Estimated")) return record;
            const learned = correctionMap.get(destinationKey(record.stopName));
            if (!learned || learned.correctionMinutes === 0) return record;
            return {
              ...record,
              etaUtc: shifted(record.etaUtc, learned.correctionMinutes),
              slhLearnedCorrectionMinutes: learned.correctionMinutes,
              slhLearningSamples: learned.sampleCount,
              slhLearningConfidence: learned.confidence,
            };
          });
        } else {
          payload.records = payload.records.map(record => {
            if (!record.finalEtaUtc || record.completed) return record;
            // Never alter the locked actual arrival once the current geofence is the final site.
            const finalKey = destinationKey(record.finalDestinationName);
            const currentKey = destinationKey(record.currentGeofenceName);
            if (finalKey && currentKey && finalKey === currentKey) return record;
            const learned = correctionMap.get(finalKey);
            if (!learned || learned.correctionMinutes === 0) return record;
            return {
              ...record,
              finalEtaUtc: shifted(record.finalEtaUtc, learned.correctionMinutes),
              slhLearnedCorrectionMinutes: learned.correctionMinutes,
              slhLearningSamples: learned.sampleCount,
              slhLearningConfidence: learned.confidence,
            };
          });
        }

        return responseWithJson(response, payload);
      } catch {
        return response;
      }
    };

    window.fetch = learnedFetch;
    return () => { if (window.fetch === learnedFetch) window.fetch = baseFetch; };
  }, []);

  return null;
}
