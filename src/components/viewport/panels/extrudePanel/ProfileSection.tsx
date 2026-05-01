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
  const selectedSet = new Set(selectedIds);
  const toggleProfile = (id: string) => {
    setSelectedIds(
      selectedSet.has(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div className="tp-section">
      <div className="tp-section-title">Profile</div>
      <div className="tp-profile-list" role="listbox" aria-label="Extrude profiles" aria-multiselectable="true">
        {profileOptions.map((option) => (
          <label
            key={option.id}
            className={`tp-profile-row ${selectedSet.has(option.id) ? 'selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selectedSet.has(option.id)}
              onChange={() => toggleProfile(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
