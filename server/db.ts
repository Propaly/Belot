import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

/**
 * История на игрите в SQLite (вграденото node:sqlite, без външни зависимости).
 * Пази завършените (и заменените) игри заедно с пълната нотация, за да могат
 * да се преглеждат и replay-ват.
 */

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "belot-history.db");

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    finished_at TEXT,
    rounds      INTEGER NOT NULL,
    score0      INTEGER NOT NULL,
    score1      INTEGER NOT NULL,
    winner      INTEGER,
    players     TEXT NOT NULL,
    notation    TEXT NOT NULL
  );
`);

export type GameInput = {
    roomCode: string;
    rounds: number;
    score: [number, number];
    winner: 0 | 1 | null;
    finished: boolean;
    players: { seat: number; name: string }[];
    notation: string;
};

export type GameListItem = {
    id: number;
    roomCode: string;
    createdAt: string;
    finishedAt: string | null;
    rounds: number;
    score0: number;
    score1: number;
    winner: number | null;
    players: { seat: number; name: string }[];
};

export type GameDetail = GameListItem & { notation: string };

function rowToItem(row: Record<string, unknown>): GameListItem {
    return {
        id: Number(row.id),
        roomCode: String(row.room_code),
        createdAt: String(row.created_at),
        finishedAt: row.finished_at ? String(row.finished_at) : null,
        rounds: Number(row.rounds),
        score0: Number(row.score0),
        score1: Number(row.score1),
        winner: row.winner === null || row.winner === undefined ? null : Number(row.winner),
        players: JSON.parse(String(row.players)),
    };
}

export function saveGame(input: GameInput): number {
    const stmt = db.prepare(`
      INSERT INTO games
        (room_code, created_at, finished_at, rounds, score0, score1, winner, players, notation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
        input.roomCode,
        new Date().toISOString(),
        input.finished ? new Date().toISOString() : null,
        input.rounds,
        input.score[0],
        input.score[1],
        input.winner,
        JSON.stringify(input.players),
        input.notation
    );

    return Number(info.lastInsertRowid);
}

export function listGames(limit = 50): GameListItem[] {
    const rows = db
        .prepare(`
          SELECT id, room_code, created_at, finished_at, rounds, score0, score1, winner, players
          FROM games
          ORDER BY id DESC
          LIMIT ?
        `)
        .all(limit) as Record<string, unknown>[];

    return rows.map(rowToItem);
}

export function getGame(id: number): GameDetail | null {
    const row = db
        .prepare(`
          SELECT id, room_code, created_at, finished_at, rounds, score0, score1, winner, players, notation
          FROM games
          WHERE id = ?
        `)
        .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;
    return { ...rowToItem(row), notation: String(row.notation) };
}

export function historyCount(): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM games`).get() as { n: number };
    return Number(row.n);
}
