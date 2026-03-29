'use strict';

require('dotenv').config();

if (!process.env.CDA_SOURCE_URL) {
  throw new Error('Missing required environment variable: CDA_SOURCE_URL');
}

const parsedInterval = parseInt(process.env.BACKUP_INTERVAL_MS, 10);

const config = {
  sourceUrl: process.env.CDA_SOURCE_URL,
  backupDestPath: process.env.BACKUP_DEST_PATH || './backups',
  backupIntervalMs: Number.isFinite(parsedInterval) ? parsedInterval : 3600000,
};

module.exports = config;
