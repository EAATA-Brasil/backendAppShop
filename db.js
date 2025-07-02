import postgres from 'postgres'
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

let sql;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

// Create a database event emitter to handle connection events
export const dbEvents = new EventEmitter();

// Set up database connection status
let isConnected = false;

/**
 * Initialize database connection with retry mechanism
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<object>} Postgres SQL client
 */
async function initDbConnection(retryCount = 0) {
  try {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      console.error('ERROR: DATABASE_URL environment variable is not set');
      process.exit(1); // Exit with error code
    }
    
    // Configure postgres with some options for better error handling
    sql = postgres(connectionString, {
      onnotice: () => {}, // Silence notice messages
      debug: process.env.NODE_ENV === 'development', // Log queries only in development
      // Custom error handler for connection issues
      onconnectionerror: (err) => {
        console.error('Database connection error:', err.message);
        // The onconnectionerror handles errors that occur after the initial connection
        isConnected = false;
        dbEvents.emit('disconnected', err);
        
        // Attempt to reconnect after delay
        console.log('Attempting to reconnect to database...');
        setTimeout(() => {
          if (!isConnected) {
            initConnection();
          }
        }, RETRY_DELAY_MS);
      },
      // Handle closing the connection properly
      onclose: () => {
        console.log('Database connection closed');
      },
      // Maximum number of simultaneous connections
      max: 10,
      // Connection timeout in seconds
      timeout: 10,
      // Idle timeout in seconds
      idle_timeout: 120
    });
    
    // Test the connection with a simple query
    await sql`SELECT 1`;
    console.log('Database connection established successfully');
    
    // Update connection status and emit connection event
    isConnected = true;
    dbEvents.emit('connected');
    
    return sql;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      const delay = RETRY_DELAY_MS * nextRetry;
      
      console.error(`Database connection attempt ${nextRetry}/${MAX_RETRIES} failed: ${error.message}`);
      console.log(`Retrying in ${delay / 1000} seconds...`);
      
      // Wait for the specified delay before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      return initDbConnection(nextRetry);
    }
    
    // If we've exhausted all retries, log a detailed error and exit
    console.error('Failed to initialize database connection after multiple attempts:');
    console.error(`- Error type: ${error.name}`);
    console.error(`- Message: ${error.message}`);
    
    if (error.code) {
      console.error(`- Error code: ${error.code}`);
      // Log more specific guidance based on error code
      switch (error.code) {
        case 'ECONNREFUSED':
          console.error('- Database server appears to be down or not accepting connections');
          break;
        case 'ETIMEDOUT':
          console.error('- Connection timeout - check network or firewall settings');
          break;
        case 'ENOTFOUND':
          console.error('- Host not found - check DATABASE_URL for typos');
          break;
        case '28P01':
          console.error('- Authentication failed - check username/password');
          break;
        case '3D000':
          console.error('- Database does not exist');
          break;
        default:
          console.error('- Check database server logs for more information');
      }
    }
    
    process.exit(1); // Exit with error code
  }
}

// Initialize the connection
const initConnection = async () => {
  try {
    await initDbConnection();
  } catch (error) {
    console.error('Unexpected error during database initialization:', error.message);
    process.exit(1);
  }
};

// Start the initialization process
initConnection();

/**
 * Check if the database is currently connected
 * @returns {boolean} Connection status
 */
export function isDatabaseConnected() {
  return isConnected;
}

/**
 * Manually attempt to reconnect to the database
 * @returns {Promise<void>}
 */
export async function reconnectDatabase() {
  if (!isConnected) {
    console.log('Manually attempting to reconnect to database...');
    await initDbConnection();
  }
}

export default sql;