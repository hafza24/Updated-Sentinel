import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const USERNAME_DOMAIN = "sentinel.local";
export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

export type AppRole = "admin" | "user";

interface AuthState {
  user: User | null;
  session: Session | null;
  username: string | null;
  role: AppRole | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch role + username for the current user (deferred to avoid auth deadlock)
  const loadProfile = (uid: string) => {
    setTimeout(async () => {
      const [{ data: roleRow }, { data: profileRow }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .order("role", { ascending: true })
          .maybeSingle(),
        supabase.from("profiles").select("username").eq("id", uid).maybeSingle(),
      ]);
      setRole((roleRow?.role as AppRole) ?? "user");
      setUsername(profileRow?.username ?? null);
    }, 0);
  };

  useEffect(() => {
    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setRole(null);
        setUsername(null);
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) loadProfile(existing.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (uname: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(uname),
      password,
    });
    if (error) throw error;
  };

  const signUp = async (uname: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email: usernameToEmail(uname),
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { username: uname.trim().toLowerCase(), display_name: uname.trim() },
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        username,
        role,
        loading,
        isAuthenticated: !!session,
        isAdmin: role === "admin",
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
