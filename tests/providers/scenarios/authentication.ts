import type { ScenarioContext } from '../contracts';
import { assignStaff, change, check, manage, rejects, setIntake, submit } from './assertions';
import { verifyTemporaryAuthentication } from './authentication-lifecycle';

export async function authentication(context: ScenarioContext): Promise<void> {
  const backend = await context.connect();
  await verifyTemporaryAuthentication(backend.auth, context.accounts.temporary, {
    restricted: () => rejects(() => submit(backend, context.sessionId)),
    ready: () => submit(backend, context.sessionId),
  });
}

export async function accountCreation(context: ScenarioContext): Promise<void> {
  const eventAdmin = await context.connect('eventAdmin');
  const volunteer = await context.connect('volunteer');
  const contestAdmin = await context.connect('admin');
  const contestant = context.createdAccounts.contestant;
  const staff = context.createdAccounts.staff;
  const entrant = { kind: 'single' as const, name: contestant.name, handle: contestant.username };
  const before = (await eventAdmin.workflows.snapshot(context.sessionId)).members;
  // Only an event admin or a webmaster creates accounts and assigns people.
  await rejects(() => manage(volunteer, { type: 'create_entrants', eventId: context.eventId, entrants: [entrant] }));
  await rejects(() => manage(contestAdmin, { type: 'create_entrants', eventId: context.eventId, entrants: [entrant] }));
  await rejects(() => manage(contestAdmin, { type: 'create_people', eventId: context.eventId, people: [{ name: staff.name, handle: staff.username }] }));
  check((await eventAdmin.workflows.snapshot(context.sessionId)).members.length === before.length,
    'Rejected account creation must not add a membership.');
  const entrants = await manage(eventAdmin, { type: 'create_entrants', eventId: context.eventId, entrants: [entrant] });
  const [entrantId] = entrants.entrantIds!;
  await rejects(() => manage(contestAdmin, { type: 'assign_entrants', contestId: context.sessionId, entries: [{ entrantId: entrantId!, location: 'Desk' }] }));
  await manage(eventAdmin, { type: 'assign_entrants', contestId: context.sessionId, entries: [{ entrantId: entrantId!, location: 'Desk' }] });
  const issued = await eventAdmin.manage.issueCredentials(crypto.randomUUID(), { eventId: context.eventId, accountIds: entrants.accountIds!, contestId: null });
  const temporaryPassword = issued[0]?.temporaryPassword;
  check(temporaryPassword, 'The event admin must receive a temporary password for a new account.');
  const teamClient = await context.connect();
  await teamClient.auth.signIn(context.signIn, contestant.username, temporaryPassword);
  const teamId = (await teamClient.auth.currentUser())?.id;
  check(teamId, 'The created contestant must have an authenticated identity.');
  check((await teamClient.auth.accountStatus()).must_change, 'New accounts must require a password change.');
  await rejects(() => submit(teamClient, context.sessionId));
  await teamClient.auth.changePassword(temporaryPassword, crypto.randomUUID() + 'A9!');
  const contests = await teamClient.workflows.contests();
  check(contests.length === 1 && contests[0]!.id === context.sessionId, 'The new account must see only its assigned contest.');
  const issueId = await submit(teamClient, context.sessionId);
  await rejects(() => change(teamClient, context.sessionId, issueId, { type: 'claim', issue_id: issueId, revision: 0 }));

  const people = await manage(eventAdmin, { type: 'create_people', eventId: context.eventId, people: [{ name: staff.name, handle: staff.username }] });
  const staffId = people.accountIds![0]!;
  await assignStaff(eventAdmin, context.sessionId, staffId, ['volunteer', 'jury']);
  // A response that the client loses leaves the passwords unknown. The retry returns the accounts without them.
  const lostRequest = crypto.randomUUID();
  context.discardNextAccountResponse(eventAdmin);
  await rejects(() => eventAdmin.manage.issueCredentials(lostRequest, { eventId: context.eventId, accountIds: [staffId], contestId: null }));
  const replayed = await eventAdmin.manage.issueCredentials(lostRequest, { eventId: context.eventId, accountIds: [staffId], contestId: null });
  check(replayed.length === 1 && replayed[0]!.temporaryPassword === null, 'A retry of a committed issue must not return the password again.');
  const members = (await eventAdmin.workflows.snapshot(context.sessionId)).members;
  const matching = members.filter((member) => member.person.username === staff.username);
  check(matching.length === 1, 'A lost issue response must leave exactly one created account.');
  check(matching[0]!.person.id === staffId && matching[0]!.person.name === staff.name && matching[0]!.membership.team_id === null &&
    !matching[0]!.membership.is_admin && ['volunteer', 'jury'].every((role) => matching[0]!.membership.roles.includes(role as 'volunteer' | 'jury')),
  'The created staff account must retain its person and combined roles.');
  const recovered = (await eventAdmin.manage.issueCredentials(crypto.randomUUID(), { eventId: context.eventId, accountIds: [staffId], contestId: null }))[0]?.temporaryPassword;
  check(recovered, 'Issuing again must recover a password lost with the first response.');
  const staffClient = await context.connect();
  await staffClient.auth.signIn(context.signIn, staff.username, recovered);
  check((await staffClient.auth.currentUser())?.id === staffId, 'Issuing again must preserve the created account ID.');
  check((await staffClient.auth.accountStatus()).must_change, 'A reissued account must require a password change.');
  await rejects(() => submit(staffClient, context.sessionId, context.teamId));
  await staffClient.auth.changePassword(recovered, crypto.randomUUID() + 'A9!');
  await rejects(() => setIntake(staffClient, context.sessionId, false));
  await change(staffClient, context.sessionId, issueId, { type: 'claim', issue_id: issueId, revision: 0 });
  await change(staffClient, context.sessionId, issueId, { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Created staff repair.' });
  await change(staffClient, context.sessionId, issueId, { type: 'award', issue_id: issueId, revision: 0, minutes: 0, explanation: 'Created jury decision.' });
  const snapshot = await staffClient.workflows.snapshot(context.sessionId);
  check(snapshot.issues.find((issue) => issue.id === issueId)?.owner === staffId && snapshot.awards.some((award) => award.issue_id === issueId),
    'One created person must receive all capabilities from the assigned staff roles.');
}

export async function revocation(context: ScenarioContext): Promise<void> {
  const eventAdmin = await context.connect('eventAdmin');
  const admin = await context.connect('admin');
  const member = await context.connect('revoked');
  const user = context.accounts.revoked;
  const contests = await member.workflows.contests();
  check(
    contests.some((item) => item.id === context.sessionId),
    'A member must see the assigned contest.',
  );
  await manage(eventAdmin, { type: 'unassign_staff', contestId: context.sessionId, accountId: user.id });
  const removed = await member.workflows.contests();
  check(
    !removed.some((item) => item.id === context.sessionId),
    'Removing the seat must hide the contest.',
  );
  const snapshot = await member.workflows.snapshot(context.sessionId);
  check(
    snapshot.membership === null && snapshot.issues.length === 0,
    'An existing login must lose contest data after removal.',
  );
  await rejects(() => submit(member, context.sessionId, context.teamId));
  await assignStaff(eventAdmin, context.sessionId, user.id, ['volunteer']);
  await submit(member, context.sessionId, context.teamId);
  // The contest admin of one contest cannot reissue for a person who also sits in another.
  await rejects(() =>
    admin.manage.issueCredentials(crypto.randomUUID(), { eventId: context.eventId, accountIds: [user.id], contestId: null })
  );
  check(
    (await member.auth.accountStatus()).session_valid,
    'A rejected cross-contest reissue must preserve the existing login.',
  );
  await manage(eventAdmin, { type: 'unassign_staff', contestId: context.otherSessionId, accountId: user.id });
  const reset = (await admin.manage.issueCredentials(crypto.randomUUID(), { eventId: context.eventId, accountIds: [user.id], contestId: null }))[0]?.temporaryPassword;
  check(
    reset,
    'A reissue must return temporary credentials to the administrator.',
  );
  const status = await member.auth.accountStatus();
  check(
    !status.session_valid && status.must_change,
    'A password reissue must invalidate the existing login.',
  );
  await rejects(() => submit(member, context.sessionId, context.teamId));
  const replacement = await context.connect();
  await replacement.auth.signIn(user.target, user.username, reset);
  check(
    (await replacement.auth.accountStatus()).must_change,
    'The replacement login must require a password change.',
  );
  await replacement.auth.changePassword(
    reset,
    crypto.randomUUID() + 'A9!',
  );
  await submit(replacement, context.sessionId, context.teamId);
}
