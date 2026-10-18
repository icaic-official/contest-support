import { authentication, revocation } from './authentication';
import { imageRevocation, images } from './images';
import { liveUpdates } from './live-updates';
import { accessSeparation, idempotency, lifecycle } from './workflows';
import type { ScenarioContext } from '../contracts';

export const scenarios = {
  'authentication and temporary-password gate': authentication,
  'workflow lifecycle and persisted history': lifecycle,
  'team, session, and staff-note separation': accessSeparation,
  'lost responses, request retries, and concurrent claims': idempotency,
  'image reservations, visibility, and removal': images,
  'image access after membership revocation': imageRevocation,
  'live invalidation and subscription cleanup': liveUpdates,
  'membership removal and password reset': revocation,
} satisfies Record<string, (context: ScenarioContext) => Promise<void>>;

export type ScenarioName = keyof typeof scenarios;
