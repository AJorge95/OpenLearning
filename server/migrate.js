import { db, migrateDatabase } from './db.js';

migrateDatabase();
console.log('Database migrations are up to date.');
db.close();
