export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          device_id: string | null
          event_type: Database["public"]["Enums"]["activity_event_type"]
          id: string
          metadata: Json | null
          occurred_at: string
          outcome: Database["public"]["Enums"]["activity_event_outcome"]
          screenshot_path: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          target: string | null
          user_id: string | null
        }
        Insert: {
          device_id?: string | null
          event_type: Database["public"]["Enums"]["activity_event_type"]
          id?: string
          metadata?: Json | null
          occurred_at?: string
          outcome: Database["public"]["Enums"]["activity_event_outcome"]
          screenshot_path?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target?: string | null
          user_id?: string | null
        }
        Update: {
          device_id?: string | null
          event_type?: Database["public"]["Enums"]["activity_event_type"]
          id?: string
          metadata?: Json | null
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["activity_event_outcome"]
          screenshot_path?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_heartbeats: {
        Row: {
          agent_version: string | null
          cpu_percent: number | null
          device_id: string
          id: string
          last_sync_at: string | null
          memory_mb: number | null
          metadata: Json
          reported_at: string
          uptime_seconds: number
          user_id: string
          watchdog_status: Database["public"]["Enums"]["watchdog_status"]
        }
        Insert: {
          agent_version?: string | null
          cpu_percent?: number | null
          device_id: string
          id?: string
          last_sync_at?: string | null
          memory_mb?: number | null
          metadata?: Json
          reported_at?: string
          uptime_seconds?: number
          user_id: string
          watchdog_status?: Database["public"]["Enums"]["watchdog_status"]
        }
        Update: {
          agent_version?: string | null
          cpu_percent?: number | null
          device_id?: string
          id?: string
          last_sync_at?: string | null
          memory_mb?: number | null
          metadata?: Json
          reported_at?: string
          uptime_seconds?: number
          user_id?: string
          watchdog_status?: Database["public"]["Enums"]["watchdog_status"]
        }
        Relationships: [
          {
            foreignKeyName: "agent_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          action_type: string
          created_at: string
          device_id: string | null
          id: string
          metadata: Json | null
          severity: Database["public"]["Enums"]["alert_severity"]
          target: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          device_id?: string | null
          id?: string
          metadata?: Json | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          device_id?: string | null
          id?: string
          metadata?: Json | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          download_restriction_enabled: boolean
          firewall_enabled: boolean
          id: string
          process_enforcement_enabled: boolean
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          download_restriction_enabled?: boolean
          firewall_enabled?: boolean
          id?: string
          process_enforcement_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          download_restriction_enabled?: boolean
          firewall_enabled?: boolean
          id?: string
          process_enforcement_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      auto_response_rules: {
        Row: {
          action: Database["public"]["Enums"]["auto_response_action"]
          action_duration_minutes: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          severity_filter: Database["public"]["Enums"]["alert_severity"] | null
          source_filter: Database["public"]["Enums"]["violation_source"] | null
          time_window_minutes: number
          trigger_type: Database["public"]["Enums"]["auto_response_trigger"]
          updated_at: string
          violation_threshold: number
        }
        Insert: {
          action?: Database["public"]["Enums"]["auto_response_action"]
          action_duration_minutes?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          severity_filter?: Database["public"]["Enums"]["alert_severity"] | null
          source_filter?: Database["public"]["Enums"]["violation_source"] | null
          time_window_minutes?: number
          trigger_type?: Database["public"]["Enums"]["auto_response_trigger"]
          updated_at?: string
          violation_threshold?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["auto_response_action"]
          action_duration_minutes?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          severity_filter?: Database["public"]["Enums"]["alert_severity"] | null
          source_filter?: Database["public"]["Enums"]["violation_source"] | null
          time_window_minutes?: number
          trigger_type?: Database["public"]["Enums"]["auto_response_trigger"]
          updated_at?: string
          violation_threshold?: number
        }
        Relationships: []
      }
      db_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          notes: string | null
          restored_at: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["snapshot_status"]
          storage_path: string | null
          table_counts: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          notes?: string | null
          restored_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["snapshot_status"]
          storage_path?: string | null
          table_counts?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          notes?: string | null
          restored_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["snapshot_status"]
          storage_path?: string | null
          table_counts?: Json
        }
        Relationships: []
      }
      device_commands: {
        Row: {
          acknowledged_at: string | null
          command_type: Database["public"]["Enums"]["device_command_type"]
          completed_at: string | null
          created_at: string
          device_id: string
          id: string
          issued_by: string | null
          payload: Json
          result: string | null
          status: Database["public"]["Enums"]["device_command_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          command_type: Database["public"]["Enums"]["device_command_type"]
          completed_at?: string | null
          created_at?: string
          device_id: string
          id?: string
          issued_by?: string | null
          payload?: Json
          result?: string | null
          status?: Database["public"]["Enums"]["device_command_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          command_type?: Database["public"]["Enums"]["device_command_type"]
          completed_at?: string | null
          created_at?: string
          device_id?: string
          id?: string
          issued_by?: string | null
          payload?: Json
          result?: string | null
          status?: Database["public"]["Enums"]["device_command_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          agent_version: string | null
          created_at: string
          device_name: string
          download_restriction_enabled: boolean
          firewall_enabled: boolean
          hostname: string | null
          id: string
          ip_address: string | null
          last_seen: string | null
          os: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_version?: string | null
          created_at?: string
          device_name: string
          download_restriction_enabled?: boolean
          firewall_enabled?: boolean
          hostname?: string | null
          id?: string
          ip_address?: string | null
          last_seen?: string | null
          os?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_version?: string | null
          created_at?: string
          device_name?: string
          download_restriction_enabled?: boolean
          firewall_enabled?: boolean
          hostname?: string | null
          id?: string
          ip_address?: string | null
          last_seen?: string | null
          os?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      domains: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          domain_name: string
          id: string
          is_blocked: boolean
          scope: Database["public"]["Enums"]["rule_scope"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          domain_name: string
          id?: string
          is_blocked?: boolean
          scope?: Database["public"]["Enums"]["rule_scope"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          domain_name?: string
          id?: string
          is_blocked?: boolean
          scope?: Database["public"]["Enums"]["rule_scope"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domains_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      downloads: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          extension: string
          id: string
          is_blocked: boolean
          scope: Database["public"]["Enums"]["rule_scope"]
          size_limit_mb: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          extension: string
          id?: string
          is_blocked?: boolean
          scope?: Database["public"]["Enums"]["rule_scope"]
          size_limit_mb?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          extension?: string
          id?: string
          is_blocked?: boolean
          scope?: Database["public"]["Enums"]["rule_scope"]
          size_limit_mb?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "downloads_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          days_of_week: number[]
          device_id: string | null
          end_time: string
          id: string
          is_active: boolean
          name: string
          scope: Database["public"]["Enums"]["rule_scope"]
          start_time: string
          target_type: Database["public"]["Enums"]["schedule_target_type"]
          target_value: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          device_id?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          name: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          start_time: string
          target_type: Database["public"]["Enums"]["schedule_target_type"]
          target_value: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          device_id?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          name?: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          start_time?: string
          target_type?: Database["public"]["Enums"]["schedule_target_type"]
          target_value?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_schedules_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      process_blacklist: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kill_on_detect: boolean
          process_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kill_on_detect?: boolean
          process_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kill_on_detect?: boolean
          process_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      requests: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          payload: Json
          reason: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          request_type?: Database["public"]["Enums"]["request_type"]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      screenshot_deletions: {
        Row: {
          activity_event_id: string | null
          deleted_at: string
          deleted_by: string | null
          device_id: string | null
          id: string
          reason: string
          screenshot_path: string
        }
        Insert: {
          activity_event_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          device_id?: string | null
          id?: string
          reason?: string
          screenshot_path: string
        }
        Update: {
          activity_event_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          device_id?: string | null
          id?: string
          reason?: string
          screenshot_path?: string
        }
        Relationships: []
      }
      screenshot_retention_policies: {
        Row: {
          auto_purge_enabled: boolean
          id: string
          retention_days: number
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_purge_enabled?: boolean
          id?: string
          retention_days?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_purge_enabled?: boolean
          id?: string
          retention_days?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      violation_events: {
        Row: {
          device_id: string | null
          id: string
          occurred_at: string
          severity: Database["public"]["Enums"]["alert_severity"]
          source: Database["public"]["Enums"]["violation_source"]
          target: string | null
          user_id: string | null
        }
        Insert: {
          device_id?: string | null
          id?: string
          occurred_at?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          source: Database["public"]["Enums"]["violation_source"]
          target?: string | null
          user_id?: string | null
        }
        Update: {
          device_id?: string | null
          id?: string
          occurred_at?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          source?: Database["public"]["Enums"]["violation_source"]
          target?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "violation_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          alert_id: string | null
          attempts: number
          created_at: string
          endpoint_id: string
          id: string
          last_error: string | null
          payload: Json
          sent_at: string | null
          status: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Insert: {
          alert_id?: string | null
          attempts?: number
          created_at?: string
          endpoint_id: string
          id?: string
          last_error?: string | null
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Update: {
          alert_id?: string | null
          attempts?: number
          created_at?: string
          endpoint_id?: string
          id?: string
          last_error?: string | null
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          min_severity: Database["public"]["Enums"]["alert_severity"]
          name: string
          provider: Database["public"]["Enums"]["webhook_provider"]
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          min_severity?: Database["public"]["Enums"]["alert_severity"]
          name: string
          provider?: Database["public"]["Enums"]["webhook_provider"]
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          min_severity?: Database["public"]["Enums"]["alert_severity"]
          name?: string
          provider?: Database["public"]["Enums"]["webhook_provider"]
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_expired_screenshots: { Args: never; Returns: number }
    }
    Enums: {
      activity_event_outcome: "allowed" | "blocked" | "killed" | "deleted"
      activity_event_type: "domain_access" | "download" | "process"
      alert_severity: "info" | "warning" | "critical"
      app_role: "admin" | "user"
      auto_response_action:
        | "log_only"
        | "temp_block_all"
        | "disable_network"
        | "lock_device"
      auto_response_trigger: "violation_count" | "single_violation"
      device_command_status: "pending" | "acknowledged" | "completed" | "failed"
      device_command_type:
        | "lock_device"
        | "restart_agent"
        | "force_sync"
        | "disable_network"
        | "enable_network"
      device_status: "active" | "inactive" | "disabled"
      request_status: "pending" | "approved" | "rejected"
      request_type: "domain" | "download" | "uninstall"
      rule_scope: "global" | "device"
      schedule_target_type: "domain" | "process"
      snapshot_status: "pending" | "ready" | "failed" | "restored"
      violation_source: "domain" | "download" | "process"
      watchdog_status: "healthy" | "degraded" | "down" | "unknown"
      webhook_delivery_status: "pending" | "sent" | "failed"
      webhook_provider: "slack" | "discord" | "generic"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_event_outcome: ["allowed", "blocked", "killed", "deleted"],
      activity_event_type: ["domain_access", "download", "process"],
      alert_severity: ["info", "warning", "critical"],
      app_role: ["admin", "user"],
      auto_response_action: [
        "log_only",
        "temp_block_all",
        "disable_network",
        "lock_device",
      ],
      auto_response_trigger: ["violation_count", "single_violation"],
      device_command_status: ["pending", "acknowledged", "completed", "failed"],
      device_command_type: [
        "lock_device",
        "restart_agent",
        "force_sync",
        "disable_network",
        "enable_network",
      ],
      device_status: ["active", "inactive", "disabled"],
      request_status: ["pending", "approved", "rejected"],
      request_type: ["domain", "download", "uninstall"],
      rule_scope: ["global", "device"],
      schedule_target_type: ["domain", "process"],
      snapshot_status: ["pending", "ready", "failed", "restored"],
      violation_source: ["domain", "download", "process"],
      watchdog_status: ["healthy", "degraded", "down", "unknown"],
      webhook_delivery_status: ["pending", "sent", "failed"],
      webhook_provider: ["slack", "discord", "generic"],
    },
  },
} as const
