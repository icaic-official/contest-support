import { type ComponentProps } from "react";
import { Link, useLocation } from "react-router";
import { keepContest } from "./navigation";

/**
 * A link to a page of the app that keeps the search of the address, with the
 * open contest, and the owner of that contest.
 * React Router opens a link to the page that is already open by replacing the
 * history entry, and it tests that by comparing the link's address with the
 * current one, search included. The current address holds `?contest=`, so a
 * link without it adds an entry per click, and Back lands on the page it left.
 * Use this for a link that can point at the page it is on. `to` is a path.
 */
export function ContestLink({ to, ...props }: Omit<ComponentProps<typeof Link>, "to"> & { to: string }) {
  const entry = keepContest(useLocation(), to);
  return <Link {...props} to={entry.to} state={entry.state} />;
}
