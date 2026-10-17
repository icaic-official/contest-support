import type { ScenarioContext } from '../contracts';
import { check, eventually, rejects, submit } from './assertions';

export async function authentication(context: ScenarioContext): Promise<void> {
  const backend = await context.connect();
  check(
    await backend.auth.currentUser() === undefined,
    'A new client must start signed out.',
  );
  const account = context.accounts.temporary;
  let currentId: string | undefined;
  let notifications = 0;
  const stop = backend.auth.subscribe((user) => {
    currentId = user?.id;
    notifications++;
  });
  try {
    await backend.auth.signIn(account.username, account.password);
    check(
      (await backend.auth.currentUser())?.id === account.id,
      'Sign-in must identify the fixture account.',
    );
    await eventually(
      () => currentId === account.id,
      'Authentication must notify subscribers after sign-in.',
    );
    check(
      (await backend.auth.accountStatus()).must_change,
      'Temporary credentials must require a password change.',
    );
    await rejects(() => submit(backend, context.sessionId));
    const password = crypto.randomUUID() + 'A9!';
    await backend.auth.changePassword(account.password, password);
    const status = await backend.auth.accountStatus();
    check(
      !status.must_change && status.session_valid,
      'A completed password change must grant a valid session.',
    );
    await submit(backend, context.sessionId);
    await backend.auth.signOut();
    check(
      await backend.auth.currentUser() === undefined,
      'Sign-out must clear the current identity.',
    );
    await eventually(
      () => currentId === undefined,
      'Authentication must notify subscribers after sign-out.',
    );
    await rejects(() =>
      backend.auth.signIn(account.username, account.password)
    );
    stop();
    stop();
    const stoppedAt = notifications;
    await backend.auth.signIn(account.username, password);
    await backend.auth.signOut();
    check(
      notifications === stoppedAt,
      'Authentication cleanup must suppress later callbacks.',
    );
  } finally {
    stop();
  }
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
