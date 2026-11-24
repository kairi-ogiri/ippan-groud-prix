const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });
app.use(express.static("public"));

const rooms = new Map();
const prompts = [
  "こんな学校は絶対に通いたくない。どんな学校？",
  "この店、何かがおかしい。何があった？",
  "絶対に売れない新商品の名前と特徴",
  "宇宙人が地球に来て最初に言った一言",
  "日本一クセが強い校長先生の朝礼",
  "この遊園地、客を楽しませる気がない。なぜ？",
  "未来の教科書に載った、意外すぎる歴史",
  "絶対に信用できない天気予報。その理由は？",
  "新しくできた謎の部活動。活動内容は？",
  "このロボット、ポンコツすぎる。何をした？"
];

// 48 photo-card slots. Replace public/photos/01.jpg ... 48.jpg with licensed/owned images.
const photoCards = Array.from({length:48}, (_,i) => ({
  id:i+1, image:`/photos/${String(i+1).padStart(2,"0")}.jpg`,
  fallback:`写真素材 ${String(i+1).padStart(2,"0")}`
}));

function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, players: room.players,
    config: room.config, phase: room.phase, currentPrompt: room.currentPrompt,
    currentPhoto: room.currentPhoto, turnIndex: room.turnIndex,
    activeAnswerer: room.activeAnswerer, scores: room.scores,
    ippan: room.ippan, round: room.round, submitted: room.submitted,
    final: room.final, judgeDifficulty: room.config.difficulty
  };
}
function emitRoom(room) { io.to(room.code).emit("room:update", publicRoom(room)); }
function nextPlayer(room) {
  if (!room.players.length) return;
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.activeAnswerer = null;
}
function startRound(room) {
  room.phase = "playing";
  room.round = 1;
  room.scores = Object.fromEntries(room.players.map(p => [p.id,0]));
  room.ippan = Object.fromEntries(room.players.map(p => [p.id,0]));
  room.submitted = 0;
  room.turnIndex = 0;
  room.activeAnswerer = null;
  room.currentPrompt = prompts[Math.floor(Math.random()*prompts.length)];
  room.deadline = Date.now() + room.config.minutes * 60000;
  room.photoCount = 0;
  room.normalCount = 0;
  room.lastType = "normal";
  emitRoom(room);
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((room.deadline-Date.now())/1000));
    io.to(room.code).emit("timer", left);
    if (left <= 0) finishRound(room);
  }, 500);
}
function finishRound(room) {
  if (room.phase !== "playing") return;
  clearInterval(room.timer);
  room.phase = "round-result";
  room.activeAnswerer = null;
  emitRoom(room);
  io.to(room.code).emit("round:result", {ippan:room.ippan, scores:room.scores});
  if (room.players.length > 2) {
    const ranked = [...room.players].sort((a,b)=>(room.ippan[b.id]||0)-(room.ippan[a.id]||0));
    room.finalists = ranked.slice(0,2).map(p=>p.id);
    room.phase = "watching-final";
    emitRoom(room);
    setTimeout(() => startFinal(room), 5000);
  } else {
    room.finalists = room.players.map(p=>p.id);
    setTimeout(() => startFinal(room), 5000);
  }
}
function startFinal(room) {
  if (!rooms.has(room.code)) return;
  room.phase = "final";
  room.finalScores = Object.fromEntries((room.finalists||[]).map(id=>[id,0]));
  room.finalTurn = 0;
  room.activeAnswerer = null;
  room.currentPrompt = prompts[Math.floor(Math.random()*prompts.length)];
  emitRoom(room);
}
async function judgeDrawing(dataUrl, prompt, difficulty) {
  if (!process.env.OPENAI_API_KEY) {
    // Development fallback: keeps the game playable, but is not AI judging.
    return {score: Math.floor(Math.random()*10), feedback:"開発用の仮採点です。OPENAI_API_KEYを設定するとAI採点になります。"};
  }
  const instruction = `あなたは大喜利の審査員です。お題に対する手書き回答画像を採点してください。難易度:${difficulty}。面白さ・意外性・お題との関連を総合評価し、0〜10の整数で採点。10点は特に秀逸な回答だけ。画像内の文字を読み取ってください。JSONのみで返答: {"score":0,"feedback":"短い講評"}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"gpt-4o-mini",
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:instruction},
        {role:"user",content:[
          {type:"text",text:`お題: ${prompt}`},
          {type:"image_url",image_url:{url:dataUrl,detail:"high"}}
        ]}
      ],
      max_tokens:180
    })
  });
  if (!response.ok) throw new Error(`AI judging failed: ${response.status}`);
  const result = await response.json();
  const parsed = JSON.parse(result.choices[0].message.content);
  return {score:Math.max(0,Math.min(10,Number(parsed.score)||0)), feedback:String(parsed.feedback||"")};
}

io.on("connection", socket => {
  socket.on("room:create", ({name,config}) => {
    const code = Math.random().toString(36).slice(2,7).toUpperCase();
    const player = {id:socket.id,name:(name||"ゲスト").slice(0,14),connected:true};
    const room = {
      code,hostId:socket.id,players:[player],
      config:{players:Math.max(2,Math.min(10,Number(config?.players)||2)),
        topics:Math.max(1,Math.min(3,Number(config?.topics)||1)),
        minutes:[1,2,3].includes(Number(config?.minutes))?Number(config.minutes):1,
        difficulty:["易","普通","難"].includes(config?.difficulty)?config.difficulty:"普通"},
      phase:"lobby",currentPrompt:null,currentPhoto:null,turnIndex:0,
      activeAnswerer:null,scores:{},ippan:{},round:0,submitted:0,finalists:[]
    };
    rooms.set(code,room); socket.join(code); socket.data.room=code;
    socket.emit("room:created",{code}); emitRoom(room);
  });
  socket.on("room:join", ({code,name}) => {
    const room=rooms.get(String(code||"").toUpperCase());
    if (!room) return socket.emit("error:message","ルームが見つかりません。");
    if (room.phase!=="lobby" || room.players.length>=room.config.players) return socket.emit("error:message","このルームには参加できません。");
    const player={id:socket.id,name:(name||"ゲスト").slice(0,14),connected:true};
    room.players.push(player); socket.join(room.code); socket.data.room=room.code;
    emitRoom(room);
  });
  socket.on("game:start",()=>{
    const room=rooms.get(socket.data.room); if(!room || room.hostId!==socket.id) return;
    if(room.players.length!==room.config.players) return socket.emit("error:message","設定した人数がそろっていません。");
    startRound(room);
  });
  socket.on("answer:claim",()=>{
    const room=rooms.get(socket.data.room); if(!room || !["playing","final"].includes(room.phase)) return;
    if(room.activeAnswerer) return;
    if(room.phase==="final" && room.players[room.finalTurn]?.id!==socket.id) return;
    if(room.phase==="playing" && room.players[room.turnIndex]?.id!==socket.id) {
      // Normal mode is open buzzer: any player can claim while nobody is answering.
    }
    room.activeAnswerer=socket.id;
    io.to(room.code).emit("answer:claimed",{playerId:socket.id});
    emitRoom(room);
  });
  socket.on("board:draw",payload=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    socket.to(room.code).emit("board:draw",{playerId:socket.id,board:payload.board,points:payload.points});
  });
  socket.on("board:clear",payload=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    socket.to(room.code).emit("board:clear",{playerId:socket.id,board:payload.board});
  });
  socket.on("answer:submit",async({image,board})=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.activeAnswerer!==socket.id || !["playing","final"].includes(room.phase)) return;
    room.activeAnswerer=null;
    io.to(room.code).emit("answer:judging",{playerId:socket.id});
    try {
      const result=await judgeDrawing(image,room.currentPrompt,room.config.difficulty);
      const isFinal=room.phase==="final";
      if(isFinal) {
        room.finalScores[socket.id]=(room.finalScores[socket.id]||0)+(result.score===10?1:0);
      } else {
        room.scores[socket.id]=(room.scores[socket.id]||0)+result.score;
        room.ippan[socket.id]=(room.ippan[socket.id]||0)+(result.score===10?1:0);
      }
      io.to(room.code).emit("answer:judged",{playerId:socket.id,...result,ippan:result.score===10});
      if(isFinal) {
        if(room.finalScores[socket.id]>=3) {
          room.phase="champion"; room.champion=socket.id;
          emitRoom(room); io.to(room.code).emit("game:champion",{playerId:socket.id}); return;
        }
        room.finalTurn=(room.finalTurn+1)%room.finalists.length;
      }
      emitRoom(room);
    } catch(e) {
      io.to(room.code).emit("error:message","AI採点に失敗しました。サーバー設定を確認してください。");
    }
  });
  socket.on("photo:spin",()=>{
    const room=rooms.get(socket.data.room); if(!room || room.phase!=="playing") return;
    if(room.activeAnswerer || room.photoTurn && room.photoTurn!==socket.id) return;
    room.photoTurn=socket.id;
    const card=photoCards[Math.floor(Math.random()*photoCards.length)];
    room.currentPhoto=card; emitRoom(room);
    io.to(room.code).emit("photo:selected",card);
  });
  socket.on("photo:pass",()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    room.photoTurn=null; nextPlayer(room); emitRoom(room);
  });
  socket.on("disconnect",()=>{
    const code=socket.data.room, room=rooms.get(code); if(!room) return;
    room.players=room.players.filter(p=>p.id!==socket.id);
    if(!room.players.length){clearInterval(room.timer);rooms.delete(code);return;}
    if(room.hostId===socket.id) room.hostId=room.players[0].id;
    if(room.activeAnswerer===socket.id) room.activeAnswerer=null;
    emitRoom(room);
  });
});

const port=process.env.PORT||3000;
server.listen(port,()=>console.log(`IPPAN PEOPLE's グランプリ running on http://localhost:${port}`));
