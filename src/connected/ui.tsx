type IconName =
  | "issues"
  | "account"
  | "settings"
  | "logout"
  | "plus"
  | "eye"
  | "eye-off"
  | "pin"
  | "team"
  | "handoff"
  | "lock";

const iconPaths: Record<IconName, string> = {
  issues: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  account: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2Z",
  settings:
    "M3 7h4m6 0h8M3 17h10m6 0h2M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  logout: "M14 5V3H4v18h10v-2M10 12h11m-4-4 4 4-4 4",
  plus: "M12 4v16M4 12h16",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "eye-off":
    "m3 3 18 18M10 5c.7-.1 1.3-.1 2-.1 6.5 0 10 7.1 10 7.1a17 17 0 0 1-4 4M6 6a18 18 0 0 0-4 6s3.5 7 10 7c2 0 3.7-.7 5-1.5M10 10a3 3 0 0 0 4 4",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  team: "M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 21v-2a7 7 0 0 1 14 0v2M18 4a3 3 0 0 1 0 6M21 21v-2a7 7 0 0 0-3-5M6 4a3 3 0 0 0 0 6M3 21v-2a7 7 0 0 1 3-5",
  handoff: "M3 10h11L9 5l3-3 10 10-10 10-3-3 5-5H3Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function Brand() {
  return (
    <a className="brand" href="#main" aria-label="Minsky home">
      <svg className="brand-mark" viewBox="0 0 64 40" aria-hidden="true">
        <path fill="#8dec99" d="M17 2h13L13 38H0Z" />
        <path fill="#61c877" d="M30 2 43 38H30L23 19Z" />
        <path fill="#a3efab" d="M40 6h12L36 38H24Z" />
        <path fill="#70ce83" d="m52 6 12 32H52l-6-17Z" />
      </svg>
      <span>Minsky</span>
    </a>
  );
}

export function clockDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading settings-heading">
      <div>
        <h1 id="workspace-heading" tabIndex={-1}>
          {title}
        </h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
