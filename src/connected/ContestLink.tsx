import { type ComponentProps } from "react";
import { Link, useLocation } from "react-router";
import { contestOfSearch, searchWithContest } from "./navigation";

/**
 * A link to a page of the app that keeps the open contest in its address.
 * React Router opens a link to the page that is already open by replacing the
 * history entry, and it tests that by comparing the link's address with the
 * current one, search included. The current address holds `?contest=`, so a
 * link without it adds an entry per click, and Back lands on the page it left.
 * Use this for a link that can point at the page it is on. `to` is a path.
 */
export function ContestLink({ to, ...props }: Omit<ComponentProps<typeof Link>, "to"> & { to: string }) {
  const contest = contestOfSearch(useLocation().search);
  return <Link {...props} to={contest === undefined ? to : { pathname: to, search: searchWithContest("", contest) }} />;
}
