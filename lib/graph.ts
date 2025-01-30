import { Command, interrupt, START, StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { createSafePostgresSaver } from "../config/db-config";
import { ycVectorNode } from "./agent";
import { v4 as uuidv4 } from 'uuid';
import { HumanMessage } from "@langchain/core/messages";

let graph: any = null;
let memory: any = null;

function humanNode(state: typeof AgentState.State) {
    const userInput: string = interrupt("Ready for user input.");
    return {
        messages: [new HumanMessage(userInput)],
        sender: "user",
    };
  }

async function createWorkflow() {
  if (!memory) {
    memory = await createSafePostgresSaver();
  }
  
  const workflow = new StateGraph(AgentState)
    .addNode("ycKnowledge", ycVectorNode)
    .addNode("human", humanNode)
    .addEdge(START, "ycKnowledge")
    .addEdge("ycKnowledge", "human")
    .addEdge("human", "ycKnowledge");

  return workflow.compile({ checkpointer: memory });
}

export async function initializeGraph() {
  if (!graph) {
    try {
      graph = await createWorkflow();
    } catch (error) {
      console.error('Failed to initialize graph:', error);
      throw error;
    }
  }
  return graph;
}

let activeThreads = new Map();

export async function createOrGetConversation(existingThreadId?: string) {
  if (existingThreadId && activeThreads.has(existingThreadId)) {
    return {
      graph: await initializeGraph(),
      config: { configurable: { thread_id: existingThreadId } }
    };
  }

  const threadId = existingThreadId || uuidv4();
  activeThreads.set(threadId, Date.now());
  
  return {
    graph: await initializeGraph(),
    config: { configurable: { thread_id: threadId } }
  };
}

// Clean old threads periodically (optional)
setInterval(() => {
  const now = Date.now();
  for (const [threadId, timestamp] of activeThreads.entries()) {
    if (now - timestamp > 24 * 60 * 60 * 1000) { // 24 hours
      activeThreads.delete(threadId);
    }
  }
}, 60 * 60 * 1000); // Check every hour