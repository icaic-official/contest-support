export default {
  fetch() {
    return new globalThis.Response('minsky-ci records a check. It does not serve the application.\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
