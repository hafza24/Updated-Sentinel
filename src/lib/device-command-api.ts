import type { Session } from "@supabase/supabase-js";
import { z } from "zod";

const uuidSchema = z.string().uuid();

const emptyPayloadSchema = z.object({}).passthrough().default({});

const startStreamPayloadSchema = z
  .object({
    max_fps: z.number().int().min(1).max(5).default(2),
    jpeg_quality: z.number().int().min(35).max(85).default(60),
    session_note: z.string().trim().max(240).optional(),
  })
  .default({});

const stopStreamPayloadSchema = z
  .object({
    session_id: uuidSchema.optional(),
  })
  .default({});

const shutdownPayloadSchema = z
  .object({
    grace_seconds: z.number().int().min(0).max(300).default(30),
    reason: z.string().trim().max(240).optional(),
  })
  .default({});

const killProcessPayloadSchema = z.object({
  pid: z.number().int().positive(),
  process_name: z.string().trim().min(1).max(256).optional(),
});

const lockPayloadSchema = z
  .object({
    message: z.string().trim().max(240).optional(),
  })
  .default({});

export const supportedDeviceCommandTypes = [
  "force_sync",
  "restart_agent",
  "lock_device",
  "shutdown_device",
  "kill_process",
  "start_stream",
  "stop_stream",
] as const;

export type SupportedDeviceCommandType = (typeof supportedDeviceCommandTypes)[number];

export const issueDeviceCommandSchema = z.discriminatedUnion("commandType", [
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("force_sync"),
    payload: emptyPayloadSchema.optional(),
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("restart_agent"),
    payload: emptyPayloadSchema.optional(),
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("lock_device"),
    payload: lockPayloadSchema.optional(),
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("shutdown_device"),
    payload: shutdownPayloadSchema.optional(),
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("kill_process"),
    payload: killProcessPayloadSchema,
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("start_stream"),
    payload: startStreamPayloadSchema.optional(),
  }),
  z.object({
    deviceId: uuidSchema,
    commandType: z.literal("stop_stream"),
    payload: stopStreamPayloadSchema.optional(),
  }),
]);

export type IssueDeviceCommandInput = z.infer<typeof issueDeviceCommandSchema>;

interface IssueDeviceCommandResponse {
  ok: boolean;
  command_id?: string;
  screen_session_id?: string | null;
  error?: string;
}

export async function issueDeviceCommand(
  session: Session | null,
  input: IssueDeviceCommandInput,
): Promise<IssueDeviceCommandResponse> {
  if (!session?.access_token) {
    throw new Error("You must be signed in to issue device commands.");
  }

  const payload = issueDeviceCommandSchema.parse(input);

  const response = await fetch("/api/public/device-commands", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as IssueDeviceCommandResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}
