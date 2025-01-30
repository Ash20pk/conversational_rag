'use client';
import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from '@/components/chatInterface';
import ChatHistory from '@/components/chatHistory';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ChatLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const chatInterfaceRef = useRef<{ handleSubmit: (content: string) => Promise<void>; user: any }>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      setIsCollapsed(JSON.parse(savedState));
    }
  }, []);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
  };

  const handleTaskComplete = async (task: string) => {
    if (chatInterfaceRef.current) {
      await chatInterfaceRef.current.handleSubmit(`I have completed the task: "${task}"`);
    }
  };

  const handleAuthChange = (newUser: any) => {
    console.log('Auth state changed:', newUser); // For debugging
    setUser(newUser);
  };

  return (
    <div className="flex h-screen bg-white">
      {user && (
        <div 
          className={`
            transition-all duration-300 ease-in-out 
            border-r border-gray-200
            ${isCollapsed ? 'w-0' : 'w-72'}
            overflow-hidden
          `}
        >
          <div className="h-full">
            <ChatHistory onTaskComplete={handleTaskComplete} />
          </div>
        </div>
      )}
      <div className={`flex-1 bg-white relative ${!user ? 'max-w-4xl mx-auto' : ''}`}>
        {user && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-0 top-4 z-50 ml-2 hover:bg-gray-100 hover:text-[#ff6600]"
            onClick={toggleSidebar}
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        )}
        <ChatInterface 
          ref={chatInterfaceRef} 
          onAuthChange={handleAuthChange}
        />
      </div>
    </div>
  );
}