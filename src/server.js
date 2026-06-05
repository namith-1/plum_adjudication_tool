require('dotenv').config();

const app = require('./app');
const connectDatabase = require('./config/db');

const port = process.env.PORT || 4000;

async function startServer() {
  try {
    await connectDatabase();
  } catch (error) {
    console.warn(`MongoDB connection skipped: ${error.message}`);
  }

  app.listen(port, () => {
    console.log(`Claim API running on port ${port}`);
  });
}

startServer();
