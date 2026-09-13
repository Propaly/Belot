import { useEffect, useMemo, useState } from "react";
import type { Call, Card, GameState } from "./types";
import { botBid, botMove, contractLabel, deal, placeCall, playCard, resolveTrick, getPlayerAnnouncements, sortHand } from "./game/engine";
import "./styles.css";

const CONTRACT_OPTIONS: Call[] = ["♣", "♦", "♥", "♠", "NO_TRUMP", "ALL_TRUMP"];
type Mode = "local" | "online";

type ServerMessage = { type: string; code?: string; seat?: number; game?: GameState; message?: string; connected?: number; players?: { seat:number; name:string }[] };

function CardView({ card, playable, onClick }: { card: Card; playable: boolean; onClick: () => void }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return <button className={`card ${red ? "red" : ""} ${playable ? "playable" : ""}`} onClick={onClick} disabled={!playable}><span>{card.rank}</span><span>{card.suit}</span></button>;
}
function BidSlot({ entry, active }: { entry?: GameState["bidHistory"][number]; active: boolean }) {
  if (!active) return null;
  return <div className={`bid-slot ${entry ? "has-bid" : ""}`}>{entry ? contractLabel(entry.call) : "—"}</div>;
}
function AnnouncementList({ announcements }: { announcements: string[] }) {
  if (!announcements.length) return null;
  return <div className="announcements" aria-label="Анонси">{announcements.map(a => <span className="announcement" key={a}>{a}</span>)}</div>;
}

function formatScore(value: number): string {
  return value < 0 ? `-${Math.abs(value)}` : `${value}`;
}

function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [game, setGame] = useState<GameState>(() => deal());
  const [name, setName] = useState("Играч");
  const [roomCode, setRoomCode] = useState("");
  const [onlineCode, setOnlineCode] = useState("");
  const [seat, setSeat] = useState(0);
  const [connected, setConnected] = useState(1);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [error, setError] = useState("");

  const human = game.players[mode === "online" ? seat : 0];
  const sortedHumanHand = sortHand(human?.hand ?? [], game.contract);
  const latestBids = game.players.map(player => [...game.bidHistory].reverse().find(e => e.playerId === player.id));
  const announcements = game.players.map(player => getPlayerAnnouncements(game, player.id));

  useEffect(() => {
    if (mode !== "local" || game.phase !== "playing" || !game.trickComplete) return;
    const timer = setTimeout(() => setGame(current => resolveTrick(current)), 1500);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.trickComplete, game.trick.length]);

  useEffect(() => {
    if (mode !== "local" || game.phase !== "bidding" || game.biddingTurn === 0) return;
    const timer = setTimeout(() => setGame(current => botBid(current)), 500);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.biddingTurn, game.bidHistory.length]);

  useEffect(() => {
    if (mode !== "local" || game.phase !== "playing" || game.finished || game.trickComplete || game.currentPlayer === 0) return;
    const timer = setTimeout(() => setGame(current => botMove(current)), 650);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.currentPlayer, game.finished, game.trick.length, game.trickComplete]);

  useEffect(() => () => ws?.close(), [ws]);

  const bidRank = (call: Call) => ({ "♣":1, "♦":2, "♥":3, "♠":4, NO_TRUMP:5, ALL_TRUMP:6, PASS:0, CONTRA:0, RECONTRA:0 } as Record<Call,number>)[call];

  function openOnline() {
    setError("");
    const socket = new WebSocket(import.meta.env.VITE_WS_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8787`);
    socket.onmessage = event => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === "room") { setOnlineCode(msg.code || ""); setSeat(msg.seat ?? 0); }
      if (msg.type === "state" && msg.game) { setSeat(msg.seat ?? seat); setGame(msg.game); setConnected(msg.connected ?? 1); }
      if (msg.type === "error") setError(msg.message || "Грешка");
    };
    socket.onerror = () => setError("Не може да се свърже онлайн сървърът.");
    setWs(socket);
  }
  function send(payload: unknown) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
  function createRoom() { send({ type:"create", name: name.trim() || "Играч" }); }
  function joinRoom() { send({ type:"join", code: roomCode.trim(), name: name.trim() || "Играч" }); }
  function handleCard(card: Card) { if (mode === "online") send({type:"play", cardId:card.id}); else setGame(current => playCard(current, card.id)); }
  function handleBid(call: Call) { if (mode === "online") send({type:"call", call}); else setGame(current => placeCall(current, call)); }
  function newGame() { if (mode === "online") send({type:"new_game"}); else setGame(deal()); }

  const isBidding = game.phase === "bidding";
  const actor = mode === "online" ? seat : 0;
  const isHumanTurnToBid = isBidding && game.biddingTurn === actor;
  const isHumanTurnToPlay = game.phase === "playing" && game.currentPlayer === actor;
  const canContra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 1 && game.players[game.highestBid.playerId].team !== game.players[actor].team;
  const canRecontra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 2 && game.players[game.highestBid.playerId].team === game.players[actor].team;
  const availableBidOptions: Call[] = isHumanTurnToBid ? [...CONTRACT_OPTIONS.filter(call => !game.highestBid || bidRank(call) > bidRank(game.highestBid.contract) || (call === "NO_TRUMP" && game.highestBid.contract === "NO_TRUMP")), "PASS", ...(canContra ? ["CONTRA" as Call] : []), ...(canRecontra ? ["RECONTRA" as Call] : [])] : [];

  const playerLabels = useMemo(() => game.players.map((p,i) => p.name || (i===seat ? name : `Играч ${i+1}`)), [game.players, seat, name]);

  if (!mode) return <main className="table"><div className="modal"><div className="modal-content"><h1>♠ БЕЛОТ</h1><p>Избери как искаш да играеш.</p><button className="new-game" onClick={() => setMode("local")}>Сам с ботове</button><button className="new-game" onClick={() => { setMode("online"); openOnline(); }}>Онлайн с приятели</button></div></div></main>;

  if (mode === "online" && !onlineCode) return <main className="table"><div className="modal"><div className="modal-content"><h2>Онлайн стая</h2><input className="room-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Твоето име"/><button className="new-game" onClick={createRoom}>Създай стая</button><div className="divider">или</div><input className="room-input" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="Код на стаята"/><button className="new-game" onClick={joinRoom}>Влез в стая</button>{error && <p className="error">{error}</p>}</div></div></main>;

  return <main className="table">
    <header className="header"><h1>♠ БЕЛОТ</h1><div className="score"><span>Наши: <b>{formatScore(game.score[0])}</b></span><span>Те: <b>{formatScore(game.score[1])}</b></span>{mode === "online" && <span>Стая: <b>{onlineCode}</b> · {connected}/4</span>}</div></header>
    <section className="game-area">
      {[2,1,3].map(id => <div key={id} className={`opponent ${id===2?"top":id===1?"left":"right"}`}><div className="player-info"><div className="avatar">{mode==="online"?"👤":"🤖"}</div><strong>{playerLabels[id]}</strong><BidSlot entry={latestBids[id]} active={isBidding}/></div><AnnouncementList announcements={announcements[id]}/><div className={id===2?"back-cards":"vertical-cards"}>{game.players[id].hand.map((card,i)=><div className="back-card" key={i}>🂠</div>)}</div></div>)}
      <div className="center">
        {game.phase === "playing" && <div className="trick">{game.trick.map(played => <div key={played.card.id} className={`played-card seat-${played.playerId} ${(played.card.suit === "♥" || played.card.suit === "♦") ? "red" : ""}`}><span>{played.card.rank}</span><span>{played.card.suit}</span></div>)}</div>}
        {isHumanTurnToBid && <div className="bid-panel">{availableBidOptions.map(call=><button key={call} className="bid-button" onClick={()=>handleBid(call)}>{contractLabel(call)}</button>)}</div>}
        <div className="message">{game.message}</div>
      </div>
      {game.phase === "playing" && <div className="contract contract-corner">Коз: <strong>{game.contract ? contractLabel(game.contract) : "—"}</strong>{game.multiplier>1 && <strong className="multiplier-badge"> ×{game.multiplier}</strong>}{game.declarer!==null && <div className="current-bid">Обявил: {playerLabels[game.declarer]}</div>}</div>}
      <div className="player"><div className="hand">{sortedHumanHand.map(card=><CardView key={card.id} card={card} playable={isHumanTurnToPlay} onClick={()=>handleCard(card)}/>)}</div><div className="player-name"><div className="player-info"><span className="avatar">👤</span><strong>{playerLabels[actor]}</strong><BidSlot entry={latestBids[actor]} active={isBidding}/></div>{isHumanTurnToPlay&&<small> — ТВОЙ ХОД</small>}{isHumanTurnToBid&&<small> — ТИ НАДДАВАШ</small>}</div><AnnouncementList announcements={announcements[actor]}/></div>
    </section>
    {game.finished && <div className="modal"><div className="modal-content"><h2>🏆 КРАЙ НА ИГРАТА</h2><h3>{formatScore(game.score[0])} : {formatScore(game.score[1])}</h3><button className="new-game" onClick={newGame}>Нова игра</button></div></div>}
  </main>;
}
export default App;
