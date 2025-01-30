'use client';
import React, { useEffect, useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Summary {
  id: string;
  user_id: string;
  summary: string;
  created_at: string;
}

interface FormattedSummary {
  discussions: string[];
  lastTask: string[];
  context: string[];
}

interface ChatHistoryProps {
  onTaskComplete?: (task: string) => void;
}

function parseSummary(summary: string): FormattedSummary {
  const sections = summary.split('\n\n');
  const formatted: FormattedSummary = {
    discussions: [],
    lastTask: [],
    context: []
  };

  for (const section of sections) {
    if (section.startsWith('Discussions till now:')) {
      formatted.discussions = section
        .replace('Discussions till now:', '')
        .trim()
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().substring(2));
    } else if (section.startsWith('Last task or action item assigned:')) {
      formatted.lastTask = section
        .replace('Last task or action item assigned:', '')
        .trim()
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().substring(2));
    } else if (section.startsWith('Important context for next interactions:')) {
      formatted.context = section
        .replace('Important context for next interactions:', '')
        .trim()
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().substring(2));
    }
  }

  return formatted;
}

export default function ChatHistory({ onTaskComplete }: ChatHistoryProps) {
  const [summaries, setSummaries] = useState<FormattedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      // Get current user directly from Supabase auth
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.error('No authenticated user found');
        setError('No authenticated user');
        setLoading(false);
        return;
      }

      console.log('Fetching history for user:', user.id);

      const { data, error } = await supabase
        .from('chat_summaries')
        .select('summary, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Supabase error fetching chat summary:', error);
        setError(`Failed to fetch chat summary: ${error.message}`);
        setLoading(false);
        return;
      }

      if (data && data.length > 0 && data[0].summary) {
        console.log('Found summary:', data[0].summary);
        const formatted = parseSummary(data[0].summary);
        setSummaries(formatted ? [formatted] : []);
      } else {
        console.log('No summary found');
        setSummaries([]);
      }
      setLoading(false);
    } catch (error) {
      console.error('Unexpected error in fetchHistory:', error);
      setError(error instanceof Error ? error.message : 'Unexpected error fetching chat history');
      setLoading(false);
    }
  };

  useEffect(() => {
    const initFetch = async () => {
      try {
        // Ensure Supabase is initialized
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          console.error('No active session');
          setError('No active authentication session');
          setLoading(false);
          return;
        }

        console.log('Session found, fetching history');
        await fetchHistory();
      } catch (error) {
        console.error('Error in authentication or fetching:', error);
        setError(error instanceof Error ? error.message : 'Authentication failed');
        setLoading(false);
      }
    };

    initFetch();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="animate-spin text-gray-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 p-4">
        <p>Error: {error}</p>
        <p className="text-sm mt-2">Please check your authentication and try again.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Chat Summary</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {summaries.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No chat summary available
            </div>
          ) : (
            summaries.map((summary, i) => (
              <Card 
                key={i} 
                className="bg-[#F5F5EE] border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between border-b border-gray-100">
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {summary.discussions && summary.discussions.length > 0 && (
                    <div>
                      <h3 className="text-s font-semibold text-black uppercase tracking-wider mb-2 underline">
                        Discussion Points
                      </h3>
                      <ul className="space-y-2">
                        {summary.discussions.map((item, i) => (
                          <li 
                            key={i} 
                            className="flex items-start text-sm text-gray-700 hover:text-gray-900"
                          >
                            <span className="mr-2 mt-1 text-gray-400">•</span>
                            <span className="flex-1">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {summary.lastTask && summary.lastTask.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-[#ff6600] border-b border-gray-200 flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center">
                          <svg className="w-4 h-4 mr-1.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          Action Items
                        </h3>
                        <span className="text-xs text-white font-medium">
                          {summary.lastTask.length} items
                        </span>
                      </div>
                      <ul className="divide-y divide-gray-100">
                        {summary.lastTask.map((item, i) => (
                          <li 
                            key={i} 
                            className="group hover:bg-gradient-to-r hover:from-[#F5F5EE] hover:to-transparent transition-all duration-200"
                          >
                            <div className="px-4 py-3 flex items-start">
                              <div className="flex-none mr-3 mt-1">
                                <div 
                                  onClick={() => onTaskComplete?.(item)}
                                  className="w-5 h-5 rounded-full border-2 border-[#ff6600] group-hover:border-[#ff6600] flex items-center justify-center cursor-pointer transition-colors duration-200"
                                >
                                  <svg 
                                    className="w-3 h-3 text-transparent group-hover:text-[#ff6600]/30" 
                                    fill="currentColor" 
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                                  </svg>
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors duration-200 leading-relaxed">
                                  {item}
                                </p>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {summary.context && summary.context.length > 0 && (
                    <div>
                      <h3 className="text-s font-semibold text-black uppercase tracking-wider mb-2 underline">
                        Important Context
                      </h3>
                      <ul className="space-y-2 rounded-lg p-3 border border-amber-100">
                        {summary.context.map((item, i) => (
                          <li 
                            key={i} 
                            className="flex items-start text-sm text-amber-800"
                          >
                            <span className="mr-2 mt-1 text-amber-400">⚡</span>
                            <span className="flex-1">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}