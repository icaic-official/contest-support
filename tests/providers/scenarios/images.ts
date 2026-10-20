import { ImageRequestError } from '../../../src/backend/errors';
import type { Backend } from '../../../src/backend/contracts';
import type { ScenarioContext } from '../contracts';
import { check, rejects, submit } from './assertions';

function png(): Blob {
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (character) => character.charCodeAt(0),
  );
  return new Blob([bytes], { type: 'image/png' });
}

async function sameBytes(actual: Blob, expected: Blob): Promise<boolean> {
  const left = new Uint8Array(await actual.arrayBuffer());
  const right = new Uint8Array(await expected.arrayBuffer());
  return left.length === right.length &&
    left.every((byte, index) => byte === right[index]);
}

async function upload(
  backend: Backend,
  path: string,
  body: Blob,
): Promise<void> {
  let lastProgress = 0;
  await backend.images.upload(path, body, body.type, (loaded) => {
    check(
      loaded >= lastProgress && loaded <= body.size,
      'Upload progress must describe bytes sent.',
    );
    lastProgress = loaded;
  });
  check(
    lastProgress === body.size,
    'A completed upload must report the complete body size.',
  );
}

export async function images(context: ScenarioContext): Promise<void> {
  const staff = await context.connect('volunteer');
  const specialist = await context.connect('specialist');
  const contestant = await context.connect('contestant');
  const other = await context.connect('otherTeam');
  const id = await submit(staff, context.sessionId, context.teamId);
  const body = png();
  const paths = [];
  for (const visibility of ['public', 'internal'] as const) {
    const input = {
      sessionId: context.sessionId,
      issueId: id,
      requestId: crypto.randomUUID(),
      visibility,
      name: `${visibility}.png`,
      bytes: body.size,
    };
    const started = await staff.images.begin(input);
    const repeated = await staff.images.begin(input);
    check(
      repeated.id === started.id &&
        repeated.original_path === started.original_path,
      'An image reservation retry must retain its identity and paths.',
    );
    const unfinished = await rejects(() =>
      staff.images.finish(context.sessionId, started.id)
    );
    check(
      unfinished instanceof ImageRequestError && unfinished.incomplete,
      'Completion before upload must report an incomplete image.',
    );
    await upload(staff, started.original_path, body);
    await upload(staff, started.thumbnail_path, body);
    await staff.images.finish(context.sessionId, started.id);
    await staff.images.finish(context.sessionId, started.id);
    check(
      await sameBytes(await staff.images.download(started.original_path), body),
      'The uploader must download the original bytes.',
    );
    paths.push({ ...started, visibility });
  }
  const staffView = await staff.workflows.snapshot(context.sessionId);
  check(
    staffView.attachments.filter((item) => item.issue_id === id).length === 2,
    'Repeat completion must not publish duplicate images.',
  );
  const teamView = await contestant.workflows.snapshot(context.sessionId);
  const teamImages = teamView.attachments.filter((item) =>
    item.issue_id === id
  );
  check(
    teamImages.length === 1 && teamImages[0].visibility === 'public',
    'The team must receive only team-visible image metadata.',
  );
  for (const image of paths) {
    await rejects(() => other.images.download(image.original_path));
    await rejects(() => specialist.images.remove(context.sessionId, image.id));
    if (image.visibility === 'internal') {
      await rejects(() => contestant.images.download(image.original_path));
    } else {check(
        await sameBytes(
          await contestant.images.download(image.original_path),
          body,
        ),
        'The reporting team must download team-visible images.',
      );}
    await staff.images.remove(context.sessionId, image.id);
    await rejects(() => staff.images.download(image.original_path));
  }
  check(
    !(await staff.workflows.snapshot(context.sessionId)).attachments.some((
      item,
    ) => item.issue_id === id),
    'Removed images must leave the authorized snapshot.',
  );
  await rejects(() =>
    contestant.images.begin({
      sessionId: context.sessionId,
      issueId: id,
      requestId: crypto.randomUUID(),
      visibility: 'public',
      name: 'unauthorized.png',
      bytes: body.size,
    })
  );
  const abandoned = await staff.images.begin({
    sessionId: context.sessionId,
    issueId: id,
    requestId: crypto.randomUUID(),
    visibility: 'internal',
    name: 'abandoned.png',
    bytes: body.size,
  });
  await upload(staff, abandoned.original_path, body);
  await staff.images.abandon(context.sessionId, abandoned.id);
  await rejects(() => staff.images.download(abandoned.original_path));
}

export async function imageRevocation(context: ScenarioContext): Promise<void> {
  const admin = await context.connect('admin');
  const staff = await context.connect('volunteer');
  const id = await submit(staff, context.sessionId, context.teamId);
  const body = png();
  const ready = await staff.images.begin({
    sessionId: context.sessionId,
    issueId: id,
    requestId: crypto.randomUUID(),
    visibility: 'internal',
    name: 'ready-before-revocation.png',
    bytes: body.size,
  });
  await upload(staff, ready.original_path, body);
  await upload(staff, ready.thumbnail_path, body);
  await staff.images.finish(context.sessionId, ready.id);
  await staff.images.finish(context.sessionId, ready.id);
  check(
    await sameBytes(await staff.images.download(ready.original_path), body),
    'The member must have image access before revocation.',
  );
  const pending = await staff.images.begin({
    sessionId: context.sessionId,
    issueId: id,
    requestId: crypto.randomUUID(),
    visibility: 'internal',
    name: 'pending-at-revocation.png',
    bytes: body.size,
  });
  await upload(staff, pending.original_path, body);
  await admin.admin.removeMember(
    context.sessionId,
    context.accounts.volunteer.id,
  );
  try {
    check(
      (await staff.workflows.snapshot(context.sessionId)).membership === null,
      'Membership removal must take effect before image checks.',
    );
    await rejects(() => staff.images.download(ready.original_path));
    await rejects(() =>
      staff.images.upload(pending.thumbnail_path, body, body.type, () => {})
    );
    await rejects(() => staff.images.finish(context.sessionId, ready.id));
  } finally {
    await admin.admin.saveMember(
      context.sessionId,
      context.accounts.volunteer.id,
      {
        teamId: null,
        roles: ['volunteer'],
        isAdmin: false,
      },
    );
  }
  check(
    await sameBytes(await staff.images.download(ready.original_path), body),
    'Restored membership must restore image access.',
  );
  await staff.images.remove(context.sessionId, ready.id);
  await staff.images.abandon(context.sessionId, pending.id);
}

export async function imageLimits(context: ScenarioContext): Promise<void> {
  const admin = await context.connect('admin');
  const staff = await context.connect('volunteer');
  const session = (await admin.workflows.snapshot(context.sessionId)).session;
  check(session, 'The image-limit fixture session must exist.');
  const original = { fileMegabytes: session.max_image_bytes / 1_048_576,
    count: session.max_images_per_issue, totalMegabytes: session.max_image_bytes_per_issue / 1_048_576 };
  const issueId = await submit(staff, context.sessionId, context.teamId);
  const body = png();
  const begin = (bytes: number) => staff.images.begin({ sessionId: context.sessionId, issueId,
    requestId: crypto.randomUUID(), visibility: 'internal', name: 'limits.png', bytes });
  const validation = async (operation: () => Promise<unknown>) => {
    const error = await rejects(operation);
    check(error instanceof ImageRequestError && error.validation, 'An image-limit rejection must identify invalid input or limits.');
  };
  try {
    await rejects(() => staff.admin.setImageLimits(context.sessionId, { fileMegabytes: 1, count: 1, totalMegabytes: 1 }));
    for (const limits of [{ fileMegabytes: 0, count: 1, totalMegabytes: 1 },
      { fileMegabytes: 1, count: 0, totalMegabytes: 1 }, { fileMegabytes: 2, count: 1, totalMegabytes: 1 }]) {
      await rejects(() => admin.admin.setImageLimits(context.sessionId, limits));
    }
    await admin.admin.setImageLimits(context.sessionId, { fileMegabytes: 1, count: 1, totalMegabytes: 1 });
    const configured = (await staff.workflows.snapshot(context.sessionId)).session;
    check(configured?.max_image_bytes === 1_048_576 && configured.max_images_per_issue === 1 && configured.max_image_bytes_per_issue === 1_048_576,
      'The authorized snapshot must retain all configured image limits.');
    await validation(() => begin(0));
    await validation(() => begin(1_048_577));
    const reserved = await begin(1_048_576);
    await validation(() => begin(body.size));
    await staff.images.abandon(context.sessionId, reserved.id);
    const ready = await begin(1_048_576);
    await upload(staff, ready.original_path, body);
    await upload(staff, ready.thumbnail_path, body);
    await staff.images.finish(context.sessionId, ready.id);
    await validation(() => begin(body.size));
    await admin.admin.setImageLimits(context.sessionId, { fileMegabytes: 2, count: 3, totalMegabytes: 2 });
    const remaining = await begin(2_097_152 - body.size);
    await validation(() => begin(1));
    await staff.images.abandon(context.sessionId, remaining.id);
    await validation(() => begin(2_097_153 - body.size));
    await staff.images.remove(context.sessionId, ready.id);
    const reclaimed = await begin(2_097_152);
    await staff.images.abandon(context.sessionId, reclaimed.id);

    const large = new Blob([await body.arrayBuffer(), new Uint8Array(1_048_577 - body.size)], { type: body.type });
    const changing = await begin(large.size);
    await upload(staff, changing.original_path, large);
    await upload(staff, changing.thumbnail_path, body);
    await admin.admin.setImageLimits(context.sessionId, { fileMegabytes: 1, count: 3, totalMegabytes: 1 });
    await validation(() => staff.images.finish(context.sessionId, changing.id));
    check(!(await staff.workflows.snapshot(context.sessionId)).attachments.some((image) => image.id === changing.id),
      'A lowered limit must prevent publication of an uploaded image that is now too large.');
    await staff.images.abandon(context.sessionId, changing.id);
  } finally {
    await admin.admin.setImageLimits(context.sessionId, original);
  }
}
