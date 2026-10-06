import type { DispatchEmploymentFilter, DispatchFilter } from "./types";

type Props = {
  value: DispatchFilter;
  counts: Record<DispatchFilter, number>;
  onChange: (filter: DispatchFilter) => void;
  employmentValue: DispatchEmploymentFilter;
  employmentCounts: Record<DispatchEmploymentFilter, number>;
  onEmploymentChange: (filter: DispatchEmploymentFilter) => void;
  driverSearch: string;
  onDriverSearchChange: (value: string) => void;
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
  value,
  counts,
  onChange,
  employmentValue,
  employmentCounts,
  onEmploymentChange,
  driverSearch,
  onDriverSearchChange
}: Props) {
  const chooseEmploymentFilter = (next: DispatchEmploymentFilter) => {
    onChange("all");
    onEmploymentChange(next);
  };

  const chooseUnallocated = () => {
    onEmploymentChange("all");
    onChange("unallocated");
  };

  return <div className="smart-dispatch-filter-groups">
    <label className="smart-dispatch-search">
      <span>Driver search</span>
      <input
        aria-label="Search drivers"
        value={driverSearch}
        onChange={event => onDriverSearchChange(event.target.value)}
        placeholder="Name, code, skill, vehicle, run or location"
      />
    </label>
    <div className="smart-dispatch-filters smart-dispatch-workforce-filters actionable-filter-line" role="group" aria-label="Driver filters">
      {employmentFilters.map(employment => <button
        key={employment.value}
        type="button"
        className={`${value === "all" && employmentValue === employment.value ? "active" : ""}${employment.value === "unmatched" && employmentCounts.unmatched > 0 ? " warning" : ""}`.trim()}
        aria-pressed={value === "all" && employmentValue === employment.value}
        onClick={() => chooseEmploymentFilter(employment.value)}
      >
        {employment.label}<span>{employmentCounts[employment.value]}</span>
      </button>)}
      <button type="button" className={value === "unallocated" ? "active" : ""} aria-pressed={value === "unallocated"} onClick={chooseUnallocated}>
        Unallocated<span>{counts.unallocated}</span>
      </button>
    </div>
  </div>;
}
