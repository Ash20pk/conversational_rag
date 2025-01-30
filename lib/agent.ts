import { 
  HumanMessage, 
  AIMessage, 
  BaseMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { AgentState } from "./state";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { OpenAIEmbeddings } from '@langchain/openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { RunnablePassthrough } from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";
import { 
  StateGraph, 
  START, 
  END,
  MemorySaver,
  messagesStateReducer,
  Annotation 
} from "@langchain/langgraph";

// Singleton instances
let pineconeInstance: Pinecone | null = null;
let embeddingsInstance: OpenAIEmbeddings | null = null;
let llmInstance: ChatAnthropic | null = null;
let indexInstance: any = null;

// Initialize services immediately
const initializeServices = () => {
  if (!process.env.PINECONE_API_KEY || !process.env.OPENAI_API_KEY) {
    throw new Error('Missing required API keys');
  }

  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }

  if (!indexInstance) {
    indexInstance = pineconeInstance.index('ycgpt');
  }

  if (!embeddingsInstance) {
    embeddingsInstance = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }

  if (!llmInstance) {
    llmInstance = new ChatAnthropic({
      modelName: "claude-3-5-sonnet-20240620",
      // temperature: 0.7,
    });
  }

  return {
    pinecone: pineconeInstance,
    index: indexInstance,
    embeddings: embeddingsInstance,
    llm: llmInstance,
  };
};

// Initialize services when module loads
const services = initializeServices();

// Define GraphState with chat history
const GraphState = Annotation.Root({
  input: Annotation<string>(),
  chat_history: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  context: Annotation<string>(),
  answer: Annotation<string>()
});

class VectorSearchRunnable extends RunnablePassthrough {
  private pinecone: Pinecone;
  private index: any;
  private embeddings: OpenAIEmbeddings;
  private llm: ChatAnthropic;

  constructor(pineconeApiKey: string, openAIApiKey: string) {
    super();
    // Use singleton instances instead of creating new ones
    const { pinecone, index, embeddings, llm } = services;
    this.pinecone = pinecone;
    this.index = index;
    this.embeddings = embeddings;
    this.llm = llm;
  }

  async invoke(state: typeof GraphState.State): Promise<any> {
    try {
      // Get the current query
      const query = state.input;
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const typeFilter = query.toLowerCase().includes('application') ? 'application' : 'company';
      
      // Optimize vector search with parallel processing
      const searchResults = await Promise.all([
        this.index.query({
          vector: queryEmbedding,
          topK: 2, // Reduced from 3 to 2 for faster results
          includeMetadata: true,
          filter: { type: typeFilter }
        }),
        this.embeddings.embedQuery(query) // Start next embedding while searching
      ]).then(([results]) => results);

      if (!searchResults.matches || searchResults.matches.length === 0) {
        return {
          chat_history: [
            new HumanMessage(query),
            new AIMessage("No matching results found in the database.")
          ],
          context: "",
          answer: "No matching results found in the database."
        };
      }

      const formattedResults = searchResults.matches.map((match: any) => {
        const metadata = match.metadata;
        if (metadata.type === 'company') {
          return {
            type: 'company',
            name: metadata.name || 'N/A',
            description: metadata.description || 'N/A',
            batch: metadata.batch || 'N/A',
            founded_date: metadata.founded_date || 'N/A',
            industries: Array.isArray(metadata.industries) ? 
              metadata.industries.join(',').split(',')
                .map((i: string) => i.trim())
                .map((i: string) => i.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '))
                .join(', ') 
              : (metadata.industries || 'N/A'),
            founders: Array.isArray(metadata.founders) ? metadata.founders.join(', ') : metadata.founders || 'N/A',
            score: (match.score * 100).toFixed(2)
          };
        } else {
          return {
            type: 'application',
            company_name: metadata.company_name || 'N/A',
            description: metadata.description || 'N/A',
            batch: metadata.batch || 'N/A',
            status: metadata.status || 'N/A',
            qa_pairs: metadata.qa_pairs ? metadata.qa_pairs.slice(0, 3) : [],
            score: (match.score * 100).toFixed(2)
          };
        }
      });

      // Enhanced prompt template that includes chat history
      const promptTemplate = PromptTemplate.fromTemplate(`
        OBJECTIVE -----------------------
        You are YC Advisor , an AI that helps founders craft compelling Y Combinator (YC) applications by leveraging:

        YC Blog Data (essays, frameworks, etc.)
        YC Application Patterns (successful application trends, etc.)
        YC Company Case Studies (e.g., Rippling, OpenAI, Brex, etc.)
        YC Founder Insights (partner advice, founder interviews, post-mortems, etc.)
        Your mission is to guide founders step-by-step in articulating their idea clearly, validating their assumptions, and crafting a standout YC application.

        CORE IDENTITY -------------------------
        Name: YC Advisor
        Voice: Direct yet empathetic—combining Sam Altman’s clarity with Paul Graham’s focus on tangible progress. You ask only necessary questions, provide actionable guidance, and maintain a laser focus on helping founders complete their YC application.

        CORE RULES -----------------------------
        1. One Question at a Time
            Always ask one clear, concise question per interaction.
            Wait for the founder’s response before moving forward.
            If the founder struggles to answer, provide examples or guiding prompts to help clarify.
        2. No Assumptions—Verify Everything
            Never assume the founder has fully defined their problem, user segment, or solution.
            Ask open-ended questions to uncover gaps.
            Example: Instead of asking, “What’s the current workaround?” (which assumes one exists), ask, “Are users trying to solve this today? If not, why?”
        3. Guidance Over Criticism
            If the founder gives vague answers, acknowledge their effort and refine their thinking with examples or frameworks.
            Example: If they say, “We’re helping small businesses,” respond with:
            “Got it. Let’s get specific: ‘[X users] lose [Y hours/$] on [Z task].’ For example, ‘TikTok creators waste 7 hours/week finding brand deals.’ Does this resonate with your idea? If not, how would you adjust it?” 
        4. Anti-Repetition Framework
            Avoid rehashing the same question if the founder provides incomplete or unclear responses.
            Acknowledge their input, offer a concrete example, and ask if it aligns with their situation before proceeding.
        5. Actionable Next Steps
            Every conversation should end with a clear, time-bound task to move the founder closer to completing their YC application.

        FIRST MESSAGE --------------
        Trigger: Founder says “hi,” “hello,” or similar.

        “👋 Welcome! I’m your YC Advisor. My job is to help you crystallize your idea into something YC can’t ignore
        Let’s start simple: What problem are you solving? (Keep it short—1 sentence.)” 

        Only trigger if:

        Chat history does not contain "FIRST MESSAGE."

        RESPONSE FRAMEWORK -----------------------------
        Step 1: Clarifying Questions (Guided Approach)
        Use hints, examples, and YC case studies to guide the founder toward clarity.

            1. Problem Definition
            Question: “What’s the specific problem you’re solving?”
            Hint (if needed):
            “Think about the biggest pain point your users face. For example, ‘Small businesses lose 15% of revenue to chargebacks.’ Does that sound similar to your problem?” 
            Follow-up: “How would you phrase it?”
            2. Target Audience
            Question: “Who exactly has this problem?”
            Prompt (if needed):
            “List 3 real people or businesses you think struggle with this. For example, ‘Solo Shopify store owners who sell digital products.’ Who comes to mind for you?” 
            3. Current Workaround
            Question: “What do they do now to solve it?”
            Framework (if needed):
            “If no clear solution exists, you can say: ‘They currently suffer from [X consequence] because no good solution exists.’ For example, ‘They refund customers to avoid chargebacks, losing profit.’ Does that fit?” 

        Step 2: YC Case Study Reference
        After the founder provides a clearer answer, reinforce it with a relevant YC case study.

        Example:
        “Great! This reminds me of Rippling (YC W17), which manually processed payroll for their first 10 clients before automating it. They started by deeply understanding the problem. Let’s do the same for your idea.” 

        Step 3: Task + Deadline (Actionable Next Steps)
        Assign a specific, time-bound task to validate the problem or refine their application.

        Example:
        “Let’s validate this. Talk to 3 users and list their biggest pain points. Deadline: 4 hours.” 

        EDGE CASE RESPONSES ---------------------
        For edge cases like “No one’s responding to DMs” or “This is time-consuming,” follow these steps:

        Acknowledge Frustration:
        “I hear you—it’s tough when outreach doesn’t work as planned.” 
        Provide Tactical Suggestions:
        “Let’s refine your message. For example: ‘[Name], I noticed you [specific pain point]. Can I fix this for you?’ What’s your current message?” 
        Reinforce Importance with a YC Example:
        “OpenSea (YC W18) personalized 500 messages for CryptoKitties users. Let’s try resending 50 DMs using this template. Deadline: 5 hours. Reply ‘GO’ when done.” 

        OUTCOME -----------------------------
        By incorporating hints, examples, and guiding prompts, the advisor ensures the founder feels supported rather than interrogated. It also prevents repetition by offering a clear path forward when the founder struggles to articulate their thoughts, ultimately helping them craft a strong YC application.

        CONTEXT TO MAINTAIN -------------------------
        Keep the following dynamic information in mind as the conversation progresses:

        Chat History: {chat_history}
        Latest Query: {query}
        Retrieved Information: {results}
        Always ground your advice and responses in the context provided above to ensure continuity and relevance. Always respond like a human with a YC experience."

      `);

      const llmResponse = await this.llm.invoke(
        await promptTemplate.format({
          chat_history: state.chat_history.map(m => {
            if (m instanceof HumanMessage) {
              return `Human: ${m.content}`;
            } else if (m instanceof AIMessage) {
              return `Assistant: ${m.content}`;
            } else {
              return `${m.content}`;
            }
          }).join('\n'),
          query: query,
          results: JSON.stringify(formattedResults, null, 2)
        })
      );

      const answer = typeof llmResponse.content === 'string' 
        ? llmResponse.content 
        : JSON.stringify(llmResponse.content);

      return {
        chat_history: [
          new HumanMessage(query),
          new AIMessage(answer)
        ],
        context: JSON.stringify(formattedResults),
        answer: answer
      };
    } catch (error) {
      console.error('Error in vector search:', error);
      const errorMsg = 'Sorry, I encountered an error while searching the database. Please try again.';
      return {
        chat_history: [
          new HumanMessage(state.input),
          new AIMessage(errorMsg)
        ],
        context: "",
        answer: errorMsg
      };
    }
  }
}

async function createVectorAgent({
  pineconeApiKey,
  openAIApiKey,
}: {
  pineconeApiKey: string;
  openAIApiKey: string;
}): Promise<Runnable> {
  return new VectorSearchRunnable(pineconeApiKey, openAIApiKey);
}

// Create workflow with memory
async function createWorkflow(agent: Runnable) {
  const memory = new MemorySaver();
  
  // Create the workflow
  const workflow = new StateGraph(GraphState)
    .addNode("model", async (state: typeof GraphState.State) => {
      const response = await agent.invoke(state);
      return response;
    })
    .addEdge(START, "model")
    .addEdge("model", END);

  // Compile with memory
  return workflow.compile({ checkpointer: memory });
}

async function ycVectorNode(
  state: typeof AgentState.State,
  config?: RunnableConfig,
) {
  try {
    const agent = await createVectorAgent({
      pineconeApiKey: process.env.PINECONE_API_KEY || '',
      openAIApiKey: process.env.OPENAI_API_KEY || '',
    });

    const app = await createWorkflow(agent);
    const threadId = (config?.configurable as any)?.thread_id;

    // Convert AgentState to GraphState format
    const lastMessage = state.messages[state.messages.length - 1];
    const input = lastMessage.content.toString();

    const result = await app.invoke(
      { input, chat_history: state.messages },
      { configurable: { thread_id: threadId } }
    );

    return {
      messages: [new HumanMessage({ content: result.answer })],
      sender: "YCVectorKnowledge"
    };
  } catch (error) {
    console.error("Error in vector node:", error);
    return {
      messages: [
        new HumanMessage({
          content: "I apologize, but I encountered an error. Could you rephrase your question?",
          name: "YCVectorKnowledge",
        }),
      ],
      sender: "YCVectorKnowledge",
    };
  }
}

export { ycVectorNode };