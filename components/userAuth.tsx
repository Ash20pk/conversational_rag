'use client';

import { useState, useEffect } from 'react';
import { createClient, User } from '@supabase/supabase-js';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface UserAuthProps {
  onAuthComplete: (user: User | null) => void;
}

export default function UserAuth({ onAuthComplete }: UserAuthProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    // Check current session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        onAuthComplete(session.user);
      }
    };
    
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      onAuthComplete(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [onAuthComplete]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

      if (error) throw error;
      if (data.user) {
        onAuthComplete(data.user);
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="w-full max-w-md space-y-8">
        <div className="relative inline-flex flex-col items-center left-[30%]">
          <span className="absolute -top-2.5 right-0 bg-black text-white text-[10px] px-2 py-0.5 rounded-md font-mono transform translate-x-1/2 rotate-3">
            alpha
          </span>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-extrabold tracking-tight bg-[#ff6600] text-white px-3 py-1.5 rounded-sm">
              YC ADVISOR
            </h2>
          </div>
        </div>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{mode === 'login' ? 'Login' : 'Register'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-red-500">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  mode === 'login' ? 'Login' : 'Register'
                )}
              </Button>
              <p
                className="text-sm text-center mt-4 text-muted-foreground hover:underline cursor-pointer"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}