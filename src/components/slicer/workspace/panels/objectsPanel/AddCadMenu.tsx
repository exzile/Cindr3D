import { Box, Plus } from "lucide-react";

interface CadBodyOption {
  id: string;
  name: string;
}

interface AddCadMenuProps {
  addSearch: string;
  addableBodiesCount: number;
  filteredBodies: CadBodyOption[];
  onAddBody: (bodyId: string, bodyName: string) => void;
  onSearchChange: (value: string) => void;
  onToggleMenu: () => void;
  showAddMenu: boolean;
}

export function AddCadMenu({
  addSearch,
  addableBodiesCount,
  filteredBodies,
  onAddBody,
  onSearchChange,
  onToggleMenu,
  showAddMenu,
}: AddCadMenuProps) {
  return (
    <div className="slicer-workspace-objects-panel__add-wrap">
      <button
        className="slicer-workspace-objects-panel__action-button"
        onClick={onToggleMenu}
      >
        <Plus size={14} /> Add from CAD
      </button>
      {showAddMenu && (
        <div className="slicer-workspace-objects-panel__menu">
          <input
            type="text"
            placeholder="Search bodies..."
            className="slicer-workspace-objects-panel__menu-search"
            value={addSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            autoFocus
          />
          {filteredBodies.length === 0 && (
            <div className="slicer-workspace-objects-panel__menu-empty">
              {addableBodiesCount === 0
                ? "No CAD bodies available."
                : "No matches."}
            </div>
          )}
          {filteredBodies.map((body) => (
            <div
              key={body.id}
              onClick={() => onAddBody(body.id, body.name)}
              className="slicer-workspace-objects-panel__menu-item"
            >
              <Box
                size={12}
                className="slicer-workspace-objects-panel__menu-item-icon"
              />
              {body.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
