import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { deal, placeCall, playCard, resolveTrick } from "../src/game/engine";
import type { GameState } from "../src/types";

type Client = { ws: WebSocket; seat: number; name: string };
type Room = { code: string; clients: Map<WebSocket, Client>; game: GameState; started: boolean };
const rooms = new Map<string, Room>();
const wss = new WebSocketServer({ port: Number(process.env.PORT ?? 8787) });

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

function broadcast(room: Room) {
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

function roomFor(ws: WebSocket) { for (const room of rooms.values()) if (room.clients.has(ws)) return room; }

wss.on("connection", ws => {
  send(ws, { type: "connected" });
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "create") {
        const room: Room = { code: code(), clients: new Map(), game: deal(), started: false };
        room.clients.set(ws, { ws, seat: 0, name: String(msg.name || "Играч 1") });
        rooms.set(room.code, room);
        send(ws, { type: "room", code: room.code, seat: 0 }); broadcast(room); return;
      }
      if (msg.type === "join") {
        const room = rooms.get(String(msg.code || "").toUpperCase());
        if (!room || room.clients.size >= 4) return send(ws, { type: "error", message: "Стаята е пълна или не съществува." });
        const used = new Set([...room.clients.values()].map(c => c.seat));
        const seat = [0,1,2,3].find(i => !used.has(i))!;
        room.clients.set(ws, { ws, seat, name: String(msg.name || `Играч ${seat+1}`) });
        room.game.players[seat].name = String(msg.name || `Играч ${seat+1}`);
        send(ws, { type: "room", code: room.code, seat }); broadcast(room); return;
      }
      const room = roomFor(ws); if (!room) return;
      const client = room.clients.get(ws)!;
      if (msg.type === "new_game") { room.game = deal(); room.game.players.forEach((p, i) => { const c = clientsBySeat(room, i); if (c) p.name = c.name; }); broadcast(room); return; }
      if (msg.type === "call") { room.game = placeCall(room.game, msg.call, client.seat); broadcast(room); return; }
      if (msg.type === "play") {
        room.game = playCard(room.game, msg.cardId, client.seat);
        broadcast(room);
        if (room.game.trickComplete) {
          const roomCode = room.code;
          setTimeout(() => {
            const current = rooms.get(roomCode);
            if (!current) return; // стаята е затворена междувременно
            current.game = resolveTrick(current.game);
            broadcast(current);
          }, 1500);
        }
        return;
      }
      if (msg.type === "start") { room.started = true; broadcast(room); return; }
    } catch { send(ws, { type: "error", message: "Невалидна заявка." }); }
  });
  ws.on("close", () => { const room = roomFor(ws); if (!room) return; room.clients.delete(ws); broadcast(room); if (!room.clients.size) rooms.delete(room.code); });
});
console.log("Belot online server listening on", process.env.PORT ?? 8787);
