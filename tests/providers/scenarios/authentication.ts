import type { ScenarioContext } from '../contracts';
import { check, rejects, submit } from './assertions';
import { verifyTemporaryAuthentication } from './authentication-lifecycle';

export async function authentication(context: ScenarioContext): Promise<void> {
  const backend = await context.connect();
  await verifyTemporaryAuthentication(backend.auth, context.accounts.temporary, {
    restricted: () => rejects(() => submit(backend, context.sessionId)),
    ready: () => submit(backend, context.sessionId),
  });
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
