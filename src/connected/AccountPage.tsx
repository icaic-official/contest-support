import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Membership } from "./model";
import type { ShellProps } from "./shell";

/** The current account and its capabilities in the selected session. */
export function AccountPage({
  shell,
  member,
  headingId,
}: {
  shell: ShellProps;
  member: Membership;
  headingId: string;
}) {
  const capabilities = [
    ...member.roles,
    ...(member.is_admin ? ["Session admin"] : []),
  ];
  return (
    <Card className="mx-auto my-6 w-full max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 id={headingId} tabIndex={-1} className="outline-none">
            My account
          </h1>
        </CardTitle>
        <CardDescription>
          Your access to the selected contest session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4">
          <div>
            <dt className="text-sm text-muted-foreground">Username</dt>
            <dd>{shell.username ?? shell.user.email ?? shell.user.id}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Roles</dt>
            <dd>
              {capabilities.join(", ") ||
                (member.team_id ? "Contestant" : "No staff roles")}
            </dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button onClick={shell.changePassword}>Change password</Button>
        <Button variant="outline" asChild>
          <Link to="/issues">Issues</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
