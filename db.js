import postgres from 'postgres'
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

const connectionString = process.env.DATABASE_URL
const sql = postgres(connectionString)

export default sql