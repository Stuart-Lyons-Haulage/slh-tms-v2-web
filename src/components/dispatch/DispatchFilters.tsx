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

const filters: Array<{ value: DispatchFilter; label: string }> = [
  { value: "all", label: "All drivers" },
  { value: "unallocated", label: "Unallocated" },
  { value: "backloads", label: "Backloads" },
  { value: "warnings", label: "Warnings" },
  { value: "skills-mismatch", label: "Skills mismatch" }
];

const employmentFilters: Array<{ value: DispatchEmploymentFilter; label: string }> = [
  { value: "all", label: "All people" },
  { value: "employed", label: "Employed" },
  { value: "agency", label: "Agency" },
  { value: "casual", label: "Casual" },
  { value: "subcontractor", label: "Subbies" }
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
    <div className="smart-dispatch-filters" role="group" aria-label="Dispatch filters">
      {filters.map(filter => <button
        key={filter.value}
        type="button"
        className={value === filter.value ? "active" : ""}
        aria-pressed={value === filter.value}
        onClick={() => onChange(filter.value)}
      >
        {filter.label}<span>{counts[filter.value]}</span>
      </button>)}
    </div>
    <div className="smart-dispatch-filters smart-dispatch-workforce-filters" role="group" aria-label="Employment type filters">
      {employmentFilters.map(filter => <button
        key={filter.value}
        type="button"
        className={employmentValue === filter.value ? "active" : ""}
        aria-pressed={employmentValue === filter.value}
        onClick={() => onEmploymentChange(filter.value)}
      >
        {filter.label}<span>{employmentCounts[filter.value]}</span>
      </button>)}
    </div>
  </div>;
}
