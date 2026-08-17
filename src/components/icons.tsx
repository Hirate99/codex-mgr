import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const PlayIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4.5 2.5v11l9-5.5-9-5.5z" />
  </svg>
);

export const StopIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
  </svg>
);

export const MonitorIcon = (
  <Icon>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 13.5h5M8 11v2.5" />
  </Icon>
);

export const TerminalIcon = (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 6.5l2.5 2-2.5 2M9 10.5h2.5" />
  </Icon>
);

export const TrashIcon = (
  <Icon>
    <path d="M2.5 4h11M6.5 2h3M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 7v4M9.5 7v4" />
  </Icon>
);

export const PlusIcon = (
  <Icon strokeWidth={1.7}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const LayersIcon = (
  <Icon>
    <path d="m8 2 6 3-6 3-6-3 6-3Z" />
    <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
  </Icon>
);

export const ActivityIcon = (
  <Icon>
    <path d="M2 8h3l1.5-4 3 8L11 8h3" />
  </Icon>
);

export const ImportIcon = (
  <Icon>
    <path d="M8 2v8M5 7l3 3 3-3M3 13h10" />
  </Icon>
);

export const RefreshIcon = (
  <Icon>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2v3h-3" />
  </Icon>
);

export const SearchIcon = (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .18s ease" }}
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
);
