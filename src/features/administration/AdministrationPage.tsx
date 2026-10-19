import { useRef, useState } from "react";
import { requireBackend } from "../../backend";
import type { AccountCommand, MembershipInput } from "../../backend/contracts";
import { errorMessage } from "../../backend/errors";
import { formData, text } from "../../connected/forms";
import {
  type Membership,
  roleSchema,
  type Snapshot,
} from "../../connected/model";
import { PageHeading } from "../../connected/ui";
import { statusNames } from "../issues/status";

const formatDate = (value: string) => new Date(value).toLocaleString();

function memberInput(data: FormData): MembershipInput {
  return {
    teamId: text(data, "team") || null,
    roles: data.getAll("role").map((role) => roleSchema.parse(role)),
    isAdmin: data.has("admin"),
  };
}

export function AdministrationPage({
  state,
  refresh,
}: {
  state: Snapshot;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  }>();
  const guard = useRef(false);
  const session = state.session;
  if (!session) return null;
  async function run(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setCredentials(undefined);
    try {
      await work();
      await refresh();
      setNotice("Administration action completed.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  async function account(action: AccountCommand["action"], data: FormData) {
    if (!session) return;
    const command: AccountCommand =
      action === "create_account"
        ? {
            action,
            username: text(data, "username"),
            name: text(data, "name"),
            ...memberInput(data),
          }
        : action === "set_username"
          ? {
              action,
              userId: text(data, "user"),
              username: text(data, "username"),
            }
          : { action, userId: text(data, "user") };
    const result = await requireBackend().admin.account(session.id, command);
    if (result.temporaryPassword) {
      const target = state.members.find(
        (m) => m.person.id === text(data, "user"),
      );
      setCredentials({
        username:
          text(data, "username") ||
          target?.person.username ||
          "Existing email login",
        password: result.temporaryPassword,
      });
    }
  }
  return (
    <>
      <PageHeading
        title="Administration"
        description="Manage session access, accounts and contestant intake."
      />
      <section className="panel admin-panel">
        <div className="admin-heading">
          <div>
            <p className="eyebrow">Organizer workspace</p>
            <h2>Session administration</h2>
            <p>Manage access and keep {session.name} running.</p>
          </div>
          <span
            className={`intake-status ${session.intake_open ? "is-open" : ""}`}
          >
            Intake {session.intake_open ? "open" : "closed"}
          </span>
        </div>
        {state.event?.archived && (
          <p className="alert">
            This event is archived. Account changes are disabled.
          </p>
        )}
        {credentials && (
          <section
            className="credential-result"
            aria-label="Temporary account credentials"
          >
            <h3>Share these credentials securely</h3>
            <p>
              This password is shown for this action only. If it’s lost, issue a
              new one. The user must change it on login.
            </p>
            <label>
              Account username
              <input readOnly value={credentials.username} />
            </label>
            <label>
              Temporary password
              <input readOnly value={credentials.password} autoComplete="off" />
            </label>
            <button className="quiet" onClick={() => setCredentials(undefined)}>
              Dismiss credentials
            </button>
          </section>
        )}
        <fieldset disabled={busy || state.event?.archived}>
          <legend className="sr-only">Session administration</legend>
          <div className="admin-stats" aria-label="Issue status counts">
            {Object.entries(statusNames).map(([key, value]) => (
              <div key={key}>
                <strong>
                  {state.issues.filter((i) => i.status === key).length}
                </strong>
                <span>{value}</span>
              </div>
            ))}
          </div>
          <div className="intake-controls">
            <div>
              <h3>Contestant submissions</h3>
              <p>
                Closing intake stops new contestant reports. Staff work and
                reopening remain available.
              </p>
            </div>
            <button
              onClick={() => {
                void run(async () =>
                  requireBackend().admin.setIntake(
                    session.id,
                    !session.intake_open,
                  ),
                );
              }}
            >
              {session.intake_open
                ? "Close contestant intake"
                : "Open contestant intake"}
            </button>
          </div>
          <form
            className="image-limits"
            key={`${session.max_image_bytes}-${session.max_images_per_issue}-${session.max_image_bytes_per_issue}`}
            onSubmit={(event) => {
              const data = formData(event);
              void run(async () =>
                requireBackend().admin.setImageLimits(session.id, {
                  fileMegabytes: Number(text(data, "file_mb")),
                  count: Number(text(data, "count")),
                  totalMegabytes: Number(text(data, "total_mb")),
                }),
              );
            }}
          >
            <div>
              <h3>Image limits</h3>
              <p>
                JPEG, PNG, and WebP images. Lowering a limit leaves images that
                are already attached.
              </p>
            </div>
            <label>
              Maximum size of one image (MB)
              <input
                name="file_mb"
                type="number"
                min={1}
                max={50}
                step={1}
                required
                defaultValue={session.max_image_bytes / 1048576}
              />
            </label>
            <label>
              Maximum images on one issue
              <input
                name="count"
                type="number"
                min={1}
                max={24}
                step={1}
                required
                defaultValue={session.max_images_per_issue}
              />
            </label>
            <label>
              Maximum combined size on one issue (MB)
              <input
                name="total_mb"
                type="number"
                min={1}
                max={120}
                step={1}
                required
                defaultValue={session.max_image_bytes_per_issue / 1048576}
              />
            </label>
            <button type="submit">Save image limits</button>
          </form>
          <div className="admin-workspace">
            <section className="admin-section">
              <div className="admin-section-heading">
                <h3>Create an account</h3>
                <p>One account per team. Individual accounts for staff.</p>
              </div>
              <form
                onSubmit={(event) => {
                  const data = formData(event);
                  void run(() => account("create_account", data));
                }}
              >
                <label>
                  Display name
                  <input
                    name="name"
                    required
                    maxLength={200}
                    placeholder="Team Aurora or Alex Morgan"
                  />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="team-aurora"
                  />
                </label>
                <p className="field-help">
                  3–32 letters, digits, underscores or hyphens. Usernames are
                  stored in lowercase.
                </p>
                <MembershipFields state={state} />
                <button type="submit">
                  {busy ? "Working…" : "Create account"}
                </button>
              </form>
              <p className="field-help">
                You’ll receive a temporary password to share securely. The user
                must change it before accessing the contest.
              </p>
            </section>
            <section className="admin-section">
              <div className="admin-section-heading">
                <h3>
                  Session accounts{" "}
                  <span className="account-count">{state.members.length}</span>
                </h3>
                <p>Expand an account to update permissions or reset access.</p>
              </div>
              <div className="account-list">
                {state.members.map(({ membership: m, person }) => (
                  <details key={person.id} className="account-entry">
                    <summary>
                      <span>
                        <strong>{person.name}</strong>
                        <small>
                          {person.username ?? "Username not assigned"}
                        </small>
                      </span>
                      <span className="account-role">
                        {m.team_id
                          ? (state.teams.find((t) => t.id === m.team_id)
                              ?.name ?? "Team contestant")
                          : [...m.roles, ...(m.is_admin ? ["admin"] : [])].join(
                              " + ",
                            )}
                      </span>
                    </summary>
                    {!person.username && (
                      <form
                        onSubmit={(event) => {
                          const data = formData(event);
                          data.set("user", person.id);
                          void run(() => account("set_username", data));
                        }}
                      >
                        <label>
                          Assign username
                          <input
                            name="username"
                            required
                            minLength={3}
                            maxLength={32}
                            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                        </label>
                        <button type="submit">Set username</button>
                        <p className="field-help">
                          The existing password stays the same. Use this
                          username for future logins.
                        </p>
                      </form>
                    )}
                    <form
                      onSubmit={(event) => {
                        const data = formData(event);
                        void run(async () =>
                          requireBackend().admin.saveMember(
                            session.id,
                            person.id,
                            memberInput(data),
                          ),
                        );
                      }}
                    >
                      <MembershipFields
                        key={JSON.stringify(m)}
                        state={state}
                        member={m}
                      />
                      <button type="submit">Save membership</button>
                    </form>
                    <div className="account-actions">
                      {person.id !== state.membership?.user_id && (
                        <button
                          className="quiet"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Reset ${person.name}'s password? Verify their identity first. Existing sessions will lose access.`,
                              )
                            )
                              return;
                            const data = new FormData();
                            data.set("user", person.id);
                            void run(() => account("reset_password", data));
                          }}
                        >
                          Reset password
                        </button>
                      )}
                      <button
                        className="quiet danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke ${person.name}'s access to this session?`,
                            )
                          ) {
                            void run(async () =>
                              requireBackend().admin.removeMember(
                                session.id,
                                person.id,
                              ),
                            );
                          }
                        }}
                      >
                        Revoke session access
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </div>
          <details className="admin-advanced">
            <summary>Assign an existing account by ID</summary>
            <p>For trusted provisioning and accounts that already exist.</p>
            <form
              onSubmit={(event) => {
                const data = formData(event);
                void run(async () =>
                  requireBackend().admin.saveMember(
                    session.id,
                    text(data, "user"),
                    memberInput(data),
                  ),
                );
              }}
            >
              <label>
                Auth user UUID
                <input name="user" required />
              </label>
              <MembershipFields state={state} />
              <button type="submit">Assign membership</button>
            </form>
          </details>
          <details className="admin-advanced">
            <summary>Recent administration activity</summary>
            <ul>
              {state.audit.map((a) => (
                <li key={a.id}>
                  {a.action.replaceAll("_", " ")} ·{" "}
                  {state.members.find((m) => m.person.id === a.actor)?.person
                    .name ?? a.actor}{" "}
                  · {formatDate(a.at)}
                </li>
              ))}
            </ul>
          </details>
        </fieldset>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <p role="status">{notice}</p>
      </section>
    </>
  );
}

function MembershipFields({
  state,
  member,
}: {
  state: Snapshot;
  member?: Membership;
}) {
  const [team, setTeam] = useState(member?.team_id ?? "");
  return (
    <>
      <label>
        Contestant team
        <select
          name="team"
          value={team}
          onChange={(event) => setTeam(event.target.value)}
        >
          <option value="">Staff account</option>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        {team
          ? "This account can submit and view issues for the selected team."
          : "Choose the permissions this staff member needs."}
      </p>
      {!team && (
        <fieldset className="staff-options">
          <legend>Staff permissions</legend>
          {(["volunteer", "specialist", "jury"] as const).map((role) => (
            <label key={role} className="checkbox">
              <input
                name="role"
                type="checkbox"
                value={role}
                defaultChecked={member?.roles.includes(role)}
              />
              {role}
            </label>
          ))}
          <label className="checkbox">
            <input
              name="admin"
              type="checkbox"
              defaultChecked={member?.is_admin}
            />
            Admin
          </label>
        </fieldset>
      )}
    </>
  );
}
