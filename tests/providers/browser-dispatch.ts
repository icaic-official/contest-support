import {
  ImageRequestError,
  WorkflowRejectedError,
} from '../../src/backend/errors';
import type { Unsubscribe } from '../../src/backend/contracts';
import type {
  BrowserEvent,
  BrowserProvider,
  BrowserProviderModule,
  Request,
  Response,
} from './browser-protocol';

declare global {
  interface Window {
    minskyProviderEvent(event: BrowserEvent): Promise<void>;
  }
}

let provider: BrowserProvider | undefined;
interface Subscription {
  stop: Unsubscribe;
  active: boolean;
}
const subscriptions = new Map<string, Subscription>();
const pendingEvents = new Set<Promise<void>>();
let eventFailure: unknown;

export async function initialize(
  module: string,
  configuration: unknown,
): Promise<void> {
  if (provider) {
    throw new Error('A browser context must contain only one provider client.');
  }
  const implementation = await import(
    /* @vite-ignore */ module
  ) as BrowserProviderModule;
  provider = await implementation.createBrowserProvider(configuration);
}

function emit(event: BrowserEvent): void {
  const delivery = window.minskyProviderEvent(event);
  pendingEvents.add(delivery);
  void delivery.catch((error: unknown) => {
    eventFailure ??= error;
  })
    .finally(() => pendingEvents.delete(delivery));
}

function emitFrom(subscription: Subscription, event: BrowserEvent): void {
  if (!subscription.active) {
    eventFailure ??= new Error(
      'The provider invoked a callback after its unsubscribe returned.',
    );
    return;
  }
  emit(event);
}

function stopSubscription(id: string): void {
  const subscription = subscriptions.get(id);
  if (!subscription) return;
  subscription.stop();
  subscription.active = false;
  subscriptions.delete(id);
}

async function execute(request: Request): Promise<unknown> {
  if (!provider) {
    throw new Error('Initialize the browser provider before a contract call.');
  }
  const backend = provider.backend;
  switch (request.type) {
    case 'currentUser':
      return backend.auth.currentUser();
    case 'signIn':
      return backend.auth.signIn(request.username, request.password);
    case 'signOut':
      return backend.auth.signOut();
    case 'accountStatus':
      return backend.auth.accountStatus();
    case 'changePassword':
      return backend.auth.changePassword(
        request.currentPassword,
        request.newPassword,
      );
    case 'authSubscribe': {
      const subscription: Subscription = { active: true, stop: () => {} };
      subscription.stop = backend.auth.subscribe((user) =>
        emitFrom(subscription, { type: 'auth', id: request.id, user })
      );
      subscriptions.set(request.id, subscription);
      return;
    }
    case 'stop':
      stopSubscription(request.id);
      return;
    case 'sessions':
      return backend.workflows.sessions(request.userId);
    case 'snapshot':
      return backend.workflows.snapshot(request.sessionId);
    case 'execute':
      return backend.workflows.execute(
        request.sessionId,
        request.requestId,
        request.command,
      );
    case 'account':
      return backend.admin.account(request.sessionId, request.command);
    case 'setIntake':
      return backend.admin.setIntake(request.sessionId, request.open);
    case 'setImageLimits':
      return backend.admin.setImageLimits(request.sessionId, request.limits);
    case 'saveMember':
      return backend.admin.saveMember(
        request.sessionId,
        request.userId,
        request.member,
      );
    case 'removeMember':
      return backend.admin.removeMember(request.sessionId, request.userId);
    case 'beginImage':
      return backend.images.begin(request.input);
    case 'uploadImage':
      return backend.images.upload(
        request.path,
        new Blob([Uint8Array.from(request.bytes)], {
          type: request.contentType,
        }),
        request.contentType,
        (loaded) => emit({ type: 'progress', id: request.id, loaded }),
      );
    case 'finishImage':
      return backend.images.finish(request.sessionId, request.attachmentId);
    case 'removeImage':
      return backend.images.remove(request.sessionId, request.attachmentId);
    case 'abandonImage':
      return backend.images.abandon(request.sessionId, request.attachmentId);
    case 'downloadImage': {
      const blob = await backend.images.download(request.path);
      return {
        bytes: [...new Uint8Array(await blob.arrayBuffer())],
        contentType: blob.type,
      };
    }
    case 'updatesSubscribe': {
      const subscription: Subscription = { active: true, stop: () => {} };
      subscription.stop = backend.updates.subscribe({
        sessionId: request.sessionId,
        userId: request.userId,
        onChange: (...args) =>
          emitFrom(subscription, {
            type: 'change',
            id: request.id,
            arguments: args,
          }),
        onConnection: (connected) =>
          emitFrom(subscription, {
            type: 'connection',
            id: request.id,
            connected,
          }),
      });
      subscriptions.set(request.id, subscription);
      return;
    }
    case 'discardNextWorkflowResponse':
      return provider.discardNextWorkflowResponse();
    case 'close':
      for (const id of subscriptions.keys()) stopSubscription(id);
      return provider.close();
  }
}

export async function dispatch(request: Request): Promise<Response> {
  try {
    const value = await execute(request);
    await Promise.all([...pendingEvents]);
    if (eventFailure) throw eventFailure;
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'The provider threw an unknown failure.';
    if (error instanceof WorkflowRejectedError) {
      return { ok: false, error: { kind: 'rejected', message } };
    }
    if (error instanceof ImageRequestError) {
      return {
        ok: false,
        error: {
          kind: 'image',
          message,
          validation: error.validation,
          restart: error.restart,
          incomplete: error.incomplete,
        },
      };
    }
    return { ok: false, error: { kind: 'unknown', message } };
  }
}
