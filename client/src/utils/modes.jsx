import { MdDirectionsBus, MdTrain, MdFlight } from 'react-icons/md';

const ICONS = { bus: MdDirectionsBus, train: MdTrain, flight: MdFlight };

export function ModeIcon({ mode, size = 18 }) {
  const Icon = ICONS[mode] || MdDirectionsBus;
  return <Icon size={size} aria-hidden="true" />;
}

export function ModeChip({ mode }) {
  return (
    <span className="mode-chip">
      <ModeIcon mode={mode} size={16} />
      {mode}
    </span>
  );
}
