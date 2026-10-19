import type { AccountIdentity } from "../../backend/contracts";
import type { Snapshot } from "../../connected/model";
import { PageHeading } from "../../connected/ui";

export function AccountPage({
  state,
  user,
  username,
  changePassword,
}: {
  state: Snapshot;
  user: AccountIdentity;
  username: string | null;
  changePassword: () => void;
}) {
  const m = state.membership;
  if (!m || !state.session) return null;
  return (
    <>
      <PageHeading
        title="My account"
        description="Your sign-in details and session permissions."
      />
      <section className="panel account-panel">
        <h2>Sign-in and access</h2>
        <dl className="account-details">
          <div>
            <dt>Username</dt>
            <dd>{username ?? user.email}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{state.session.name}</dd>
          </div>
          <div>
            <dt>Permissions</dt>
            <dd>
              {m.team_id
                ? `Contestant · ${
                    state.teams.find((team) => team.id === m.team_id)?.name ??
                    "Your team"
                  }`
                : [...m.roles, ...(m.is_admin ? ["admin"] : [])].join(" + ")}
            </dd>
          </div>
        </dl>
        <button onClick={changePassword}>Change password</button>
        <p className="field-help">
          Contact your organizer if your team assignment or permissions need to
          change.
        </p>
      </section>
    </>
  );
}
