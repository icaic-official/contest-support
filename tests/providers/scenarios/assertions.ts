import type { Backend, ManageCommand, ManageReceipt } from '../../../src/backend/contracts';
import type { Role } from '../../../src/connected/model';
import type { Command, Issue } from '../../../src/connected/model';

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function rejects(
  operation: () => Promise<unknown>,
): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('The adapter threw a value that is not an Error.', {
      cause: error,
    });
  }
  throw new Error('The operation succeeded when rejection was required.');
}

export async function issue(
  backend: Backend,
  sessionId: string,
  issueId: string,
): Promise<Issue> {
  const found = (await backend.workflows.snapshot(sessionId)).issues.find((
    item,
  ) => item.id === issueId);
  check(found, 'The authorized snapshot must contain the issue.');
  return found;
}

export async function submit(
  backend: Backend,
  sessionId: string,
  teamId?: string,
): Promise<string> {
  return backend.workflows.execute(sessionId, crypto.randomUUID(), {
    type: 'submit',
    category: 'Other',
    description: `Provider contract ${crypto.randomUUID()}`,
    ...(teamId ? { team_id: teamId } : {}),
  });
}

export async function change(
  backend: Backend,
  sessionId: string,
  issueId: string,
  command: Exclude<Command, { type: 'submit' }>,
): Promise<string> {
  const current = await issue(backend, sessionId, issueId);
  return backend.workflows.execute(sessionId, crypto.randomUUID(), {
    ...command,
    issue_id: issueId,
    revision: current.revision,
  });
}

/** Wait for a condition with a deadline, not a provider-specific delivery delay. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 15000;
  do {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(message);
}

/** Runs one management command with a fresh request ID. */
export function manage(backend: Backend, command: ManageCommand): Promise<ManageReceipt> {
  return backend.manage.execute(crypto.randomUUID(), command);
}

/** An event admin seats a person in a contest, or changes the seat. */
export function assignStaff(
  eventAdmin: Backend,
  contestId: string,
  accountId: string,
  roles: readonly Role[],
  admin = false,
): Promise<ManageReceipt> {
  return manage(eventAdmin, { type: 'assign_staff', contestId, accountId, roles, admin });
}

export function setImageLimits(
  backend: Backend,
  contestId: string,
  limits: { fileMegabytes: number; count: number; totalMegabytes: number },
): Promise<ManageReceipt> {
  return manage(backend, { type: 'set_image_limits', contestId, ...limits });
}

export function setIntake(backend: Backend, contestId: string, open: boolean): Promise<ManageReceipt> {
  return manage(backend, { type: 'set_intake', contestId, open });
}
