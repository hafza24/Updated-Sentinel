import { createFileRoute } from "@tanstack/react-router";
import { isSupabaseAdminConfigError, supabaseAdmin } from "@/integrations/supabase/client.server";
import { issueDeviceCommandSchema } from "@/lib/device-command-api";

export const Route = createFileRoute("/api/public/device-commands")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization");
          if (!auth?.startsWith("Bearer ")) {
            return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          }

          const token = auth.slice(7);
          const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userResult.user) {
            return Response.json({ ok: false, error: "Invalid token" }, { status: 401 });
          }

          const { data: roleRow } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", userResult.user.id)
            .eq("role", "admin")
            .maybeSingle();

          if (!roleRow) {
            return Response.json({ ok: false, error: "Admin access required" }, { status: 403 });
          }

          const parsed = issueDeviceCommandSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) {
            return Response.json(
              {
                ok: false,
                error: parsed.error.issues.map((issue) => issue.message).join("; "),
              },
              { status: 400 },
            );
          }

          const { deviceId, commandType } = parsed.data;
          const payload = { ...(parsed.data.payload ?? {}) } as Record<string, unknown>;

          const { data: deviceRow, error: deviceError } = await supabaseAdmin
            .from("devices")
            .select("id,status,user_id")
            .eq("id", deviceId)
            .maybeSingle();

          if (deviceError) {
            return Response.json({ ok: false, error: deviceError.message }, { status: 500 });
          }

          if (!deviceRow) {
            return Response.json({ ok: false, error: "Device not found" }, { status: 404 });
          }

          if (deviceRow.status === "disabled") {
            return Response.json({ ok: false, error: "Disabled devices cannot receive commands" }, { status: 409 });
          }

          let screenSessionId: string | null = null;

          if (commandType === "start_stream") {
            const { data: sessionRow, error: sessionError } = await supabaseAdmin
              .from("screen_sessions" as any)
              .insert({
                device_id: deviceId,
                user_id: userResult.user.id,
                status: "pending",
              } as any)
              .select("id")
              .single();

            if (sessionError || !sessionRow) {
              return Response.json(
                { ok: false, error: sessionError?.message ?? "Unable to create screen-share session" },
                { status: 500 },
              );
            }

            screenSessionId = (sessionRow as { id: string }).id;
            payload.session_id = screenSessionId;
          }

          if (commandType === "stop_stream" && !payload.session_id) {
            const { data: activeSession } = await supabaseAdmin
              .from("screen_sessions" as any)
              .select("id")
              .eq("device_id", deviceId)
              .in("status", ["pending", "active"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (activeSession && typeof (activeSession as { id?: string }).id === "string") {
              payload.session_id = (activeSession as { id: string }).id;
              screenSessionId = (activeSession as { id: string }).id;
            }
          }

          const { data: commandRow, error: commandError } = await supabaseAdmin
            .from("device_commands")
            .insert({
              device_id: deviceId,
              command_type: commandType,
              payload,
              issued_by: userResult.user.id,
            })
            .select("id")
            .single();

          if (commandError || !commandRow) {
            return Response.json(
              { ok: false, error: commandError?.message ?? "Unable to queue device command" },
              { status: 500 },
            );
          }

          return Response.json({
            ok: true,
            command_id: commandRow.id,
            screen_session_id: screenSessionId,
          });
        } catch (error) {
          console.error("POST /api/public/device-commands failed", error);
          return Response.json(
            {
              ok: false,
              error:
                error instanceof Error ? error.message : "Unexpected server error while issuing the device command.",
            },
            { status: isSupabaseAdminConfigError(error) ? 503 : 500 },
          );
        }
      },
    },
  },
});
