// server/setup-db.js - creates the tables in the database from DATABASE_URL.
//   npm run db:setup
import { pool, setupSchema } from './db.js';

try {
    await setupSchema();
    const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables
                                       WHERE table_schema = current_schema() ORDER BY table_name`);
    console.log('Database ready. Tables:', rows.map((r) => r.table_name).join(', '));
} catch (err) {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
