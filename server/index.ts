import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chooseBid, chooseCard, deal, placeCall, playCard, resolveTrick } from "../src/game/engine.ts";
import { GameRecorder } from "../src/game/history.ts";
import { encodeGameLog } from "../src/game/notation.ts";
import { getGame, listGames, saveGame } from "./db.ts";
import type { GameState } from "../src/types.ts";

type Client = { ws: WebSocket; seat: number; name: string };
type Room = { code: string; clients: Map<WebSocket, Client>; game: GameState; started: boolean; recorder: GameRecorder; saved: boolean };
const rooms = new Map<string, Room>();

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), "dist");
// Паузи в играта (конфигурируеми, за да могат тестовете да ги намалят).
const RESOLVE_DELAY_MS = Number(process.env.RESOLVE_DELAY_MS ?? 1500);
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 600);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Същият порт обслужва и WebSocket играта, и статичното frontend от dist/
// (SPA fallback към index.html). Така един тунел (напр. ngrok) стига за
// цялата игра. Ако dist липсва, просто няма HTTP UI, но WS работи.
const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // ---- История (SQLite) API ----
    if (pathname === "/api/history") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
      const from = url.searchParams.get("from") ?? undefined;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(listGames(limit, offset, from || undefined)));
      return;
    }
    if (pathname.startsWith("/api/history/")) {
      const id = Number(pathname.split("/").pop());
      const game = Number.isFinite(id) ? getGame(id) : null;
      res.writeHead(game ? 200 : 404, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(game ? JSON.stringify(game) : JSON.stringify({ error: "not found" }));
      return;
    }

    const target = pathname === "/" ? "/index.html" : pathname;
    const filePath = resolve(DIST, "." + target.replace(/\\/g, "/"));

    let file = filePath;
    let data: Buffer;
    try {
      if (!filePath.startsWith(DIST)) throw new Error("forbidden");
      data = await readFile(filePath);
    } catch {
      file = join(DIST, "index.html");
      data = await readFile(file);
    }

    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => {
  console.log("Belot server (HTTP + WebSocket) listening on", PORT);
});

function code() { return randomBytes(3).toString("hex").toUpperCase(); }
function send(ws: WebSocket, payload: unknown) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function publicGameFor(room: Room, seat: number): GameState {
  const clone = structuredClone(room.game) as GameState;
  clone.players = clone.players.map((p) => ({
    ...p,
    hand: p.id === seat ? p.hand : p.hand.map((c) => ({ id: c.id, suit: "♠", rank: "7" as const })),
  }));
  return clone;
}

// Имената се държат в клиентите, а не в GameState. Всяко placeCall/
// resolveTrick създава нови играчи с подразбиращи се имена, затова преди
// всяко излъчване ги презаписваме от свързаните клиенти по седалки - иначе
// имената се "разместват" след ново раздаване или 4 паса.
function syncNames(room: Room) {
  for (const c of room.clients.values()) {
    const p = room.game.players[c.seat];
    if (p) p.name = c.name;
  }
}

function broadcast(room: Room) {
  syncNames(room);
  const clients = [...room.clients.values()];
  for (const c of clients) {
    send(c.ws, {
      type: "state",
      seat: c.seat,
      game: publicGameFor(room, c.seat),
      players: clients.map(x => ({ seat: x.seat, name: x.name })),
      connected: clients.length,
    });
  }
}
function clientsBySeat(room: Room, seat: number) { return [...room.clients.values()].find(c => c.seat === seat); }

// Записва текущата игра в SQLite (нотация + резултат). Извиква се при
// завършване и при започване на нова игра, за да не се губи история.
function persistRoom(room: Room) {
  if (!room.recorder.dealCount) return;
  if (room.saved) return; // вече записана - няма двойни записи

  const players = [0, 1, 2, 3].map((seat) => {
    const c = clientsBySeat(room, seat);
    return { seat, name: c?.name ?? room.game.players[seat]?.name ?? `Играч ${seat + 1}` };
  });

  const finished = room.game.finished;
  const score: [number, number] = [...room.game.score] as [number, number];

  try {
    saveGame({
      roomCode: room.code,
      rounds: room.recorder.dealCount,
      score,
      winner: finished ? (score[0] >= score[1] ? 0 : 1) : null,
      finished,
      players,
      notation: encodeGameLog(room.recorder.log(`room ${room.code}`)),
    });
    room.saved = true;
  } catch (err) {
    console.error("Неуспешен запис в историята:", err);
  }
}

// Едно действие на бот за дадена седалка (ползва се, когато на тази
// седалка няма свързан клиент, за да не "виси" играта).
function botStep(room: Room, seat: number) {
  if (room.game.phase === "bidding") {
    const call = chooseBid(room.game, seat);
    room.recorder.observe(room.game);
    room.recorder.bid(seat, call);
    room.game = placeCall(room.game, call, seat);
    room.recorder.observe(room.game);
  } else if (room.game.phase === "playing" && !room.game.trickComplete) {
    const cardId = chooseCard(room.game, seat);
    if (!cardId) return;
    room.recorder.observe(room.game);
    room.recorder.play(seat, cardId);
    room.game = playCard(room.game, cardId, seat);
    room.recorder.observe(room.game);
  }
}

// След всяка промяна: ако взятката е завършена -> резолвване след пауза;
// ако е ред на седалка без клиент -> бот играе вместо нея. Така играта
// не блокира, когато някой не се е присъединил или е излязъл.
function afterChange(room: Room) {
  if (room.game.finished) {
    persistRoom(room);
    return;
  }

  // Не включваме ботове, преди хората да са влезли - играта просто чака
  // играчите. Ботовете се активират едва след като стаята е стартирала
  // (всичките 4 седалки са заети или е получен "start"), за да не се
  // изиграе сама, докато никой още не е влязъл.
  if (!room.started) return;

  const code = room.code;

  if (room.game.trickComplete) {
    setTimeout(() => {
      const cur = rooms.get(code);
      if (!cur || !cur.game.trickComplete) return;
      const dealOver = cur.game.players.every((p) => p.hand.length === 0);
      cur.game = resolveTrick(cur.game);
      if (dealOver) cur.recorder.endDeal(cur.game);
      broadcast(cur);
      afterChange(cur);
    }, RESOLVE_DELAY_MS);
    return;
  }

  const seat =
    room.game.phase === "bidding"
      ? room.game.biddingTurn
      : room.game.currentPlayer;

  if (clientsBySeat(room, seat)) return; // ред е на истински играч

  setTimeout(() => {
    const cur = rooms.get(code);
    if (!cur) return;
    const s =
      cur.game.phase === "bidding"
        ? cur.game.biddingTurn
        : cur.game.trickComplete
          ? null
          : cur.game.currentPlayer;
    if (s === null || clientsBySeat(cur, s)) return;
    botStep(cur, s);
    broadcast(cur);
    afterChange(cur);
  }, BOT_DELAY_MS);
}

// Избира свободно място, като първо пробва предпочитаното (и чифтовото
// му място - същия отбор), преди да падне на което и да е друго свободно.
// Отбор 1 = места 0 и 2, Отбор 2 = места 1 и 3.
function pickSeat(room: Room, preferred?: number): number | undefined {
  const used = new Set([...room.clients.values()].map(c => c.seat));
  const candidates =
    preferred !== undefined && preferred >= 0 && preferred <= 3
      ? [preferred, (preferred + 2) % 4, ...[0, 1, 2, 3].filter(s => s !== preferred && s !== (preferred + 2) % 4)]
      : [0, 1, 2, 3];
  return candidates.find(s => !used.has(s));
}

function roomFor(ws: WebSocket) { for (const room of rooms.values()) if (room.clients.has(ws)) return room; }

wss.on("connection", ws => {
  send(ws, { type: "connected" });
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "create") {
        const game = deal();
        const recorder = new GameRecorder(Date.now() >>> 0, 0);
        recorder.observe(game);
        const room: Room = { code: code(), clients: new Map(), game, started: false, recorder, saved: false };
        const seat = pickSeat(room, msg.seat) ?? 0;
        room.clients.set(ws, { ws, seat, name: String(msg.name || "Играч 1") });
        rooms.set(room.code, room);
        send(ws, { type: "room", code: room.code, seat }); broadcast(room); afterChange(room); return;
      }
      if (msg.type === "join") {
        const room = rooms.get(String(msg.code || "").toUpperCase());
        if (!room || room.clients.size >= 4) return send(ws, { type: "error", message: "Стаята е пълна или не съществува." });
        const seat = pickSeat(room, msg.seat);
        if (seat === undefined) return send(ws, { type: "error", message: "Стаята е пълна." });
        room.clients.set(ws, { ws, seat, name: String(msg.name || `Играч ${seat+1}`) });
        if (room.clients.size === 4) room.started = true; // всички седнаха - играта започва
        send(ws, { type: "room", code: room.code, seat }); broadcast(room); afterChange(room); return;
      }
      const room = roomFor(ws); if (!room) return;
      const client = room.clients.get(ws)!;
      if (msg.type === "new_game") {
        persistRoom(room); // (no-op if already saved)
        room.game = deal();
        room.recorder = new GameRecorder(Date.now() >>> 0, 0);
        room.recorder.observe(room.game);
        room.saved = false;
        broadcast(room); afterChange(room); return;
      }
      if (msg.type === "call") {
        room.recorder.observe(room.game);
        room.recorder.bid(client.seat, msg.call);
        room.game = placeCall(room.game, msg.call, client.seat);
        room.recorder.observe(room.game);
        broadcast(room); afterChange(room); return;
      }
      if (msg.type === "play") {
        room.recorder.observe(room.game);
        room.recorder.play(client.seat, msg.cardId);
        room.game = playCard(room.game, msg.cardId, client.seat);
        room.recorder.observe(room.game);
        broadcast(room); afterChange(room);
        return;
      }
      if (msg.type === "start") { room.started = true; broadcast(room); afterChange(room); return; }
    } catch { send(ws, { type: "error", message: "Невалидна заявка." }); }
  });
  ws.on("close", () => {
    const room = roomFor(ws);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size) {
      broadcast(room);
      afterChange(room);
    } else {
      persistRoom(room);
      rooms.delete(room.code);
    }
  });
});
console.log("Belot online server listening on", process.env.PORT ?? 8787);
