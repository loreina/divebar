// schema for the local mirror of a figma file: one entry per published
// component set, with its variant axes and child variant nodes

import { z } from 'zod';

// a single variant inside a component set
export const MirrorChildSchema = z.object({
  name: z.string(),
  nodeId: z.string(),
});

// a published component set with its variant axes and children
export const MirrorEntrySchema = z.object({
  name: z.string(),
  nodeId: z.string(),
  componentKey: z.string().nullable(),
  variantProperties: z.record(z.string(), z.array(z.string())),
  children: z.array(MirrorChildSchema),
});

// the mirror file is just an array of component-set entries
export const MirrorSchema = z.array(MirrorEntrySchema);

export type MirrorChild = z.infer<typeof MirrorChildSchema>;
export type MirrorEntry = z.infer<typeof MirrorEntrySchema>;
export type Mirror = z.infer<typeof MirrorSchema>;
