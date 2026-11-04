import * as z from 'zod';

const scalar = z.union([z.number(), z.boolean(), z.string()]);
const requirement = z.union([z.boolean(), z.object({ parameter: z.string(), equals: scalar })]);
const parameter = z.object({
  id: z.string(), type: z.enum(['real', 'integer', 'flag', 'string']).default('real'),
  label: z.string().optional(), unit: z.string().optional(), default: scalar.optional(),
  required: requirement, choices: z.array(z.string()).nonempty().optional(),
});
const model = z.object({
  id: z.string(), label: z.string(), family: z.string(), collection: z.enum(['buses', 'devices']),
  ends: z.tuple([z.string(), z.string()]).optional(),
  params: z.array(parameter), init: z.array(parameter).default([]),
  preset: z.object({ params: z.record(z.string(), scalar).optional(), init: z.record(z.string(), scalar).optional() }).optional(),
  ports: z.array(z.object({ name: z.string(), label: z.string().optional(), kind: z.enum(['bus', 'signal']),
    direction: z.enum(['in', 'out', 'both']), required: requirement,
    path: z.tuple([z.enum(['ports', 'ports_in', 'ports_out']), z.string()]).optional(),
  })),
  outputs: z.array(z.object({ id: z.string(), unit: z.string().optional() })).default([]),
});
export const manifestSchema = z.object({
  models: z.array(model),
}).strict().superRefine((manifest, context) => {
  const unique = (names: string[], path: (string | number)[]) => {
    if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', path, message: 'Names must be unique.' });
  };
  unique(manifest.models.map(model => model.id), ['models']);
  manifest.models.forEach((model, index) => {
    for (const group of ['params', 'init', 'ports', 'outputs'] as const)
      unique(model[group].map(field => 'id' in field ? field.id : field.name), ['models', index, group]);
    unique(model.ports.map(port => JSON.stringify(port.path ?? ['ports', port.name])), ['models', index, 'ports']);
    for (const end of model.ends ?? []) if (!model.ports.some(port => port.name === end && port.kind === 'bus'))
      context.addIssue({ code: 'custom', path: ['models', index, 'ends'], message: 'An endpoint must name a bus port.' });
    for (const field of [...model.params, ...model.init, ...model.ports]) {
      const condition = field.required;
      if (typeof condition === 'object' && !model.params.some(param => param.id === condition.parameter))
        context.addIssue({ code: 'custom', path: ['models', index], message: 'A requirement must name a parameter.' });
    }
  });
});
export type Model = z.infer<typeof model>;
export type Requirement = z.infer<typeof requirement>;
export function required(value: Requirement, params: Readonly<Record<string, unknown>>, model: Model): boolean {
  return typeof value === 'boolean' ? value
    : (params[value.parameter] ?? model.params.find(param => param.id === value.parameter)?.default) === value.equals;
}
