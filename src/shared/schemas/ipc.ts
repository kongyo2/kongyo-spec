import { z } from "zod";

export const CreateSpecInputSchema = z.object({ title: z.string().min(1).max(200) });
export type CreateSpecInput = z.infer<typeof CreateSpecInputSchema>;
export function parseCreateSpecInput(raw: unknown): CreateSpecInput {
  return CreateSpecInputSchema.parse(raw);
}

export const SpecIdInputSchema = z.object({ id: z.string().min(1).max(200) });
export type SpecIdInput = z.infer<typeof SpecIdInputSchema>;
export function parseSpecIdInput(raw: unknown): SpecIdInput {
  return SpecIdInputSchema.parse(raw);
}

export const SaveSpecInputSchema = z.object({ id: z.string().min(1).max(200), content: z.string() });
export type SaveSpecInput = z.infer<typeof SaveSpecInputSchema>;
export function parseSaveSpecInput(raw: unknown): SaveSpecInput {
  return SaveSpecInputSchema.parse(raw);
}

export const RenameSpecInputSchema = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(200) });
export type RenameSpecInput = z.infer<typeof RenameSpecInputSchema>;
export function parseRenameSpecInput(raw: unknown): RenameSpecInput {
  return RenameSpecInputSchema.parse(raw);
}

export const OpenExternalInputSchema = z.object({ url: z.string().min(1).max(2048) });
export type OpenExternalInput = z.infer<typeof OpenExternalInputSchema>;
export function parseOpenExternalInput(raw: unknown): OpenExternalInput {
  return OpenExternalInputSchema.parse(raw);
}

export const ImportSpecsInputSchema = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(256),
});
export type ImportSpecsInput = z.infer<typeof ImportSpecsInputSchema>;
export function parseImportSpecsInput(raw: unknown): ImportSpecsInput {
  return ImportSpecsInputSchema.parse(raw);
}
