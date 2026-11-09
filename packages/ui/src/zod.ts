import * as z from 'zod';

// Schemas choose at construction whether to compile with `new Function`; this page forbids eval, and zod's
// probe for it is reported as a violation. Without it, reading ACTIVSg10k takes the same 84–94 ms.
z.config({ jitless: true });
