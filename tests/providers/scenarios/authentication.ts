import type { ScenarioContext } from '../contracts';
import { change, check, rejects, submit } from './assertions';
import { verifyTemporaryAuthentication } from './authentication-lifecycle';

export async function authentication(context: ScenarioContext): Promise<void> {
  const backend = await context.connect();
  await verifyTemporaryAuthentication(backend.auth, context.accounts.temporary, {
    restricted: () => rejects(() => submit(backend, context.sessionId)),
    ready: () => submit(backend, context.sessionId),
  });
}

export async function accountCreation(context: ScenarioContext): Promise<void> {
  const admin = await context.connect('admin');
  const volunteer = await context.connect('volunteer');
  const contestant = context.createdAccounts.contestant;
  const staff = context.createdAccounts.staff;
  const teamCommand = { action: 'create_account' as const, ...contestant,
    teamId: context.teamId, roles: [], isAdmin: false };
  const before = (await admin.workflows.snapshot(context.sessionId)).members;
  await rejects(() => volunteer.admin.account(context.sessionId, teamCommand));
  await rejects(() => admin.admin.account(context.otherSessionId, teamCommand));
  await rejects(() => admin.admin.account(context.sessionId, { ...teamCommand, roles: ['volunteer'] }));
  check((await admin.workflows.snapshot(context.sessionId)).members.length === before.length,
    'Rejected account creation must not add a membership.');
  const created = await admin.admin.account(context.sessionId, teamCommand);
  check(created.temporaryPassword, 'The organizer must receive a temporary password for a new account.');
  const teamClient = await context.connect();
  await teamClient.auth.signIn(contestant.username, created.temporaryPassword);
  const teamId = (await teamClient.auth.currentUser())?.id;
  check(teamId, 'The created contestant must have an authenticated identity.');
  check((await teamClient.auth.accountStatus()).must_change, 'New accounts must require a password change.');
  await rejects(() => submit(teamClient, context.sessionId));
  await teamClient.auth.changePassword(created.temporaryPassword, crypto.randomUUID() + 'A9!');
  const sessions = await teamClient.workflows.sessions(teamId);
  check(sessions.length === 1 && sessions[0]!.id === context.sessionId, 'The new account must see only its assigned session.');
  const issueId = await submit(teamClient, context.sessionId);
  await rejects(() => change(teamClient, context.sessionId, issueId, { type: 'claim', issue_id: issueId, revision: 0 }));

  const staffCommand = { action: 'create_account' as const, ...staff,
    teamId: null, roles: ['volunteer', 'jury'] as Array<'volunteer' | 'jury'>, isAdmin: false };
  context.discardNextAccountResponse(admin);
  await rejects(() => admin.admin.account(context.sessionId, staffCommand));
  const members = (await admin.workflows.snapshot(context.sessionId)).members;
  const matching = members.filter((member) => member.person.username === staff.username);
  check(matching.length === 1, 'A lost create response must leave exactly one created account.');
  const staffId = matching[0]!.person.id;
  check(matching[0]!.person.name === staff.name && matching[0]!.membership.team_id === null &&
    !matching[0]!.membership.is_admin && ['volunteer', 'jury'].every((role) => matching[0]!.membership.roles.includes(role as 'volunteer' | 'jury')),
  'The created staff account must retain its person and combined roles.');
  await rejects(() => admin.admin.account(context.sessionId, staffCommand));
  const repeated = (await admin.workflows.snapshot(context.sessionId)).members.filter((member) => member.person.username === staff.username);
  check(repeated.length === 1 && repeated[0]!.person.id === staffId, 'Repeating creation must not duplicate or replace the account.');
  const recovered = await admin.admin.account(context.sessionId, { action: 'reset_password', userId: staffId });
  check(recovered.temporaryPassword, 'Organizer recovery must recover a password lost with the create response.');
  const staffClient = await context.connect();
  await staffClient.auth.signIn(staff.username, recovered.temporaryPassword);
  check((await staffClient.auth.currentUser())?.id === staffId, 'Recovery must preserve the created account ID.');
  check((await staffClient.auth.accountStatus()).must_change, 'A recovered created account must require a password change.');
  await rejects(() => submit(staffClient, context.sessionId, context.teamId));
  await staffClient.auth.changePassword(recovered.temporaryPassword, crypto.randomUUID() + 'A9!');
  await rejects(() => staffClient.admin.setIntake(context.sessionId, false));
  await change(staffClient, context.sessionId, issueId, { type: 'claim', issue_id: issueId, revision: 0 });
  await change(staffClient, context.sessionId, issueId, { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Created staff repair.' });
  await change(staffClient, context.sessionId, issueId, { type: 'award', issue_id: issueId, revision: 0, minutes: 0, explanation: 'Created jury decision.' });
  const snapshot = await staffClient.workflows.snapshot(context.sessionId);
  check(snapshot.issues.find((issue) => issue.id === issueId)?.owner === staffId && snapshot.awards.some((award) => award.issue_id === issueId),
    'One created person must receive all capabilities from the assigned staff roles.');
}

export async function revocation(context: ScenarioContext): Promise<void> {
  const admin = await context.connect('admin');
  const member = await context.connect('revoked');
  const user = context.accounts.revoked;
  const sessions = await member.workflows.sessions(user.id);
  check(
    sessions.some((item) => item.id === context.sessionId),
    'A member must see the assigned session.',
  );
  await admin.admin.removeMember(context.sessionId, user.id);
  const removed = await member.workflows.sessions(user.id);
  check(
    !removed.some((item) => item.id === context.sessionId),
    'Removing membership must hide the session.',
  );
  const snapshot = await member.workflows.snapshot(context.sessionId);
  check(
    snapshot.membership === null && snapshot.issues.length === 0,
    'An existing login must lose session data after removal.',
  );
  await rejects(() => submit(member, context.sessionId, context.teamId));
  await admin.admin.saveMember(context.sessionId, user.id, {
    teamId: null,
    roles: ['volunteer'],
    isAdmin: false,
  });
  await submit(member, context.sessionId, context.teamId);
  await rejects(() =>
    admin.admin.account(context.sessionId, {
      action: 'reset_password',
      userId: user.id,
    })
  );
  check(
    (await member.auth.accountStatus()).session_valid,
    'A rejected cross-session reset must preserve the existing login.',
  );
  const otherAdmin = await context.connect('otherAdmin');
  await otherAdmin.admin.removeMember(context.otherSessionId, user.id);
  const reset = await admin.admin.account(context.sessionId, {
    action: 'reset_password',
    userId: user.id,
  });
  check(
    reset.temporaryPassword,
    'A password reset must return temporary credentials to the administrator.',
  );
  const status = await member.auth.accountStatus();
  check(
    !status.session_valid && status.must_change,
    'A password reset must invalidate the existing login.',
  );
  await rejects(() => submit(member, context.sessionId, context.teamId));
  const replacement = await context.connect();
  await replacement.auth.signIn(user.username, reset.temporaryPassword);
  check(
    (await replacement.auth.accountStatus()).must_change,
    'The replacement login must require a password change.',
  );
  await replacement.auth.changePassword(
    reset.temporaryPassword,
    crypto.randomUUID() + 'A9!',
  );
  await submit(replacement, context.sessionId, context.teamId);
}
