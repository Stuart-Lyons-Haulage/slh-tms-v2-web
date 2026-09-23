import { z } from 'zod';
import { apiRequest, unknownObjectSchema } from './apiClient';

function hasResult(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { results?: unknown[] }).results) && ((value as { results: unknown[] }).results.length > 0);
}

function fallbackQuery(value: string) {
  const firstPart = value.split(/[|·]/)[0]?.trim() || value.trim();
  const cleaned = firstPart
    .replace(/^\s*(to|from|collect(?:ion)?|deliver(?:y)?)\s*[:-]?\s*/i, '')
    .replace(/\b\d+(?:\.\d+)?\s*(?:pallets?|trays?|trolleys?)\b.*$/i, '')
    .trim();
  if (!cleaned || cleaned.toLowerCase() === value.trim().toLowerCase()) return undefined;
  return /\b(united kingdom|uk)\b/i.test(cleaned) ? cleaned : `${cleaned}, United Kingdom`;
}

export async function geocode(address: string, token?: string): Promise<z.output<typeof unknownObjectSchema>> {
  const execute = (query: string) => apiRequest(`/api/v1/maps/geocode?address=${encodeURIComponent(query)}`, unknownObjectSchema, token);
  let first: z.output<typeof unknownObjectSchema> | undefined;
  try {
    first = await execute(address);
    if (hasResult(first)) return first;
  } catch {
    // Imported planner text is not always a postal address; retry with a cleaned site name.
  }
  const retry = fallbackQuery(address);
  if (!retry) return first ?? execute(address);
  return execute(retry);
}
