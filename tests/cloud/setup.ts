import { cleanup, save, service, type Fixture } from "./fixture";

export default async function setup() {
  const admin = service();
  const state: Fixture = { event: "", sessions: [], teams: [], accounts: {} };
  save(state);
  try {
    const tag = crypto.randomUUID();
    const { data: event, error } = await admin
      .from("events")
      .insert({ name: `Automated test ${tag}` })
      .select("id")
      .single();
    if (error) throw error;
    state.event = event.id;
    save(state);
    for (const name of ["Primary", "Isolation"]) {
      const { data, error } = await admin
        .from("sessions")
        .insert({
          event_id: state.event,
          name: `Test ${name}`,
          intake_open: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      state.sessions.push(data.id);
      save(state);
    }
    for (const [name, s] of [
      ["Aurora", 0],
      ["Cedar", 0],
      ["Isolated", 1],
    ] as const) {
      const { data, error } = await admin
        .from("teams")
        .insert({
          session_id: state.sessions[s],
          name,
          location: `Test desk ${name}`,
        })
        .select("id")
        .single();
      if (error) throw error;
      state.teams.push(data.id);
      save(state);
    }
    for (const [name, roles, team, isAdmin, s] of [
      ["admin", [], null, true, 0],
      ["contestant", [], 0, false, 0],
      ["cedar", [], 1, false, 0],
      ["volunteer", ["volunteer"], null, false, 0],
      ["specialist", ["specialist"], null, false, 0],
      ["jury", ["jury"], null, false, 0],
      ["combined", ["volunteer", "specialist", "jury"], null, false, 0],
      ["isolated", [], 2, false, 1],
    ] as const) {
      const email = `minsky-${tag}-${name}@example.invalid`;
      const password = crypto.randomUUID() + "A9!";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `Test ${name}` },
      });
      if (error || !data.user) throw error ?? new Error("Missing test account");
      state.accounts[name] = { id: data.user.id, email, password };
      save(state);
      const { error: memberError } = await admin
        .from("memberships")
        .insert({
          session_id: state.sessions[s],
          user_id: data.user.id,
          team_id: team === null ? null : state.teams[team],
          roles,
          is_admin: isAdmin,
        });
      if (memberError) throw memberError;
    }
  } catch (cause) {
    await cleanup(state);
    throw cause;
  }
}
