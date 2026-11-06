import { config } from "zod";

// The security policy forbids eval. Zod probes for eval with `new Function` when it
// builds the first schema, and the browser reports that blocked call as a violation.
// Every module that builds a schema imports this module before it imports zod. The
// build splits the app into chunks, so the import order of main.tsx alone does not
// decide which chunk runs first.
config({ jitless: true });
