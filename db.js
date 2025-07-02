import postgres from 'postgres'
import dotenv from 'dotenv';

dotenv.config();

let sql;

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
    },
    // Handle closing the connection properly
    onclose: () => {
      console.log('Database connection closed');
    }
  });
  
  console.log('Database connection established');
} catch (error) {
  console.error('Failed to initialize database connection:', error.message);
  process.exit(1); // Exit with error code
}

export default sql;