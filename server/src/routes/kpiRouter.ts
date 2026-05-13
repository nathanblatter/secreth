import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  if (req.headers['x-kpi-api-key'] !== process.env.KPI_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const [gamesRes, playersRes, winRateRes, returnRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_games,
          COUNT(*) FILTER (WHERE ended_at IS NOT NULL) AS completed_games,
          AVG(
            CASE WHEN ended_at IS NOT NULL AND lobby_opened_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (started_at - lobby_opened_at))
              ELSE NULL
            END
          ) AS avg_lobby_wait_seconds
        FROM games
        WHERE started_at > NOW() - INTERVAL '30 days'
      `),
      pool.query(`
        SELECT AVG(player_count) AS avg_players FROM (
          SELECT game_id, COUNT(*) AS player_count
          FROM game_players
          GROUP BY game_id
        ) sub
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE winner = 'fascists')::float
          / NULLIF(COUNT(*) FILTER (WHERE ended_at IS NOT NULL), 0) AS fascist_win_rate
        FROM games
        WHERE started_at > NOW() - INTERVAL '30 days'
      `),
      pool.query(`
        SELECT COUNT(DISTINCT id)::float / NULLIF(
          (SELECT COUNT(*) FROM users WHERE created_at < NOW() - INTERVAL '7 days'), 0
        ) AS return_rate
        FROM users
        WHERE last_seen_at > NOW() - INTERVAL '7 days'
          AND created_at < NOW() - INTERVAL '7 days'
      `),
    ]);

    const g = gamesRes.rows[0] || {};
    const p = playersRes.rows[0] || {};
    const fw = winRateRes.rows[0] || {};
    const rr = returnRes.rows[0] || {};

    return res.json({
      project: 'secret_hitler',
      generated_at: new Date().toISOString(),
      kpis: {
        return_rate_7d: { value: parseFloat((parseFloat(rr.return_rate || 0) * 100).toFixed(1)), label: '7-Day Return Rate', unit: '%' },
        completion_rate: { value: parseInt(g.total_games) > 0 ? parseFloat((parseInt(g.completed_games) / parseInt(g.total_games) * 100).toFixed(1)) : 0, label: 'Game Completion Rate', unit: '%' },
        avg_players_per_game: { value: parseFloat(parseFloat(p.avg_players || 0).toFixed(1)), label: 'Avg Players / Game', unit: 'players' },
        fascist_win_rate: { value: parseFloat((parseFloat(fw.fascist_win_rate || 0) * 100).toFixed(1)), label: 'Fascist Win Rate', unit: '%' },
        avg_lobby_wait_seconds: { value: parseFloat(parseFloat(g.avg_lobby_wait_seconds || 0).toFixed(0)), label: 'Avg Lobby Wait', unit: 'seconds' },
        total_games_30d: { value: parseInt(g.total_games || 0), label: 'Total Games (30d)', unit: 'games' },
      }
    });
  } catch (err) {
    console.error('KPI error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
