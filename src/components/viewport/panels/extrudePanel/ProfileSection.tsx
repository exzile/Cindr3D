interface ProfileOption {
  id: string;
  label: string;
  sketchId: string;
}

export function ProfileSection({
  profileOptions,
  selectedIds,
  setSelectedIds,
}: {
  profileOptions: ProfileOption[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
}) {
  return (
    <div className="tp-section">
      <div className="tp-section-title">Profile</div>
      <select
        className="tp-select"
        value={selectedIds}
        multiple
        size={Math.min(4, Math.max(2, profileOptions.length))}
        onChange={(event) => {
          const ids = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
          setSelectedIds(ids);
        }}
      >
        {profileOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
