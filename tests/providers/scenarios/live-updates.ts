import type { Backend } from '../../../src/backend/contracts';
import type { ScenarioContext } from '../contracts';
import { change, check, eventually, submit } from './assertions';

function observeChanges(backend: Backend, sessionId: string, userId: string) {
  const state = {
    connected: false,
    changes: 0,
    callbacks: 0,
    payloadCount: 0,
  };
  const stop = backend.updates.subscribe({
    sessionId,
    userId,
    onChange: (...args) => {
      state.changes++;
      state.callbacks++;
      state.payloadCount += args.length;
    },
    onConnection: (connected) => {
      state.connected = connected;
      state.callbacks++;
    },
  });
  return { state, stop };
}

export async function liveUpdates(context: ScenarioContext): Promise<void> {
  const writer = await context.connect('volunteer');
  const readerBackend = await context.connect('contestant');
  const observerBackend = await context.connect('contestant');
  const staffBackend = await context.connect('specialist');
  const sessionId = context.sessionId;
  const userId = context.accounts.contestant.id;
  const reader = observeChanges(readerBackend, sessionId, userId);
  const sibling = observeChanges(readerBackend, sessionId, userId);
  const cancelled = observeChanges(readerBackend, sessionId, userId);
  cancelled.stop();
  cancelled.stop();
  const cancelledAt = cancelled.state.callbacks;
  const replacement = observeChanges(readerBackend, sessionId, userId);
  const observer = observeChanges(observerBackend, sessionId, userId);
  const staff = observeChanges(
    staffBackend,
    sessionId,
    context.accounts.specialist.id,
  );
  const teamSubscriptions = [reader, sibling, replacement, observer];
  try {
    await eventually(
      () => teamSubscriptions.every(({ state }) => state.connected) &&
        staff.state.connected,
      'Independent subscriptions and the immediate replacement must connect.',
    );
    const id = await submit(writer, sessionId, context.teamId);
    await eventually(
      () => teamSubscriptions.every(({ state }) => state.changes > 0) &&
        staff.state.changes > 0,
      'Every active subscription must receive the committed issue change.',
    );
    check(
      teamSubscriptions.every(({ state }) => state.payloadCount === 0),
      'Live callbacks must not expose issue data.',
    );
    check(
      (await readerBackend.workflows.snapshot(sessionId)).issues.some((item) =>
        item.id === id
      ),
      'The authorized read after notification must contain the issue.',
    );
    check(
      cancelled.state.callbacks === cancelledAt,
      'Immediate cancellation must suppress later change and connection callbacks.',
    );
    const teamsBeforeNote = teamSubscriptions.map(({ state }) => state.changes);
    const staffBeforeNote = staff.state.changes;
    await change(writer, sessionId, id, {
      type: 'message',
      issue_id: id,
      revision: 0,
      visibility: 'internal',
      text: `Private notification ${crypto.randomUUID()}`,
    });
    await eventually(
      () => staff.state.changes > staffBeforeNote,
      'Staff must receive internal-note invalidation.',
    );
    // Observe a bounded quiet interval after the positive staff delivery check.
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      teamSubscriptions.every(({ state }, index) =>
        state.changes === teamsBeforeNote[index]
      ),
      'An internal note must not notify any team subscriber.',
    );
    reader.stop();
    reader.stop();
    const stoppedAt = reader.state.callbacks;
    const remaining = [sibling, replacement, observer];
    const changesBefore = remaining.map(({ state }) => state.changes);
    await submit(writer, sessionId, context.teamId);
    await eventually(
      () => remaining.every(({ state }, index) =>
        state.changes > changesBefore[index]
      ),
      'Stopping one subscriber must preserve its siblings and the separate observer.',
    );
    check(
      reader.state.callbacks === stoppedAt,
      'Subscription cleanup must suppress later change and connection callbacks.',
    );
    check(
      cancelled.state.callbacks === cancelledAt,
      'The immediately cancelled subscription must remain inactive after resubscription.',
    );
  } finally {
    for (const subscription of teamSubscriptions) subscription.stop();
    cancelled.stop();
    staff.stop();
  }
}

export async function reconnectRecovery(context: ScenarioContext): Promise<void> {
  const writer = await context.connect('volunteer');
  const reader = await context.connect('contestant');
  const subscription = observeChanges(reader, context.sessionId, context.accounts.contestant.id);
  try {
    await eventually(() => subscription.state.connected, 'The subscription must connect before the transport interruption.');
    await context.setLiveUpdatesPaused(reader, true);
    await eventually(() => !subscription.state.connected, 'Closing the real socket must report a disconnected subscription.');
    const missed = await submit(writer, context.sessionId, context.teamId);
    check((await writer.workflows.snapshot(context.sessionId)).issues.some((issue) => issue.id === missed),
      'The issue must commit while the reader transport is unavailable.');
    await context.setLiveUpdatesPaused(reader, false);
    await eventually(() => subscription.state.connected, 'The existing subscription must reconnect without replacement.');
    const recovered = await reader.workflows.snapshot(context.sessionId);
    check(recovered.issues.some((issue) => issue.id === missed), 'An authorized refresh after reconnect must recover a missed commit.');
    const before = subscription.state.changes;
    const following = await submit(writer, context.sessionId, context.teamId);
    await eventually(() => subscription.state.changes > before, 'The reconnected subscription must deliver subsequent invalidation.');
    check((await reader.workflows.snapshot(context.sessionId)).issues.some((issue) => issue.id === following),
      'The authorized refresh must include changes delivered after reconnect.');
    check(subscription.state.payloadCount === 0, 'Reconnection must preserve invalidation without issue payloads.');
  } finally {
    subscription.stop();
    await context.setLiveUpdatesPaused(reader, false);
  }
}
