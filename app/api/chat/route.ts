import { NextRequest, NextResponse } from 'next/server';
import { HumanMessage } from "@langchain/core/messages";
import { isAIMessageChunk } from "@langchain/core/messages";
import { createOrGetConversation } from "../../../lib/graph";
import { MessageContent, MessageContentComplex } from "@langchain/core/messages";

export const runtime = "nodejs";
export const maxDuration = 300;

function handleComplexContent(item: MessageContentComplex): string {
    if ('type' in item) {
        switch (item.type) {
            case 'text':
                return item.text;
            case 'image_url':
                return `[Image: ${item.image_url}]`;
            default:
                return '';
        }
    }
    return '';
}

function convertMessageContentToString(content: MessageContent): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(item => {
                if (typeof item === 'string') {
                    return item;
                }
                return handleComplexContent(item);
            })
            .filter(Boolean)
            .join(' ');
    }
    return '';
}

async function handleChatStream(message: string, threadId: string) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    let isStreamClosed = false;

    try {
        const { graph, config } = await createOrGetConversation(threadId);

        const response = await graph.stream(
            {
                messages: [new HumanMessage({ content: message })],
                sender: "user"
            },
            { 
                streamMode: "messages",
                configurable: config.configurable
            }
        );

        (async () => {
            try {
                for await (const [message, ...metadata] of response) {
                    if (isStreamClosed) break;

                    if (!isAIMessageChunk(message)) {
                        if (!isStreamClosed) {
                            await writer.write(encoder.encode('data: [DONE]\n\n'));
                            await writer.close();
                            isStreamClosed = true;
                        }
                        break;
                    }

                    const contentToSend = message.content ? 
                        convertMessageContentToString(message.content) : "";
                    
                    if (contentToSend && !isStreamClosed) {
                        // Send plain text data
                        await writer.write(encoder.encode(`data: ${contentToSend}\n\n`));
                    }
                }

                if (!isStreamClosed) {
                    await writer.write(encoder.encode('data: [DONE]\n\n'));
                    await writer.close();
                    isStreamClosed = true;
                }
            } catch (error) {
                console.error("Streaming error:", error);
                if (!isStreamClosed) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await writer.write(encoder.encode(`data: Error: ${errorMessage}\n\n`));
                    await writer.close();
                    isStreamClosed = true;
                }
            }
        })();

        return new NextResponse(stream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            }
        });

    } catch (error) {
        console.error("API error:", error);
        if (!isStreamClosed) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await writer.write(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
            await writer.close();
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const message = searchParams.get('message');
        const threadId = searchParams.get('threadId');

        if (!message || !threadId) {
            return NextResponse.json(
                { error: 'Message and threadId are required' },
                { status: 400 }
            );
        }

        return handleChatStream(message, threadId);
    } catch (error) {
        console.error('API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const message = body.message;
        const threadId = body.threadId;

        if (!message || !threadId) {
            return NextResponse.json(
                { error: 'Message and threadId are required' },
                { status: 400 }
            );
        }

        return handleChatStream(message, threadId);
    } catch (error) {
        console.error('API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}