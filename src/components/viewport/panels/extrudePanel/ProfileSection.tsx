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
  const toggleProfile = (id: string) => {
    setSelectedIds(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };
  const selectedSet = new Set(selectedIds);

  return (
    <div className="tp-section">
      <div className="tp-section-title">Profile</div>
      <div className="tp-profile-list" aria-label="Extrude profiles">
        {profileOptions.map((option) => {
          const isSelected = selectedSet.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`tp-profile-row ${isSelected ? 'selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => toggleProfile(option.id)}
            >
              <span className="tp-profile-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
