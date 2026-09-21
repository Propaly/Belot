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
// bidKey се сменя всеки път щом играчът направи НОВА обява - принуждава React
// да рестартира bubble-а от нулата, за да се вижда pop-анимацията всеки път.
function BidSlot({ entry, active, bidKey }: { entry?: GameState["bidHistory"][number]; active: boolean; bidKey: number }) {
  if (!active) return null;
  return <div key={bidKey} className={`bid-slot ${entry ? "has-bid" : ""}`}>{entry ? contractLabel(entry.call) : "—"}</div>;
}
function Avatar({ icon, onTurn }: { icon: string; onTurn: boolean }) {
  return <div className={`avatar ${onTurn ? "active-turn" : ""}`}>{icon}</div>;
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
  // Избор на отбор преди началото на играта.
  const [choosingLocalTeam, setChoosingLocalTeam] = useState(false);
  const [preferredTeam, setPreferredTeam] = useState<0 | 1>(0);

  const actor = mode === "online" ? seat : game.humanSeat;
  const human = game.players[actor];
  const sortedHumanHand = sortHand(human?.hand ?? [], game.contract);
  const latestBids = game.players.map(player => [...game.bidHistory].reverse().find(e => e.playerId === player.id));
  // За всеки играч - индекс в bidHistory на последната му обява (или -1).
  // Ползва се като React key, за да "изскача" балончето всеки път наново.
  const latestBidIndex = game.players.map(player => {
    for (let i = game.bidHistory.length - 1; i >= 0; i--) {
      if (game.bidHistory[i].playerId === player.id) return i;
    }
    return -1;
  });
  const announcements = game.players.map(player => getPlayerAnnouncements(game, player.id));

  // Кой е на ход в момента - показва се със светещ аватар + надпис.
  const actingSeat =
    game.phase === "bidding" ? game.biddingTurn :
    game.phase === "playing" && !game.trickComplete && !game.finished ? game.currentPlayer :
    null;

  useEffect(() => {
    if (mode !== "local" || game.phase !== "playing" || !game.trickComplete) return;
    const timer = setTimeout(() => setGame(current => resolveTrick(current)), 1500);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.trickComplete, game.trick.length]);

  useEffect(() => {
    if (mode !== "local" || game.phase !== "bidding" || game.biddingTurn === game.humanSeat) return;
    const timer = setTimeout(() => setGame(current => botBid(current)), 500);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.biddingTurn, game.bidHistory.length, game.humanSeat]);

  useEffect(() => {
    if (mode !== "local" || game.phase !== "playing" || game.finished || game.trickComplete || game.currentPlayer === game.humanSeat) return;
    const timer = setTimeout(() => setGame(current => botMove(current)), 650);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.currentPlayer, game.finished, game.trick.length, game.trickComplete, game.humanSeat]);

  useEffect(() => () => ws?.close(), [ws]);

  const bidRank = (call: Call) => ({ "♣":1, "♦":2, "♥":3, "♠":4, NO_TRUMP:5, ALL_TRUMP:6, PASS:0, CONTRA:0, RECONTRA:0 } as Record<Call,number>)[call];

  function openOnline() {
    setError("");
    const socket = new WebSocket(import.meta.env.VITE_WS_URL || (location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.hostname}:8787`));
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
  // seat = предпочитано МЯСТО (0 или 1) - сървърът пробва първо него,
  // после чифтовото му (същия отбор), преди да падне на друго свободно.
  function createRoom() { send({ type:"create", name: name.trim() || "Играч", seat: preferredTeam }); }
  function joinRoom() { send({ type:"join", code: roomCode.trim(), name: name.trim() || "Играч", seat: preferredTeam }); }
  function handleCard(card: Card) { if (mode === "online") send({type:"play", cardId:card.id}); else setGame(current => playCard(current, card.id)); }
  function handleBid(call: Call) { if (mode === "online") send({type:"call", call}); else setGame(current => placeCall(current, call)); }
  function newGame() { if (mode === "online") send({type:"new_game"}); else setGame(deal(game.humanSeat)); }
  function startLocal(teamSeat: 0 | 1) { setGame(deal(teamSeat)); setMode("local"); setChoosingLocalTeam(false); }

  const isBidding = game.phase === "bidding";
  const isHumanTurnToBid = isBidding && game.biddingTurn === actor;
  const isHumanTurnToPlay = game.phase === "playing" && game.currentPlayer === actor;
  const canContra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 1 && game.players[game.highestBid.playerId].team !== game.players[actor].team;
  const canRecontra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 2 && game.players[game.highestBid.playerId].team === game.players[actor].team;
  const availableBidOptions: Call[] = isHumanTurnToBid ? [...CONTRACT_OPTIONS.filter(call => !game.highestBid || bidRank(call) > bidRank(game.highestBid.contract) || (call === "NO_TRUMP" && game.highestBid.contract === "NO_TRUMP")), "PASS", ...(canContra ? ["CONTRA" as Call] : []), ...(canRecontra ? ["RECONTRA" as Call] : [])] : [];

  const playerLabels = useMemo(() => game.players.map((p,i) => p.name || (i===seat ? name : `Играч ${i+1}`)), [game.players, seat, name]);

  if (!mode && !choosingLocalTeam) return <main className="table"><div className="modal"><div className="modal-content"><h1>♠ БЕЛОТ</h1><p>Избери как искаш да играеш.</p><button className="new-game" onClick={() => setChoosingLocalTeam(true)}>Сам с ботове</button><button className="new-game" onClick={() => { setMode("online"); openOnline(); }}>Онлайн с приятели</button></div></div></main>;

  if (!mode && choosingLocalTeam) return <main className="table"><div className="modal"><div className="modal-content"><h2>Избери отбор</h2><p>Партньорът ти ще е точно срещу теб на масата.</p><button className="new-game" onClick={() => startLocal(0)}>Отбор 1 (ти + партньор долу/горе)</button><button className="new-game" onClick={() => startLocal(1)}>Отбор 2 (ти + партньор ляво/дясно)</button><button className="new-game team-back" onClick={() => setChoosingLocalTeam(false)}>← Назад</button></div></div></main>;

  if (mode === "online" && !onlineCode) return <main className="table"><div className="modal"><div className="modal-content"><h2>Онлайн стая</h2><input className="room-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Твоето име"/><p className="team-label">Предпочитан отбор:</p><div className="team-pick"><button className={`team-button ${preferredTeam===0?"selected":""}`} onClick={()=>setPreferredTeam(0)}>Отбор 1</button><button className={`team-button ${preferredTeam===1?"selected":""}`} onClick={()=>setPreferredTeam(1)}>Отбор 2</button></div><button className="new-game" onClick={createRoom}>Създай стая</button><div className="divider">или</div><input className="room-input" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="Код на стаята"/><button className="new-game" onClick={joinRoom}>Влез в стая</button>{error && <p className="error">{error}</p>}</div></div></main>;

  // Позициите на масата се смятат спрямо избраното от играча място
  // (actor), а не спрямо фиксирано място 0 - това реализира избора на отбор:
  // партньорът винаги е "горе", а другите двама - вляво/вдясно, по реда на игра.
  const partnerSeat = (actor + 2) % 4;
  const leftSeat = (actor + 1) % 4;
  const rightSeat = (actor + 3) % 4;
  // Позиция на изиграна карта на масата спрямо самия играч (0=пред него,
  // 1=ляво, 2=партньор/горе, 3=дясно) - ползва съществуващите CSS класове.
  const relativeSeat = (id: number) => (id - actor + 4) % 4;

  return <main className="table">
    <header className="header"><h1>♠ БЕЛОТ</h1><div className="score"><span>Наши: <b>{formatScore(game.score[0])}</b></span><span>Те: <b>{formatScore(game.score[1])}</b></span>{mode === "online" && <span>Стая: <b>{onlineCode}</b> · {connected}/4</span>}</div></header>
    <section className="game-area">
      {[partnerSeat,leftSeat,rightSeat].map(id => <div key={id} className={`opponent ${id===partnerSeat?"top":id===leftSeat?"left":"right"} ${id===actingSeat?"active-turn":""}`}><div className="player-info"><Avatar icon={mode==="online"?"👤":"🤖"} onTurn={id===actingSeat}/><strong>{playerLabels[id]}</strong><BidSlot entry={latestBids[id]} active={isBidding} bidKey={latestBidIndex[id]}/></div>{id===actingSeat && <small className="turn-label">На ход</small>}<AnnouncementList announcements={announcements[id]}/><div className={id===partnerSeat?"back-cards":"vertical-cards"}>{game.players[id].hand.map((_card,i)=><div className="back-card" key={i}>🂠</div>)}</div></div>)}
      <div className="center">
        {game.phase === "playing" && <div className="trick">{game.trick.map(played => <div key={played.card.id} className={`played-card seat-${relativeSeat(played.playerId)} ${(played.card.suit === "♥" || played.card.suit === "♦") ? "red" : ""}`}><span>{played.card.rank}</span><span>{played.card.suit}</span></div>)}</div>}
        {isHumanTurnToBid && <div className="bid-panel">{availableBidOptions.map(call=><button key={call} className="bid-button" onClick={()=>handleBid(call)}>{contractLabel(call)}</button>)}</div>}
        <div className="message">{game.message}</div>
      </div>
      {game.phase === "playing" && <div className="contract contract-corner">Коз: <strong>{game.contract ? contractLabel(game.contract) : "—"}</strong>{game.multiplier>1 && <strong className="multiplier-badge"> ×{game.multiplier}</strong>}{game.declarer!==null && <div className="current-bid">Обявил: {playerLabels[game.declarer]}</div>}</div>}
      <div className={`player ${actor===actingSeat?"active-turn":""}`}><div className="hand">{sortedHumanHand.map(card=><CardView key={card.id} card={card} playable={isHumanTurnToPlay} onClick={()=>handleCard(card)}/>)}</div><div className="player-name"><div className="player-info"><Avatar icon="👤" onTurn={actor===actingSeat}/><strong>{playerLabels[actor]}</strong><BidSlot entry={latestBids[actor]} active={isBidding} bidKey={latestBidIndex[actor]}/></div>{isHumanTurnToPlay&&<small> — ТВОЙ ХОД</small>}{isHumanTurnToBid&&<small> — ТИ НАДДАВАШ</small>}</div><AnnouncementList announcements={announcements[actor]}/></div>
    </section>
    {game.finished && <div className="modal"><div className="modal-content"><h2>🏆 КРАЙ НА ИГРАТА</h2><h3>{formatScore(game.score[0])} : {formatScore(game.score[1])}</h3><button className="new-game" onClick={newGame}>Нова игра</button></div></div>}
  </main>;
}
export default App;
