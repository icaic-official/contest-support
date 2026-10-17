import { WorkflowRejectedError } from '../../../src/backend/errors';
import type { ScenarioContext } from '../contracts';
import { change, check, issue, rejects, submit } from './assertions';

export async function lifecycle(context: ScenarioContext): Promise<void> {
  const contestant = await context.connect('contestant');
  const volunteer = await context.connect('volunteer');
  const specialist = await context.connect('specialist');
  const jury = await context.connect('jury');
  const session = context.sessionId;
  const id = await submit(contestant, session);
  const created = await issue(contestant, session, id);
  check(
    created.owner === null && created.first_assigned_at === null &&
      created.status === 'open',
    'Submission must start an unassigned issue.',
  );
  check(
    Number.isFinite(Date.parse(created.created_at)),
    'Submission must persist its start time.',
  );
  const base = { issue_id: id, revision: 0 };
  await change(volunteer, session, id, { ...base, type: 'claim' });
  const claimed = await issue(volunteer, session, id);
  check(
    claimed.owner === context.accounts.volunteer.id &&
      claimed.first_assigned_at !== null,
    'Claim must record the owner and first assignment.',
  );
  await rejects(() =>
    change(specialist, session, id, {
      ...base,
      type: 'resolve',
      summary: 'A non-owner cannot resolve.',
    })
  );
  await change(volunteer, session, id, { ...base, type: 'escalate' });
  const escalated = await issue(specialist, session, id);
  check(
    escalated.owner === claimed.owner && escalated.status === 'escalated',
    'Escalation must retain the current owner.',
  );
  const admin = await context.connect('admin');
  await admin.admin.saveMember(session, context.accounts.volunteer.id, {
    teamId: null,
    roles: ['volunteer', 'specialist'],
    isAdmin: false,
  });
  try {
    await rejects(() =>
      change(volunteer, session, id, { ...base, type: 'accept' })
    );
  } finally {
    await admin.admin.saveMember(session, context.accounts.volunteer.id, {
      teamId: null,
      roles: ['volunteer'],
      isAdmin: false,
    });
  }
  await change(specialist, session, id, { ...base, type: 'accept' });
  check(
    (await issue(specialist, session, id)).owner ===
      context.accounts.specialist.id,
    'Acceptance must transfer ownership.',
  );
  await change(specialist, session, id, {
    ...base,
    type: 'resolve',
    summary: 'Replaced the fixture cable.',
  });
  const resolved = await issue(contestant, session, id);
  check(
    resolved.status === 'resolved' && resolved.resolved_at !== null,
    'Resolution must persist the stop time.',
  );
  await rejects(() =>
    change(contestant, session, id, {
      ...base,
      type: 'message',
      text: 'A resolved issue rejects replies.',
      visibility: 'public',
    })
  );
  await change(jury, session, id, {
    ...base,
    type: 'award',
    minutes: 2,
    explanation: 'Fixture service interruption.',
  });
  await change(volunteer, session, id, { ...base, type: 'apply' });
  const beforeReopen = await contestant.workflows.snapshot(session);
  const award = beforeReopen.awards.find((item) => item.issue_id === id);
  check(
    award?.applied_at !== null && award?.minutes === 2,
    'The award and external application must persist separately.',
  );
  await change(contestant, session, id, {
    ...base,
    type: 'reopen',
    reason: 'The fixture cable failed again.',
  });
  const reopened = await issue(contestant, session, id);
  check(
    reopened.owner === resolved.owner && reopened.resolved_at === null,
    'Reopening must retain the owner and resume the timer.',
  );
  check(
    reopened.created_at === created.created_at &&
      reopened.first_assigned_at === claimed.first_assigned_at,
    'Reopening must preserve the start and first-assignment times.',
  );
  await change(specialist, session, id, {
    ...base,
    type: 'resolve',
    summary: 'Replaced the fixture port.',
  });
  const final = await (await context.connect('contestant')).workflows.snapshot(
    session,
  );
  const resolutions = final.resolutions.filter((item) => item.issue_id === id);
  check(
    resolutions.length === 2 &&
      resolutions.some((item) => item.reopened_at !== null),
    'A fresh client must retain both resolutions and the reopened interval.',
  );
  check(
    final.awards.some((item) =>
      item.id === award.id && item.applied_at === award.applied_at
    ),
    'Reopening must preserve the award and external application status.',
  );
  const history = final.history.filter((item) => item.issue_id === id);
  check(
    history.length === 9,
    'The lifecycle must persist each of its nine successful actions once.',
  );
  const expectedActors = [
    context.accounts.contestant.id,
    context.accounts.volunteer.id,
    context.accounts.volunteer.id,
    context.accounts.specialist.id,
    context.accounts.specialist.id,
    context.accounts.jury.id,
    context.accounts.volunteer.id,
    context.accounts.contestant.id,
    context.accounts.specialist.id,
  ];
  check(
    history.every((item, index) =>
      item.actor === expectedActors[index] && item.actor_name.length > 0
    ),
    'Activity must identify the authenticated actor for every action.',
  );
}

export async function accessSeparation(
  context: ScenarioContext,
): Promise<void> {
  const contestant = await context.connect('contestant');
  const volunteer = await context.connect('volunteer');
  const other = await context.connect('otherTeam');
  const isolated = await context.connect('isolated');
  const id = await submit(contestant, context.sessionId);
  const base = { issue_id: id, revision: 0, type: 'message' as const };
  const privateText = `Staff note ${crypto.randomUUID()}`;
  const publicText = `Team reply ${crypto.randomUUID()}`;
  const publicBefore = await issue(contestant, context.sessionId, id);
  await change(volunteer, context.sessionId, id, {
    ...base,
    visibility: 'internal',
    text: privateText,
  });
  check(
    (await issue(contestant, context.sessionId, id)).revision ===
      publicBefore.revision,
    'An internal note must not advance the public issue revision.',
  );
  await change(volunteer, context.sessionId, id, {
    ...base,
    visibility: 'public',
    text: publicText,
  });
  const staff = await volunteer.workflows.snapshot(context.sessionId);
  const team = await contestant.workflows.snapshot(context.sessionId);
  check(
    staff.history.some((item) => item.text === privateText),
    'Staff must receive internal notes.',
  );
  check(
    team.history.some((item) => item.text === publicText),
    'The reporting team must receive public replies.',
  );
  check(
    team.history.every((item) =>
      item.visibility === 'public' && item.text !== privateText
    ),
    'Team snapshots must omit all internal notes.',
  );
  check(
    !(await other.workflows.snapshot(context.sessionId)).issues.some((item) =>
      item.id === id
    ),
    'Another team must not see the issue.',
  );
  check(
    (await isolated.workflows.snapshot(context.sessionId)).issues.length === 0,
    'A different session member must not see the issue.',
  );
  const spoofed = await isolated.workflows.sessions(context.accounts.admin.id);
  check(
    !spoofed.some((item) => item.id === context.sessionId),
    'Supplying another account ID must not grant its sessions.',
  );
  await rejects(async () =>
    other.workflows.execute(context.sessionId, crypto.randomUUID(), {
      ...base,
      revision: (await issue(volunteer, context.sessionId, id)).revision,
      visibility: 'public',
      text: 'Unauthorized reply.',
    })
  );
  await rejects(() => contestant.admin.setIntake(context.sessionId, false));
}

export async function idempotency(context: ScenarioContext): Promise<void> {
  const backend = await context.connect('contestant');
  const command = {
    type: 'submit' as const,
    category: 'Other',
    description: `Retry ${crypto.randomUUID()}`,
  };
  const request = crypto.randomUUID();
  context.discardNextWorkflowResponse(backend);
  const failure = await rejects(() =>
    backend.workflows.execute(context.sessionId, request, command)
  );
  check(
    !(failure instanceof WorkflowRejectedError),
    'A discarded success response must leave the write outcome uncertain.',
  );
  const id = await backend.workflows.execute(
    context.sessionId,
    request,
    command,
  );
  check(
    await backend.workflows.execute(context.sessionId, request, command) === id,
    'Reusing a request ID must return the original issue.',
  );
  const snapshot = await backend.workflows.snapshot(context.sessionId);
  check(
    snapshot.issues.filter((item) => item.description === command.description)
      .length === 1,
    'Retry must not create duplicate issues.',
  );
  const historyBefore =
    snapshot.history.filter((item) => item.issue_id === id).length;
  const conflict = await rejects(() =>
    backend.workflows.execute(context.sessionId, request, {
      ...command,
      description: 'A request ID cannot identify a different command.',
    })
  );
  check(
    conflict instanceof WorkflowRejectedError,
    'Conflicting reuse of a request ID must be rejected.',
  );
  check(
    (await backend.workflows.snapshot(context.sessionId)).history.filter((
      item,
    ) => item.issue_id === id).length === historyBefore,
    'A rejected request-ID conflict must not append history.',
  );
  const secondClient = await context.connect('contestant');
  const concurrentRequest = crypto.randomUUID();
  const concurrentCommand = {
    ...command,
    description: `Concurrent retry ${crypto.randomUUID()}`,
  };
  const repeated = await Promise.all([
    backend.workflows.execute(
      context.sessionId,
      concurrentRequest,
      concurrentCommand,
    ),
    secondClient.workflows.execute(
      context.sessionId,
      concurrentRequest,
      concurrentCommand,
    ),
  ]);
  check(
    repeated[0] === repeated[1],
    'Concurrent copies of one request must return one issue.',
  );
  check(
    (await backend.workflows.snapshot(context.sessionId)).issues.filter((
      item,
    ) => item.description === concurrentCommand.description).length === 1,
    'Concurrent retries must commit one issue.',
  );
  const volunteer = await context.connect('volunteer');
  const specialist = await context.connect('specialist');
  const current = await issue(backend, context.sessionId, id);
  const claim = {
    type: 'claim' as const,
    issue_id: id,
    revision: current.revision,
  };
  const results = await Promise.allSettled([
    volunteer.workflows.execute(context.sessionId, crypto.randomUUID(), claim),
    specialist.workflows.execute(context.sessionId, crypto.randomUUID(), claim),
  ]);
  check(
    results.filter((result) => result.status === 'fulfilled').length === 1,
    'Concurrent claims at one revision must have one winner.',
  );
  const rejected = results.find((result) => result.status === 'rejected');
  check(
    rejected?.status === 'rejected' &&
      rejected.reason instanceof WorkflowRejectedError,
    'A stale command must return a definitive rejection.',
  );
  const after = await issue(volunteer, context.sessionId, id);
  check(
    after.revision === current.revision + 1 && after.owner !== null,
    'A losing claim must not alter the committed revision.',
  );
}
