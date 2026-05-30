interface ChamferPickHeaderProps {
  selectedEdgeCount: number;
}

export function ChamferPickHeader({
  selectedEdgeCount,
}: ChamferPickHeaderProps) {
  return <p className="dialog-hint">{selectedEdgeCount} edge(s) selected</p>;
}
