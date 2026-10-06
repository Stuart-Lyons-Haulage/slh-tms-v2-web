export type DispatchAssetSearchOption = {
  id: string;
  label: string;
  search?: string;
};

function compact(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function filterDispatchAssetOptions<T extends DispatchAssetSearchOption>(options: T[], query: string): T[] {
  const needle = compact(query.trim());
  if (!needle) return options;

  return options
    .map((option, index) => {
      const fields = [option.label, option.search || ""];
      const compactFields = fields.map(compact);
      const endsWithNeedle = compactFields.some(field => field.endsWith(needle));
      const containsNeedle = compactFields.some(field => field.includes(needle));
      return { option, index, rank: endsWithNeedle ? 0 : containsNeedle ? 1 : 2 };
    })
    .filter(item => item.rank < 2)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(item => item.option);
}
