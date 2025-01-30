import { Pool } from 'pg';
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Use a single pool instance
const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING,
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : undefined
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function createSafePostgresSaver() {
  const saver = new PostgresSaver(pool);
  
  try {
    await saver.setup();
  } catch (error) {
    console.error('PostgresSaver setup failed:', error);
    throw error;
  }
  
  return saver;
}