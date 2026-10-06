import type { DispatchEmploymentFilter, DispatchFilter } from "./types";

type Props = {
  employmentValue: DispatchEmploymentFilter;
  employmentCounts: Record<DispatchEmploymentFilter, number>;
  onEmploymentChange: (filter: DispatchEmploymentFilter) => void;
  unallocatedCount: number;
  unallocatedSelected: boolean;
  onUnallocatedChange: () => void;
};

const employmentFilters: Array<{ value: DispatchEmploymentFilter; label: string }> = [
  { value: "all", label: "All people" },
  { value: "employed", label: "Employed" },
  { value: "agency", label: "Agency" },
  { value: "casual", label: "Casual" },
  { value: "subcontractor", label: "Subbies" },
  { value: "unmatched", label: "Sage unmatched" }
];

export function DispatchFilters({
  employmentValue,
  employmentCounts,
  onEmploymentChange,
  unallocatedCount,
  unallocatedSelected,
  onUnallocatedChange
}: Props) {
  return <div className="smart-dispatch-filters smart-dispatch-workforce-filters actionable-filter-line" role="group" aria-label="Driver filters">
      {employmentFilters.map(employment => <button
        key={employment.value}
        type="button"
        className={`${!unallocatedSelected && employmentValue === employment.value ? "active" : ""}${employment.value === "unmatched" && employmentCounts.unmatched > 0 ? " warning" : ""}`.trim()}
        aria-pressed={!unallocatedSelected && employmentValue === employment.value}
        onClick={() => onEmploymentChange(employment.value)}
      >
        {employment.label}<span>{employmentCounts[employment.value]}</span>
      </button>)}
      <button type="button" className={unallocatedSelected ? "active" : ""} aria-pressed={unallocatedSelected} onClick={onUnallocatedChange}>
        Unallocated<span>{unallocatedCount}</span>
      </button>
    </div>;
}
