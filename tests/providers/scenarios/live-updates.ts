import type { ScenarioContext } from '../contracts';
import { change, check, eventually, submit } from './assertions';

export async function liveUpdates(context: ScenarioContext): Promise<void> {
  const writer = await context.connect('volunteer');
  const reader = await context.connect('contestant');
  const observer = await context.connect('contestant');
  const staff = await context.connect('specialist');
  let staffConnected = false;
  let staffChanges = 0;
  let connected = false;
  let observed = false;
  let changes = 0;
  let observerChanges = 0;
  let payloadCount = 0;
  const stop = reader.updates.subscribe({
    sessionId: context.sessionId,
    userId: context.accounts.contestant.id,
    onChange: (...args) => {
      changes++;
      payloadCount += args.length;
    },
    onConnection: (value) => {
      connected = value;
    },
  });
  const stopObserver = observer.updates.subscribe({
    sessionId: context.sessionId,
    userId: context.accounts.contestant.id,
    onChange: () => {
      observerChanges++;
    },
    onConnection: (value) => {
      observed = value;
    },
  });
  const stopStaff = staff.updates.subscribe({
    sessionId: context.sessionId,
    userId: context.accounts.specialist.id,
    onChange: () => {
      staffChanges++;
    },
    onConnection: (value) => {
      staffConnected = value;
    },
  });
  try {
    await eventually(
      () => connected && observed && staffConnected,
      'Live connections must report their subscribed state.',
    );
    const id = await submit(writer, context.sessionId, context.teamId);
    await eventually(
      () => changes > 0 && observerChanges > 0 && staffChanges > 0,
      'A committed issue must invalidate the team snapshot.',
    );
    check(payloadCount === 0, 'Live callbacks must not expose issue data.');
    check(
      (await reader.workflows.snapshot(context.sessionId)).issues.some((item) =>
        item.id === id
      ),
      'The authorized read after notification must contain the issue.',
    );
    const teamBeforeNote = changes;
    const staffBeforeNote = staffChanges;
    await change(writer, context.sessionId, id, {
      type: 'message',
      issue_id: id,
      revision: 0,
      visibility: 'internal',
      text: `Private notification ${crypto.randomUUID()}`,
    });
    await eventually(
      () => staffChanges > staffBeforeNote,
      'Staff must receive internal-note invalidation.',
    );
    // Observe a bounded quiet interval after the positive staff delivery check.
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      changes === teamBeforeNote,
      'An internal note must not notify the team subscriber.',
    );
    stop();
    stop();
    const stoppedAt = changes;
    const observerAt = observerChanges;
    await submit(writer, context.sessionId, context.teamId);
    await eventually(
      () => observerChanges > observerAt,
      'An active observer must receive the next change.',
    );
    check(
      changes === stoppedAt,
      'Subscription cleanup must suppress subsequent callbacks.',
    );
  } finally {
    stop();
    stopObserver();
    stopStaff();
  }
}
