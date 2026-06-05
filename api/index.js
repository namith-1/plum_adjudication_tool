require('dotenv').config();

const app = require('../src/app');
const connectDatabase = require('../src/config/db');

let databasePromise;

module.exports = async function handler(req, res) {
  if (!databasePromise) {
    databasePromise = connectDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  try {
    await databasePromise;
  } catch (error) {
    res.status(500).json({
      error: 'MongoDB connection failed',
      details: error.message,
    });
    return;
  }

  app(req, res);
};
