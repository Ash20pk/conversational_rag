'use client';
import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send } from "lucide-react";
import UserAuth from './userAuth';
import { createClient, User } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface CheckpointMetadata {
  step: number;
  source: string;
  writes: {
    [key: string]: {
      sender: string;
      messages: Array<{
        id: string[];
        lc: number;
        type: string;
        kwargs: {
          id: string;
          content: string;
          additional_kwargs: any;
          response_metadata: any;
        };
      }>;
    };
  };
  parents: any;
}

interface ChatInterfaceProps {
  onAuthChange?: (user: any) => void;
}

const DotLoader = () => {
  return (
    <div className="inline-flex items-center space-x-1 min-h-[24px] py-1">
      <div className="w-1 h-1 bg-gray-400 rounded-full animate-[bounce_1s_infinite_0ms]"></div>
      <div className="w-1 h-1 bg-gray-400 rounded-full animate-[bounce_1s_infinite_200ms]"></div>
      <div className="w-1 h-1 bg-gray-400 rounded-full animate-[bounce_1s_infinite_400ms]"></div>
    </div>
  );
};

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble = ({ message }: MessageBubbleProps) => {
  return (
    <div
      className={`flex ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      } mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          message.role === 'user'
            ? 'bg-[#ff6600] text-white'
            : 'bg-[#F5F5EE] text-gray-900'
        }`}
      >
        {message.content ? (
          <ReactMarkdown 
            className={`prose ${
              message.role === 'user' 
                ? 'text-white' 
                : 'dark:prose-invert text-gray-900 dark:text-gray-100'
            }`}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          <DotLoader />
        )}
      </div>
    </div>
  );
};

const ChatInterface = forwardRef((props: ChatInterfaceProps, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { onAuthChange } = props;

  const parseCheckpointMetadata = (metadata: CheckpointMetadata): Message | null => {
    // Skip entries with null writes or empty writes
    if (!metadata.writes) return null;

    // Get the first key from writes (either __start__ or ycKnowledge)
    const key = Object.keys(metadata.writes)[0];
    if (!key) return null;

    const data = metadata.writes[key];
    if (!data?.messages || !data.messages[0]) return null;

    // Get the message content
    const messageData = data.messages[0];
    if (!messageData.kwargs?.content) return null;

    // Determine the role based on the sender and source
    let role: 'user' | 'assistant' = 'assistant';
    if (data.sender === 'user' || (metadata.source === 'input' && key === '__start__')) {
      role = 'user';
    }

    return {
      role,
      content: messageData.kwargs.content
    };
  };

  const loadMessages = async () => {
    if (!user?.id) return;

    try {
      // Fetch checkpoints for this thread
      const { data: checkpoints, error } = await supabase
        .from('checkpoints')
        .select('metadata')
        .eq('thread_id', user.id);

      if (error) throw error;

      // Parse checkpoints and convert to messages, sort by step number
      const loadedMessages = checkpoints
        .sort((a, b) => a.metadata.step - b.metadata.step)
        .map(checkpoint => parseCheckpointMetadata(checkpoint.metadata))
        .filter((msg): msg is Message => msg !== null)
        // Filter out consecutive duplicate messages
        .filter((msg, index, array) => {
          if (index === 0) return true;
          const prevMsg = array[index - 1];
          return !(prevMsg.role === msg.role && prevMsg.content === msg.content);
        });

      setMessages(loadedMessages);
      scrollToBottom();
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  useEffect(() => {
    props.onAuthChange?.(user);
  }, [user, props.onAuthChange]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useImperativeHandle(ref, () => ({
    handleSubmit: async (content: string) => {
      if (!user?.id) return;

      const userMessage: Message = { role: 'user', content };
      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          message: content,
          threadId: user.id
        });
        
        const eventSource = new EventSource(`/api/chat?${params.toString()}`);
        let assistantMessage = '';

        // Add empty assistant message that will be updated
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        const processIncomingMessage = (content: string) => {
          // Clean the message before updating
          const cleanedMessage = cleanMessage(content);
          
          if (cleanedMessage.trim()) {
            setMessages(prev => [
              ...prev.slice(0, -1),
              { role: 'assistant', content: cleanedMessage }
            ]);
            scrollToBottom();
          }
        };

        eventSource.addEventListener('message', (event) => {
          try {
            if (event.data === '[DONE]') {
              eventSource.close();
              setIsLoading(false);
              return;
            }

            // Handle plain text data
            const content = event.data;
            if (content) {
              assistantMessage += content;
              processIncomingMessage(assistantMessage);
            }
          } catch (e) {
            console.error('Error processing SSE message:', e);
          }
        });

        eventSource.addEventListener('error', (error) => {
          console.error('EventSource error:', error);
          eventSource.close();
          setIsLoading(false);
          setMessages(prev => [
            ...prev.slice(0, -1),
            {
              role: 'assistant',
              content: 'Sorry, there was an error processing your request.'
            }
          ]);
        });

        // Add cleanup for component unmount
        return () => {
          eventSource.close();
        };
      } catch (error) {
        console.error('Error:', error);
        setIsLoading(false);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Sorry, there was an error processing your request.'
        }]);
      }
    },
    user
  }));

  useEffect(() => {
    if (user?.id) {
      loadMessages();
    }
  }, [user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user?.id) return;
    await (ref as any).current.handleSubmit(input);
  };

  const cleanMessage = (content: string) => {
    // Clean message content
    return content
      .replace(/^(YC\s*Advisor\s*(?:here)?:?\s*)/i, '')  // Remove "YC Advisor:" or "YC Advisor here:"
      .replace(/^(Your\s*YC\s*Advisor\s*(?:here)?:?\s*)/i, '')  // Remove "Your YC Advisor:" or "Your YC Advisor here:"
      .trim();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMessages([]);
  };

  if (!user) {
    return <UserAuth onAuthComplete={setUser} />;
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex flex-col items-start">
          <div className="relative inline-flex flex-col items-center">
            <span className="absolute -top-2.5 right-0 bg-black text-white text-[10px] px-2 py-0.5 rounded-md font-mono transform translate-x-1/2 rotate-3">
              alpha
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight bg-[#ff6600] text-white px-3 py-1.5 rounded-sm">
              YC ADVISOR
            </h2>
          </div>
        </div>
        <div className="space-x-2">
          <Button 
            variant="outline" 
            onClick={handleSignOut}
            className="text-sm rounded-lg"
          >
            Sign Out
          </Button>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-[calc(100vh-12rem)] p-4">
          <div className="space-y-4 pb-4">
            {messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </Card>

      <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
          className="flex-1"
        />
        <Button 
          type="submit" 
          disabled={isLoading}
          className="rounded-lg"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
});

export default ChatInterface;