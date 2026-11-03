import type { Authentication } from '../../../src/backend/contracts';
import type { TestAccount } from '../contracts';
import { check, eventually, rejects } from './assertions';

/** Provider setup stays outside these shared authentication assertions. */
export async function verifyTemporaryAuthentication(
  auth: Authentication,
  account: TestAccount,
  access: { restricted(): Promise<unknown>; ready(): Promise<unknown> },
): Promise<void> {
  check(await auth.currentUser() === undefined, 'A new client must start signed out.');
  let currentId: string | undefined;
  let notifications = 0;
  const stop = auth.subscribe((user) => {
    currentId = user?.id;
    notifications++;
  });
  try {
    await auth.signIn(account.target, account.username, account.password);
    check((await auth.currentUser())?.id === account.id, 'Sign-in must identify the fixture account.');
    await eventually(() => currentId === account.id, 'Authentication must notify subscribers after sign-in.');
    check((await auth.accountStatus()).must_change, 'Temporary credentials must require a password change.');
    await access.restricted();
    const password = crypto.randomUUID() + 'A9!';
    await auth.changePassword(account.password, password);
    const status = await auth.accountStatus();
    check(!status.must_change && status.session_valid, 'A completed password change must grant a valid session.');
    await access.ready();
    await auth.signOut();
    check(await auth.currentUser() === undefined, 'Sign-out must clear the current identity.');
    await eventually(() => currentId === undefined, 'Authentication must notify subscribers after sign-out.');
    await rejects(() => auth.signIn(account.target, account.username, account.password));
    stop();
    stop();
    const stoppedAt = notifications;
    await auth.signIn(account.target, account.username, password);
    await auth.signOut();
    check(notifications === stoppedAt, 'Authentication cleanup must suppress later callbacks.');
  } finally {
    stop();
  }
}
