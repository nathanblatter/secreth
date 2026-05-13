import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const IS_PROD = process.env.NODE_ENV === 'production';

const DATABASE_URL = process.env.DATABASE_URL ??
  (IS_PROD
    ? 'postgresql://postgres:postgres@host.docker.internal:5432/secrethitler'
    : 'postgresql://postgres:postgres@localhost:5432/secrethitler');

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function initDb(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(50)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Idempotently add is_admin column to existing installs
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ
    `);

    await pool.query(`
      ALTER TABLE games ADD COLUMN IF NOT EXISTS lobby_opened_at TIMESTAMPTZ
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id            SERIAL PRIMARY KEY,
        room_code     VARCHAR(6) NOT NULL,
        host_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        player_count  INTEGER,
        winner        VARCHAR(20),
        win_condition VARCHAR(50),
        started_at    TIMESTAMPTZ DEFAULT NOW(),
        ended_at      TIMESTAMPTZ
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_players (
        id          SERIAL PRIMARY KEY,
        game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_name VARCHAR(50),
        role        VARCHAR(20),
        survived    BOOLEAN
      )
    `);

    // Seed the default admin user (idempotent — always ensures nate is admin)
    const hash = await bcrypt.hash('1amnathan', 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, is_admin)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (username) DO UPDATE SET is_admin = TRUE`,
      ['nate', hash]
    );

    console.log('[DB] Initialized');
  } catch (err) {
    console.error('[DB] Initialization failed:', err);
    process.exit(1);
  }
}
