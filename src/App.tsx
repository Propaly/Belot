import { useEffect, useMemo, useState } from "react";
import type { Call, Card, GameState } from "./types";
import { botBid, botMove, canPlayCard, chooseBid, chooseCard, contractLabel, deal, legalCalls, nextPlayer, placeCall, playCard, resolveTrick, getPlayerAnnouncements, sortHand } from "./game/engine";
import History from "./History";
import "./styles.css";

const CONTRACT_OPTIONS: Call[] = ["♣", "♦", "♥", "♠", "NO_TRUMP", "ALL_TRUMP"];
type Mode = "local" | "online" | "spectate";
type SpectateStrategy = "smart" | "chaos";

type ServerMessage = { type: string; code?: string; seat?: number; game?: GameState; message?: string; connected?: number; players?: { seat:number; name:string }[] };

function CardView({ card, playable, onClick }: { card: Card; playable: boolean; onClick: () => void }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return <button className={`card ${red ? "red" : ""} ${playable ? "playable" : ""}`} onClick={onClick} disabled={!playable}><span>{card.rank}</span><span>{card.suit}</span></button>;
}
// Показва обява/договор, като оцветява цветовете на боите (♥♦ червени),
// за да се различават лесно от черните (♠♣) - иначе всички изглеждат
// еднакво тъмни върху златния балон до аватара.
function CallLabel({ call }: { call: Call }) {
  if (call === "♥" || call === "♦") return <span className="suit-red">{call}</span>;
  if (call === "♠" || call === "♣") return <span className="suit-black">{call}</span>;
  return <>{contractLabel(call)}</>;
}
// bidKey се сменя всеки път щом играчът направи НОВА обява - принуждава React
// да рестартира bubble-а от нулата, за да се вижда pop-анимацията всеки път.
function BidSlot({ entry, active, bidKey }: { entry?: GameState["bidHistory"][number]; active: boolean; bidKey: number }) {
  if (!active) return null;
  return <div key={bidKey} className={`bid-slot ${entry ? "has-bid" : ""}`}>{entry ? <CallLabel call={entry.call} /> : "—"}</div>;
}
function Avatar({ icon, onTurn, first }: { icon: string; onTurn: boolean; first?: boolean }) {
  return (
    <div className={`avatar-wrap ${first ? "is-first" : ""}`}>
      <div className={`avatar ${onTurn ? "active-turn" : ""}`}>{icon}</div>
      {first && <span className="first-badge" title="Ще започне пръв (първи ход след избора на коз)">1</span>}
    </div>
  );
}
function AnnouncementList({ announcements }: { announcements: string[] }) {
  if (!announcements.length) return null;
  return <div className="announcements" aria-label="Анонси">{announcements.map(a => <span className="announcement" key={a}>{a}</span>)}</div>;
}

function formatScore(value: number): string {
  return value < 0 ? `-${Math.abs(value)}` : `${value}`;
}

// Действия на агент в тестовия (spectate) режим. "smart" ползва същите
// решения като ботовете; "chaos" играе случайно, но винаги легално -
// така се генерират странни състояния и се ловят UI/движкови бъгове.
function spectateCall(state: GameState, strategy: SpectateStrategy): Call {
  const seat = state.biddingTurn;
  if (strategy === "smart") return chooseBid(state, seat);

  const options = legalCalls(state, seat);
  if (!options.length) return "PASS";
  return options[Math.floor(Math.random() * options.length)];
}

function spectateCard(state: GameState, strategy: SpectateStrategy): string | null {
  const seat = state.currentPlayer;
  if (strategy === "smart") return chooseCard(state, seat);

  const legal = state.players[seat].hand.filter(card => canPlayCard(state, card));
  if (!legal.length) return null;
  return legal[Math.floor(Math.random() * legal.length)].id;
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
  // Тестов режим: агенти играят сами на всички места, за да се ловят
  // бъгове в реалния UI. strategy/speed се управляват от панела.
  const [spectateStrategy, setSpectateStrategy] = useState<SpectateStrategy>("smart");
  const [spectateSpeed, setSpectateSpeed] = useState(220);
  const [spectateGames, setSpectateGames] = useState(1);
  // Пазим последната завършена взятка, за да можем да я "преиграем" след
  // като бъде изчистена от масата.
  const [lastTrick, setLastTrick] = useState<GameState["trick"]>([]);
  const [replayTrick, setReplayTrick] = useState<GameState["trick"] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

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

  // Кой ще открие играта (първи ход) след като се избере коз. Знае се
  // още по време на наддаването, защото зависи само от раздаващия -
  // затова маркираме този играч още докато се избира боя.
  const openingLeader = nextPlayer(game.dealer);
  const showFirstLead = game.phase === "bidding";

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

  // ===== Тестов режим: агенти играят на ВСИЧКИ места =====
  useEffect(() => {
    if (mode !== "spectate" || game.phase !== "bidding") return;
    const timer = setTimeout(() => setGame(current => {
      if (current.phase !== "bidding") return current;
      return placeCall(current, spectateCall(current, spectateStrategy), current.biddingTurn);
    }), spectateSpeed);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.biddingTurn, game.bidHistory.length, spectateSpeed, spectateStrategy]);

  useEffect(() => {
    if (mode !== "spectate" || game.phase !== "playing" || game.trickComplete || game.finished) return;
    const timer = setTimeout(() => setGame(current => {
      if (current.phase !== "playing" || current.trickComplete) return current;
      const cardId = spectateCard(current, spectateStrategy);
      return cardId ? playCard(current, cardId, current.currentPlayer) : current;
    }), spectateSpeed);
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.currentPlayer, game.finished, game.trick.length, game.trickComplete, spectateSpeed, spectateStrategy]);

  useEffect(() => {
    if (mode !== "spectate" || game.phase !== "playing" || !game.trickComplete) return;
    const timer = setTimeout(() => setGame(current => resolveTrick(current)), Math.max(300, spectateSpeed * 2));
    return () => clearTimeout(timer);
  }, [mode, game.phase, game.trickComplete, game.trick.length, spectateSpeed]);

  // Автоматичен рестарт: след като играта свърши, започва нова - така
  // тестовият режим може да върти игри непрекъснато.
  useEffect(() => {
    if (mode !== "spectate" || !game.finished) return;
    const timer = setTimeout(() => {
      setSpectateGames(n => n + 1);
      setGame(deal(0));
    }, 1400);
    return () => clearTimeout(timer);
  }, [mode, game.finished]);

  useEffect(() => () => ws?.close(), [ws]);

  // Запомняме последната завършена взятка (4 карти), за да може да се
  // преиграе и след като бъде изчистена от масата.
  useEffect(() => {
    if (game.trickComplete && game.trick.length === 4) setLastTrick(game.trick);
  }, [game.trickComplete, game.trick.length]);

  // Повторението се показва за ~2.2s и изчезва автоматично.
  useEffect(() => {
    if (!replayTrick) return;
    const timer = setTimeout(() => setReplayTrick(null), 2200);
    return () => clearTimeout(timer);
  }, [replayTrick]);

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
  function startSpectate() { setGame(deal(0)); setSpectateGames(1); setMode("spectate"); }
  function replayLastTrick() { if (lastTrick.length === 4) setReplayTrick(lastTrick); }

  const isBidding = game.phase === "bidding";
  const isHumanTurnToBid = mode !== "spectate" && isBidding && game.biddingTurn === actor;
  const isHumanTurnToPlay = mode !== "spectate" && game.phase === "playing" && game.currentPlayer === actor;
  const canContra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 1 && game.players[game.highestBid.playerId].team !== game.players[actor].team;
  const canRecontra = isHumanTurnToBid && !!game.highestBid && game.multiplier === 2 && game.players[game.highestBid.playerId].team === game.players[actor].team;
  const availableBidOptions: Call[] = isHumanTurnToBid ? [...CONTRACT_OPTIONS.filter(call => !game.highestBid || bidRank(call) > bidRank(game.highestBid.contract) || (call === "NO_TRUMP" && game.highestBid.contract === "NO_TRUMP")), "PASS", ...(canContra ? ["CONTRA" as Call] : []), ...(canRecontra ? ["RECONTRA" as Call] : [])] : [];

  const playerLabels = useMemo(() => game.players.map((p,i) => mode === "spectate" ? `Агент ${i+1}` : (p.name || (i===seat ? name : `Играч ${i+1}`))), [game.players, seat, name, mode]);

  if (!mode && !choosingLocalTeam) return <main className="table"><div className="modal"><div className="modal-content"><h1>♠ БЕЛОТ</h1><p>Избери как искаш да играеш.</p><button className="new-game" onClick={() => setChoosingLocalTeam(true)}>Сам с ботове</button><button className="new-game" onClick={() => { setMode("online"); openOnline(); }}>Онлайн с приятели</button><button className="new-game" onClick={startSpectate}>🤖 Тестов режим (агенти)</button><button className="new-game team-back" onClick={() => setShowHistory(true)}>🕘 История на игрите</button></div></div>{showHistory && <History onClose={() => setShowHistory(false)} />}</main>;

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
    <header className="header"><h1>♠ БЕЛОТ</h1><div className="score"><span>Наши: <b>{formatScore(game.score[0])}</b></span><span>Те: <b>{formatScore(game.score[1])}</b></span>{mode === "online" && <span>Стая: <b>{onlineCode}</b> · {connected}/4</span>}<button className="header-btn" onClick={() => setShowHistory(true)}>🕘 История</button></div></header>
    <section className="game-area">
      {mode === "spectate" && <div className="spectate-panel">
        <div className="spectate-head"><span className="spectate-tag">ТЕСТ · игра #{spectateGames}</span><button className="spectate-btn stop" onClick={()=>setMode(null)}>Стоп</button></div>
        <div className="spectate-row"><span>Агенти:</span><button className={`spectate-btn ${spectateStrategy==="smart"?"on":""}`} onClick={()=>setSpectateStrategy("smart")}>Разумни</button><button className={`spectate-btn ${spectateStrategy==="chaos"?"on":""}`} onClick={()=>setSpectateStrategy("chaos")}>Хаос</button></div>
        <div className="spectate-row"><span>Скорост:</span><button className={`spectate-btn ${spectateSpeed===600?"on":""}`} onClick={()=>setSpectateSpeed(600)}>Бавно</button><button className={`spectate-btn ${spectateSpeed===220?"on":""}`} onClick={()=>setSpectateSpeed(220)}>Нормално</button><button className={`spectate-btn ${spectateSpeed===60?"on":""}`} onClick={()=>setSpectateSpeed(60)}>Бързо</button></div>
      </div>}
      {[partnerSeat,leftSeat,rightSeat].map(id => <div key={id} className={`opponent ${id===partnerSeat?"top":id===leftSeat?"left":"right"} ${id===actingSeat?"active-turn":""}`}><div className="player-info"><Avatar icon={mode==="online"?"👤":"🤖"} onTurn={id===actingSeat} first={showFirstLead && id===openingLeader}/><strong>{playerLabels[id]}</strong><BidSlot entry={latestBids[id]} active={isBidding} bidKey={latestBidIndex[id]}/></div>{id===actingSeat && <small className="turn-label">На ход</small>}<AnnouncementList announcements={announcements[id]}/><div className={id===partnerSeat?"back-cards":"vertical-cards"}>{game.players[id].hand.map((_card,i)=><div className="back-card" key={i}>🂠</div>)}</div></div>)}
      <div className="center">
        {game.phase === "playing" && <div className="trick">{game.trick.map(played => <div key={played.card.id} className={`played-card seat-${relativeSeat(played.playerId)} ${(played.card.suit === "♥" || played.card.suit === "♦") ? "red" : ""}`}><span>{played.card.rank}</span><span>{played.card.suit}</span></div>)}</div>}
        {replayTrick && <div className="replay-overlay"><div className="replay-label">↻ Повторение на последната взятка</div><div className="trick">{replayTrick.map(played => <div key={`replay-${played.card.id}`} className={`played-card seat-${relativeSeat(played.playerId)} ${(played.card.suit === "♥" || played.card.suit === "♦") ? "red" : ""}`}><span>{played.card.rank}</span><span>{played.card.suit}</span></div>)}</div></div>}
        {isHumanTurnToBid && <div className="bid-panel">{availableBidOptions.map(call=><button key={call} className="bid-button" onClick={()=>handleBid(call)}><CallLabel call={call}/></button>)}</div>}
        <div className="message">{game.message}</div>
        {lastTrick.length === 4 && <button className="replay-btn" onClick={replayLastTrick}>▶ Преиграй последната взятка</button>}
      </div>
      {game.phase === "playing" && <div className="contract contract-corner">Коз: <strong>{game.contract ? <CallLabel call={game.contract} /> : "—"}</strong>{game.multiplier>1 && <strong className="multiplier-badge"> ×{game.multiplier}</strong>}{game.declarer!==null && <div className="current-bid">Обявил: {playerLabels[game.declarer]}</div>}</div>}
      <div className={`player ${actor===actingSeat?"active-turn":""}`}><div className="hand">{sortedHumanHand.map(card=><CardView key={card.id} card={card} playable={isHumanTurnToPlay} onClick={()=>handleCard(card)}/>)}</div><div className="player-name"><div className="player-info"><Avatar icon={mode==="spectate"?"🤖":"👤"} onTurn={actor===actingSeat} first={showFirstLead && actor===openingLeader}/><strong>{playerLabels[actor]}</strong><BidSlot entry={latestBids[actor]} active={isBidding} bidKey={latestBidIndex[actor]}/></div>{isHumanTurnToPlay&&<small> — ТВОЙ ХОД</small>}{isHumanTurnToBid&&<small> — ТИ НАДДАВАШ</small>}</div><AnnouncementList announcements={announcements[actor]}/></div>
    </section>
    {game.finished && mode !== "spectate" && <div className="modal"><div className="modal-content"><h2>🏆 КРАЙ НА ИГРАТА</h2><h3>{formatScore(game.score[0])} : {formatScore(game.score[1])}</h3><button className="new-game" onClick={newGame}>Нова игра</button></div></div>}
    {showHistory && <History onClose={() => setShowHistory(false)} />}
  </main>;
}
export default App;
