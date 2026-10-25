import { config } from "zod";

// The security policy forbids eval. Zod probes for eval with `new Function` when it
// builds the first schema, and the browser reports that blocked call as a violation.
// Import this module before any module that builds a schema.
config({ jitless: true });
