const $=id=>document.getElementById(id);

let player=localStorage.getItem("pulseKeysPlayer")||"";
let playerKey=localStorage.getItem("pulseKeysPlayerKey")||"";
let songKey="neon",levelKey="medium";
let score=0,hits=0,running=false,paused=false,endingPhase=false,startTime=0,totalPaused=0,pausedAt=0,activeDuration=0;
let spawnTimer=null,clockTimer=null,melodyTimer=null,raf=null;
let muted=false,audioCtx=null,master=null,lastPointer=0,melodyIndex=0,resultRecorded=false;
let maxHealth=20,health=20,maxShield=5,shield=5,reviveMultiplier=1,gameWon=false;
let volume=Number(localStorage.getItem("pulseKeysVolume")||70);
let tutorialActive=false,lastResultTier="Ruim";
let infiniteMode=false, infiniteStage=1, infiniteStageScore=0, infiniteStageEnding=false;


// === MISSÕES / DESBLOQUEIO DE DIFICULDADES ===
const PK_LEVEL_ORDER=["noob","medium","hard","insane","marcus"];
const PK_TIER_NAMES=["Ruim","Bom","Médio","Alto","Perfeito"];

function pkProgressAll(){
  try{return JSON.parse(localStorage.getItem("pulseKeysProgress")||"{}");}catch(e){return {};}
}
function pkSaveProgress(p){localStorage.setItem("pulseKeysProgress",JSON.stringify(p));}
function pkPlayerId(){return playerKey||String(player||"").trim().toLowerCase();}
function pkPlayerProgress(){
  const all=pkProgressAll(), id=pkPlayerId();
  if(!all[id]) all[id]={};
  return {all,id,data:all[id]};
}
function pkTierFromAccuracy(){
  const total=Math.max(1,Number(window.pkTotalNotes||0));
  const hits=Number(window.pkHitNotes||0);
  const misses=Number(window.pkMissNotes||0);
  const ratio=hits/total;
  if(total>0 && hits===total && misses===0) return "Perfeito";
  if(ratio>=0.82) return "Alto";
  if(ratio>=0.62) return "Médio";
  if(ratio>=0.38) return "Bom";
  return "Ruim";
}
function pkRecordResult(level,tier){
  const {all,id,data}=pkPlayerProgress();
  data[level] ||= {perfects:0,bestTier:"Ruim"};
  if(tier==="Perfeito") data[level].perfects++;
  if(PK_TIER_NAMES.indexOf(tier)>PK_TIER_NAMES.indexOf(data[level].bestTier)) data[level].bestTier=tier;
  pkSaveProgress(all);
}
function pkUnlocked(level){
  if(playerKey==="arthur") return true;
  const i=PK_LEVEL_ORDER.indexOf(level);
  if(i<=0) return true;
  const prev=pkPlayerProgress().data[PK_LEVEL_ORDER[i-1]];
  return !!prev && ((prev.perfects||0)>=3 || PK_TIER_NAMES.indexOf(prev.bestTier)>=2);
}
function pkUnlockText(level){
  const i=PK_LEVEL_ORDER.indexOf(level);
  if(i<=0) return "Disponível";
  const prev=PK_LEVEL_ORDER[i-1];
  const p=pkPlayerProgress().data[prev];
  if(!p) return "🔒 Bloqueado — consiga nível Médio ou 3 Perfeitos em "+prev+".";
  return "🔒 Bloqueado — nível Médio já libera; 3 Perfeitos também liberam.";
}
// === SISTEMA DE CORES E PONTUAÇÃO ===
// Quanto mais valiosa a cor, mais pontos a nota dá. Em dificuldades maiores,
// as cores de maior valor aparecem com mais frequência.
const PK_NOTE_SCORES=[
  {name:"Verde", color:"#35d07f", points:1, weight:38},
  {name:"Amarelo", color:"#ffd43b", points:2, weight:25},
  {name:"Azul", color:"#4dabf7", points:3, weight:16},
  {name:"Roxo", color:"#b56cff", points:5, weight:10},
  {name:"Branco", color:"#f8fbff", points:8, weight:6},
  {name:"Preto", color:"#252525", points:10, weight:5}
];
const PK_LEVEL_COLOR_BOOST={noob:0,medium:.18,hard:.38,insane:.62,marcus:.86};
function pickNoteStyle(){
  const boost=PK_LEVEL_COLOR_BOOST[levelKey]||0;
  const entries=PK_NOTE_SCORES.map((n,i)=>({n,w:n.weight*(1+(i>=3?boost:0))}));
  const total=entries.reduce((a,e)=>a+e.w,0);
  let r=Math.random()*total;
  for(const e of entries){r-=e.w;if(r<=0)return e.n;}
  return entries[0].n;
}

const levels={
  noob:{duration:18000,spawn:1120,speed:.36,label:"Noob"},
  medium:{duration:18500,spawn:780,speed:.62,label:"Médio"},
  hard:{duration:19500,spawn:590,speed:.90,label:"Difícil"},
  insane:{duration:20000,spawn:420,speed:1.38,label:"Insano"},
  marcus:{duration:20000,spawn:300,speed:2.50,label:"Marcus"}
};
const PK_INFINITE_DURATION=Infinity;
const PK_INFINITE_STAGE_TARGET=100;
function pkIsInfinite(){return !!infiniteMode;}
function pkInfiniteStageSpeed(stage){
  stage=Math.max(1,Number(stage)||1);
  if(stage===1)return 1;
  if(stage===2)return 1.5;
  if(stage===3)return 2;
  if(stage===4)return 2.5;
  if(stage===5)return 3.5;
  const offset=stage-6;
  const block=Math.floor(offset/5);
  const position=offset%5;
  return 4+block+(position*0.5);
}
function pkInfiniteDifficultyFactor(){
  return ({noob:0.36,medium:0.62,hard:0.90,insane:1.38,marcus:2.50}[levelKey]||0.62);
}
function pkInfiniteStageHasTimer(){
  return levelKey==='noob' && infiniteStage===1;
}
const PK_INFINITE_NOOB_TEST_TIME=30000;
function pkInfiniteLabel(){return `∞ Infinito • ${levels[levelKey].label} • Estágio ${infiniteStage}`;}
function pkEnsureModeUI(){
  if(document.getElementById("pkModeBox"))return;
  const settings=document.getElementById("gameSettings");
  if(!settings)return;
  const box=document.createElement("div");
  box.id="pkModeBox";
  box.style.cssText="display:block;width:100%;box-sizing:border-box;margin:12px 0;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#fff";
  box.innerHTML=`<label style="display:block;font-weight:800;margin-bottom:6px">🎮 Modo de jogo</label><select id="pkModeSelect" style="width:100%;padding:10px;border-radius:9px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.25)"><option value="normal">Fase normal</option><option value="infinite">∞ Infinito</option></select><div id="pkModeHint" style="font-size:12px;opacity:.85;margin-top:7px;line-height:1.35">A fase termina depois do tempo e das notas restantes.</div>`;
  const level=document.getElementById("levelSelect");
  if(level&&level.parentElement)level.parentElement.insertAdjacentElement("afterend",box);else settings.prepend(box);
  const select=document.getElementById("pkModeSelect");
  select.addEventListener("change",()=>{infiniteMode=select.value==="infinite";const hint=document.getElementById("pkModeHint");if(hint)hint.textContent=infiniteMode?"A música e as notas continuam sem limite de tempo. Você joga até perder toda a vida.":"A fase termina depois do tempo e das notas restantes.";});
}
function pkSyncModeUI(){
  pkEnsureModeUI();
  const select=document.getElementById("pkModeSelect");
  if(select)select.value=infiniteMode?"infinite":"normal";
  const hint=document.getElementById("pkModeHint");
  if(hint)hint.textContent=infiniteMode?"A música e as notas continuam sem limite de tempo. Você joga até perder toda a vida.":"A fase termina depois do tempo e das notas restantes.";
}

// As faixas abaixo são referências para ouvir no YouTube. O jogo continua usando
// áudio sintetizado localmente, então não depende de streaming para funcionar.
const playlists={
  noob:[
    {key:"glorious",title:"Glorious Morning — Waterflame",bpm:112,notes:[261.63,293.66,329.63,392,329.63,293.66,261.63,220],youtube:"https://www.youtube.com/results?search_query=Waterflame+Glorious+Morning",tag:"calma • entrada suave"},
    {key:"crystallize",title:"Crystallize — Creo",bpm:114,notes:[261.63,329.63,392,440,392,329.63,293.66,329.63],youtube:"https://www.youtube.com/results?search_query=Creo+Crystallize",tag:"melódica • tranquila"},
    {key:"time-machine",title:"Time Machine — Waterflame",bpm:116,notes:[293.66,329.63,392,349.23,293.66,261.63,293.66,392],youtube:"https://www.youtube.com/results?search_query=Waterflame+Time+Machine",tag:"leve • aventura"},
    {key:"skyward",title:"Skyward — Creo",bpm:118,notes:[261.63,329.63,369.99,440,369.99,329.63,293.66,261.63],youtube:"https://www.youtube.com/results?search_query=Creo+Skyward",tag:"suave • espacial"},
    {key:"sunrise",title:"Sunrise — Waterflame",bpm:120,notes:[293.66,349.23,392,440,392,349.23,329.63,293.66],youtube:"https://www.youtube.com/results?search_query=Waterflame+Sunrise",tag:"calma • progressiva"}
  ],
  medium:[
    {key:"sphere",title:"Sphere — Creo",bpm:124,notes:[293.66,349.23,440,523.25,440,349.23,392,493.88],youtube:"https://www.youtube.com/results?search_query=Creo+Sphere",tag:"ritmo moderado"},
    {key:"dimension",title:"Dimension — Creo",bpm:126,notes:[329.63,392,493.88,392,349.23,440,523.25,440],youtube:"https://www.youtube.com/results?search_query=Creo+Dimension",tag:"mais pulsante"},
    {key:"glome",title:"Glome — Creo",bpm:128,notes:[329.63,392,440,523.25,493.88,440,392,329.63],youtube:"https://www.youtube.com/results?search_query=Creo+Glome",tag:"eletrônica • crescente"},
    {key:"arcade-punk",title:"Arcade Punk — Waterflame",bpm:132,notes:[349.23,440,523.25,587.33,523.25,440,392,493.88],youtube:"https://www.youtube.com/results?search_query=Waterflame+Arcade+Punk",tag:"arcade • energético"},
    {key:"press-start",title:"Press Start — MDK",bpm:134,notes:[392,493.88,587.33,659.25,587.33,493.88,523.25,392],youtube:"https://www.youtube.com/results?search_query=MDK+Press+Start",tag:"chiptune • animada"}
  ],
  hard:[
    {key:"exosphere",title:"Exosphere — Creo",bpm:140,notes:[329.63,415.30,493.88,554.37,493.88,415.30,369.99,493.88],youtube:"https://www.youtube.com/results?search_query=Creo+Exosphere",tag:"eletrônica • acelera"},
    {key:"endgame",title:"Endgame — Waterflame",bpm:148,notes:[392,493.88,587.33,659.25,587.33,493.88,440,554.37],youtube:"https://www.youtube.com/results?search_query=Waterflame+Endgame",tag:"chiptune • rápido"},
    {key:"carnivores",title:"Carnivores — Creo",bpm:150,notes:[392,493.88,587.33,698.46,587.33,493.88,554.37,659.25],youtube:"https://www.youtube.com/results?search_query=Creo+Carnivores",tag:"rápida • intensa"},
    {key:"jumper",title:"Jumper — Waterflame",bpm:154,notes:[440,554.37,659.25,783.99,659.25,587.33,493.88,698.46],youtube:"https://www.youtube.com/results?search_query=Waterflame+Jumper",tag:"arcade • veloz"},
    {key:"jelly-castle",title:"Jelly Castle — MDK",bpm:158,notes:[440,554.37,659.25,739.99,659.25,554.37,493.88,783.99],youtube:"https://www.youtube.com/results?search_query=MDK+Jelly+Castle",tag:"elétrica • divertida"}
  ],
  insane:[
    {key:"skyfortress",title:"Sky Fortress — Waterflame",bpm:164,notes:[392,493.88,587.33,698.46,659.25,587.33,493.88,783.99],youtube:"https://www.youtube.com/results?search_query=Waterflame+Sky+Fortress",tag:"épica • muito rápida"},
    {key:"lightspeed",title:"Lightspeed — Waterflame",bpm:174,notes:[440,554.37,659.25,783.99,880,783.99,659.25,987.77],youtube:"https://www.youtube.com/results?search_query=Waterflame+Lightspeed",tag:"trance • alta energia"},
    {key:"theory-of-everything",title:"Theory of Everything — DJ-Nate",bpm:178,notes:[493.88,659.25,783.99,987.77,880,783.99,1046.5,1174.66],youtube:"https://www.youtube.com/results?search_query=DJ-Nate+Theory+of+Everything",tag:"eletrônica • frenética"},
    {key:"blast-processing",title:"Blast Processing — Waterflame",bpm:182,notes:[523.25,659.25,783.99,987.77,1046.5,880,783.99,1174.66],youtube:"https://www.youtube.com/results?search_query=Waterflame+Blast+Processing",tag:"arcade • acelerada"},
    {key:"surface",title:"Surface — Creo",bpm:184,notes:[493.88,587.33,739.99,880,987.77,880,739.99,659.25],youtube:"https://www.youtube.com/results?search_query=Creo+Surface",tag:"synth • muito rápida"}
  ],
  marcus:[
    {key:"fingerbang",title:"Fingerbang — MDK",bpm:188,notes:[493.88,659.25,783.99,987.77,880,783.99,1046.5,1174.66],youtube:"https://www.youtube.com/watch?v=BuPmq7yjDnI",tag:"elétrica • frenética"},
    {key:"nautilus",title:"Nautilus — Creo",bpm:192,notes:[440,554.37,659.25,830.61,987.77,830.61,739.99,1108.73],youtube:"https://www.youtube.com/results?search_query=Creo+Nautilus",tag:"build-up • pancadão"},
    {key:"press-start-extreme",title:"Press Start — MDK",bpm:196,notes:[523.25,659.25,783.99,1046.5,1174.66,987.77,1318.51,1567.98],youtube:"https://www.youtube.com/results?search_query=MDK+Press+Start",tag:"arcade • extrema"},
    {key:"powerless",title:"Powerless — Creo",bpm:200,notes:[554.37,659.25,830.61,987.77,1108.73,987.77,880,1174.66],youtube:"https://www.youtube.com/results?search_query=Creo+Powerless",tag:"energia • brutal"},
    {key:"ghost",title:"Ghost — Creo",bpm:204,notes:[587.33,739.99,880,1046.5,1174.66,1046.5,987.77,1318.51],youtube:"https://www.youtube.com/results?search_query=Creo+Ghost",tag:"rápida • final intenso"}
  ]
};

const SHOP_ITEMS={
  double:{name:"2× Pontos",cost:250,type:"once",desc:"Dobra os pontos ganhos na próxima partida."},
  revive:{name:"Reviver",cost:80,type:"consumable",limit:3,desc:"Reinicia o nível após a derrota e dobra a recompensa da nova tentativa."},
  shield:{name:"Escudo",cost:120,type:"consumable",limit:5,desc:"Carga extra consumível da loja para proteger contra erros."},
  healthUp:{name:"Melhoria de Vida",costs:[180,360,620,980,1450],type:"upgrade",desc:"Aumenta a vida máxima em +5 HP por nível."},
  shieldUp:{name:"Melhoria de Escudo",costs:[160,320,540,850,1250],type:"upgrade",desc:"Aumenta o escudo máximo em +3 por nível."}
};
const SHOP_REFRESH_MS=5*60*1000;
const UPGRADE_LIMIT_BY_LEVEL={noob:0,medium:1,hard:2,insane:4,marcus:5};
function randomStock(limit){return 1+Math.floor(Math.random()*limit);}
function refreshShopIfNeeded(u){
  u.shop=u.shop||{};
  u.shop.double=!!u.shop.double;
  u.shop.revive=Number(u.shop.revive||0);
  u.shop.shield=Number(u.shop.shield||0);
  u.shop.stock=u.shop.stock||{};
  u.shop.purchases=u.shop.purchases||{};
  u.shop.upgrades=u.shop.upgrades||{health:0,shield:0};
  u.shop.upgrades.health=Math.min(5,Number(u.shop.upgrades.health||0));
  u.shop.upgrades.shield=Math.min(5,Number(u.shop.upgrades.shield||0));
  let refreshAt=Number(u.shop.refreshAt||0);
  const now=Date.now();
  if(!refreshAt || now>=refreshAt){
    u.shop.stock.revive=randomStock(SHOP_ITEMS.revive.limit);
    u.shop.stock.shield=randomStock(SHOP_ITEMS.shield.limit);
    u.shop.purchases.revive=0;
    u.shop.purchases.shield=0;
    u.shop.refreshAt=now+SHOP_REFRESH_MS;
  }
  return u;
}
function shopState(){
  const users=getUsers(),u=users[playerKey]||{};
  u.coins=Number(u.coins||0);
  refreshShopIfNeeded(u);
  users[playerKey]=u;saveUsers(users);return u;
}
function shopUnlocked(){return playerKey==="arthur" || pkUnlocked("medium");}
function awardCoins(multiplier=1){
  const users=getUsers(),u=users[playerKey]; if(!u||!gameWon)return;
  refreshShopIfNeeded(u);
  const baseMultiplier=(u.shop&&u.shop.double)?2:1;
  const finalMultiplier=reviveMultiplier>1?reviveMultiplier:baseMultiplier;
  u.coins=Number(u.coins||0)+(score*finalMultiplier);
  if(u.shop&&u.shop.double)u.shop.double=false;
  users[playerKey]=u;saveUsers(users);
}
function shopRefreshText(u){
  const left=Math.max(0,Number(u.shop.refreshAt||0)-Date.now());
  const sec=Math.ceil(left/1000);
  return sec>0?`Atualiza em ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`:"Atualizando...";
}
function upgradeStats(u){
  const h=Math.min(5,Number(u.shop?.upgrades?.health||0));
  const sh=Math.min(5,Number(u.shop?.upgrades?.shield||0));
  return {healthLevel:h,shieldLevel:sh,maxHealth:20+h*5,maxShield:5+sh*3,total:h+sh};
}
function renderShop(){
  const box=$("shopItems"),u=shopState(); if(!box)return;
  const stats=upgradeStats(u), cap=UPGRADE_LIMIT_BY_LEVEL[levelKey]||0;
  $("shopPoints").textContent=`Pontos disponíveis: ${u.coins}`;
  const upgrades=`
    <div class="shopSectionTitle">🛡️ Melhorias</div>
    <div class="upgradeInfo">No <b>${levels[levelKey].label}</b>, você pode ter até <b>${cap}</b> melhoria${cap===1?'':'s'} comprada${cap===1?'':'s'} no total. As melhorias ficam salvas na conta.</div>
    ${renderUpgradeItem('health',SHOP_ITEMS.healthUp,stats.healthLevel,cap,u)}
    ${renderUpgradeItem('shield',SHOP_ITEMS.shieldUp,stats.shieldLevel,cap,u)}
  `;
  const items=Object.entries(SHOP_ITEMS).filter(([id])=>id!=="healthUp"&&id!=="shieldUp").map(([id,it])=>{
    if(id==="double"){
      const disabled=!shopUnlocked()||u.coins<it.cost||u.shop.double;
      return `<div class="shopItem"><div><b>${it.name}</b><span>${it.desc}</span><small>${u.shop.double?"Compra permanente já feita":"Compra única • não volta para a loja"}</small></div><button class="shopBuy" data-shop="${id}" ${disabled?'disabled':''}>${it.cost} pts</button></div>`;
    }
    const stock=Number(u.shop.stock[id]||0), purchases=Number(u.shop.purchases[id]||0), limit=it.limit;
    const disabled=!shopUnlocked()||u.coins<it.cost||stock<=0||purchases>=limit;
    return `<div class="shopItem"><div><b>${it.name}</b><span>${it.desc}</span><small>Compras: ${purchases}/${limit} • Unidades: ${stock}</small></div><button class="shopBuy" data-shop="${id}" ${disabled?'disabled':''}>${it.cost} pts</button></div>`;
  }).join("");
  box.innerHTML=upgrades+`<div class="shopSectionTitle consumablesTitle">🎒 Itens</div>`+items+`<p class="shopRefresh">🔄 ${shopRefreshText(u)}</p>`;
  box.querySelectorAll(".shopBuy").forEach(btn=>btn.addEventListener("pointerdown",e=>{e.preventDefault();buyItem(btn.dataset.shop||((btn.dataset.upgrade||"")+"Up"));}));
}
function renderUpgradeItem(kind,it,level,cap,u){
  const total=Number(u.shop.upgrades.health||0)+Number(u.shop.upgrades.shield||0);
  const next=Math.min(5,level+1),cost=it.costs[level];
  const atMax=level>=5,atCap=total>=cap;
  const disabled=!shopUnlocked()||atMax||atCap||u.coins<cost;
  const effect=kind==="health"?`❤️ ${20+level*5} → ${20+next*5} HP`:`🛡️ ${5+level*3} → ${5+next*3}`;
  return `<div class="shopItem upgradeItem"><div><b>${it.name} ${level}/5</b><span>${it.desc}</span><small>${effect} • Limite ${cap}</small></div><button class="shopBuy" data-upgrade="${kind}" ${disabled?'disabled':''}>${atMax?'Máximo':atCap?'Limite':cost+' pts'}</button></div>`;
}
function buyItem(id){
  const users=getUsers(),u=users[playerKey]; if(!u||!shopUnlocked())return;
  refreshShopIfNeeded(u);u.coins=Number(u.coins||0);u.shop=u.shop||{};
  if(id==="healthUp"||id==="shieldUp"){
    const kind=id==="healthUp"?"health":"shield", level=Number(u.shop.upgrades?.[kind]||0), cap=UPGRADE_LIMIT_BY_LEVEL[levelKey]||0;
    const total=Number(u.shop.upgrades?.health||0)+Number(u.shop.upgrades?.shield||0), it=SHOP_ITEMS[id], cost=it.costs[level];
    if(level>=5||total>=cap||u.coins<cost)return;
    u.shop.upgrades[kind]=level+1;u.coins-=cost;
  } else {
    const it=SHOP_ITEMS[id];
    if(u.coins<it.cost)return;
    if(id==="double"&&u.shop.double)return;
    if(id!=="double") {
      const stock=Number(u.shop.stock[id]||0), purchases=Number(u.shop.purchases[id]||0);
      if(stock<=0||purchases>=it.limit)return;
      u.shop.stock[id]=stock-1;u.shop.purchases[id]=purchases+1;u.shop[id]=Number(u.shop[id]||0)+1;
    } else u.shop.double=true;
    u.coins-=it.cost;
  }
  users[playerKey]=u;saveUsers(users);renderShop();
}
function openShop(){if(!shopUnlocked()){alert("A loja libera quando a dificuldade Médio estiver desbloqueada.");return;}renderShop();$("shopOverlay").classList.remove("hidden");}
function closeShop(){$("shopOverlay").classList.add("hidden")}
function getUsers(){try{return JSON.parse(localStorage.getItem("pulseKeysUsers")||"{}")}catch(e){return {}}}
function saveUsers(users){localStorage.setItem("pulseKeysUsers",JSON.stringify(users))}
function ensureAdminAccount(){
  const users=getUsers();
  const old=users.arthur||{};
  users.arthur={...old,name:"Arthur",password:"1234",best:Number(old.best||0),admin:true};
  saveUsers(users);
}
ensureAdminAccount();

function userKey(name){return name.trim().toLowerCase()}


function currentSong(){return pkAllSongsForLevel().find(s=>s.key===songKey)||pkAllSongsForLevel()[0]}
function pkCustomSongs(){
  try{return JSON.parse(localStorage.getItem("pulseKeysCustomSongs")||"[]");}catch(e){return []}
}
function pkSaveCustomSongs(list){localStorage.setItem("pulseKeysCustomSongs",JSON.stringify(list))}
function pkYoutubeId(url){
  try{
    const u=new URL(url);
    if(u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if(u.hostname.includes("youtube.com")){
      if(u.pathname==="/watch") return u.searchParams.get("v");
      const m=u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/); if(m)return m[1];
    }
  }catch(e){}
  return null;
}
function pkCustomSongsForLevel(){return pkCustomSongs().filter(s=>s.level===levelKey)}
function pkCustomSongByKey(key){return pkCustomSongs().find(s=>s.key===key)||null}
function pkEnsureCustomMusicUI(){
  if(document.getElementById("pkCustomMusicBox")){
    pkRenderCustomMusicList();
    return;
  }

  // Cria a área de música diretamente no menu, sem depender
  // de uma estrutura específica do HTML.
  const settings=document.getElementById("gameSettings")||document.body;
  const box=document.createElement("div");

  box.id="pkCustomMusicBox";
  box.className="customMusicBox";
  box.style.cssText=[
    "display:block",
    "width:100%",
    "box-sizing:border-box",
    "margin:16px 0",
    "padding:16px",
    "border-radius:14px",
    "border:2px solid rgba(255,255,255,.22)",
    "background:rgba(20,20,30,.92)",
    "color:#fff",
    "position:relative",
    "z-index:20"
  ].join(";");

  box.innerHTML=`
    <div style="font-size:18px;font-weight:800;margin-bottom:8px">
      🎵 Sua música
    </div>

    <div style="font-size:13px;opacity:.9;margin-bottom:12px;line-height:1.4">
      Cole o link de um vídeo do YouTube para adicionar sua própria música.
      Ela ficará salva neste navegador e aparecerá na dificuldade selecionada.
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input
        id="pkCustomMusicName"
        type="text"
        maxlength="50"
        placeholder="Nome da música (opcional)"
        autocomplete="off"
        style="flex:1 1 180px;min-width:180px;box-sizing:border-box;padding:10px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:#111;color:#fff"
      >

      <input
        id="pkCustomMusicUrl"
        type="url"
        placeholder="https://www.youtube.com/watch?v=..."
        autocomplete="off"
        style="flex:2 1 280px;min-width:240px;box-sizing:border-box;padding:10px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:#111;color:#fff"
      >

      <button
        id="pkAddCustomMusic"
        type="button"
        style="padding:10px 14px;cursor:pointer"
      >
        ➕ Adicionar música
      </button>
    </div>

    <div style="margin-top:10px;padding:9px 10px;border-radius:9px;background:rgba(255,255,255,.06);font-size:13px;line-height:1.4">
      🎶 <b>Quanto mais louca é a música, mais difícil fica!</b><br>
      O ritmo começa mais tranquilo e acelera conforme você acerta notas.
    </div>

    <div
      id="pkCustomMusicList"
      style="display:block;margin-top:12px"
    ></div>
  `;

  // Tenta colocar dentro das configurações. Se a página tiver uma
  // estrutura diferente, coloca diretamente no body para garantir que apareça.
  if(settings&&settings!==document.body){
    settings.appendChild(box);
  }else{
    document.body.appendChild(box);
  }

  const addButton=document.getElementById("pkAddCustomMusic");
  const urlInput=document.getElementById("pkCustomMusicUrl");

  if(addButton){
    addButton.addEventListener("click",e=>{
      e.preventDefault();
      e.stopPropagation();
      pkAddCustomMusic();
    });

    addButton.addEventListener("pointerdown",e=>{
      e.stopPropagation();
    });
  }

  if(urlInput){
    urlInput.addEventListener("keydown",e=>{
      if(e.key==="Enter"){
        e.preventDefault();
        pkAddCustomMusic();
      }
    });
  }

  pkRenderCustomMusicList();
}

function pkAddCustomMusic(){
  const input=document.getElementById("pkCustomMusicUrl"),nameInput=document.getElementById("pkCustomMusicName");
  if(!input)return;
  const url=input.value.trim(),id=pkYoutubeId(url);
  if(!id){alert("Cole um link válido do YouTube.");return}
  const list=pkCustomSongs();
  if(list.some(s=>s.youtubeId===id)){alert("Essa música já foi adicionada.");return}
  const title=(nameInput.value.trim()||"Minha música")+" — YouTube";
  const difficulty=levels[levelKey]?.label||levelKey;
  const item={key:"custom-"+Date.now(),title,bpm:140,notes:[261.63,329.63,392,523.25,392,329.63,293.66,392],youtube:"https://www.youtube.com/watch?v="+id,youtubeId:id,level:levelKey,difficulty,tag:"🎵 personalizada"};
  list.push(item);pkSaveCustomSongs(list);input.value="";nameInput.value="";songKey=item.key;updatePlaylist();pkRenderCustomMusicList();
  alert(`🎵 Música adicionada!\n\nDificuldade: ${difficulty}\n\nEla ficou salva nesta dificuldade e aparecerá na lista de músicas dela.`);
}
function pkRenderCustomMusicList(){
  const box=document.getElementById("pkCustomMusicList");if(!box)return;
  const list=pkCustomSongsForLevel();
  box.innerHTML=list.length?list.map(s=>{const diff=s.difficulty||levels[s.level]?.label||s.level||"—";return `<div style="display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap"><span style="flex:1">${s.title}<small style="display:block;opacity:.72">Dificuldade: ${diff}</small></span><button type="button" class="pkRemoveCustom" data-key="${s.key}">Remover</button></div>`}).join(""):"<small>Nenhuma música personalizada nesta dificuldade.</small>";
  box.querySelectorAll(".pkRemoveCustom").forEach(b=>b.addEventListener("pointerdown",e=>{e.preventDefault();pkRemoveCustomMusic(b.dataset.key)}));
}
function pkRemoveCustomMusic(key){
  const list=pkCustomSongs().filter(s=>s.key!==key);pkSaveCustomSongs(list);
  if(songKey===key)songKey=playlists[levelKey][0].key;updatePlaylist();pkRenderCustomMusicList();
}
function pkAllSongsForLevel(){return playlists[levelKey].concat(pkCustomSongsForLevel())}
let pkYoutubePlayer=null;
let pkYoutubeApiReady=false;
let pkYoutubeApiLoading=false;
let pkYoutubePendingSong=null;

function pkLoadYoutubeIframeAPI(){
  if(window.YT&&window.YT.Player){
    pkYoutubeApiReady=true;
    return Promise.resolve();
  }

  if(pkYoutubeApiLoading){
    return new Promise(resolve=>{
      const check=()=>{
        if(window.YT&&window.YT.Player){
          pkYoutubeApiReady=true;
          resolve();
        }else{
          setTimeout(check,50);
        }
      };
      check();
    });
  }

  pkYoutubeApiLoading=true;

  return new Promise(resolve=>{
    const previousReady=window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady=function(){
      pkYoutubeApiReady=true;

      if(typeof previousReady==="function"){
        try{previousReady();}catch(e){}
      }

      resolve();

      if(pkYoutubePendingSong){
        const song=pkYoutubePendingSong;
        pkYoutubePendingSong=null;
        pkCreateYoutubePlayer(song);
      }
    };

    const existing=document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if(!existing){
      const tag=document.createElement("script");
      tag.src="https://www.youtube.com/iframe_api";
      tag.async=true;
      document.head.appendChild(tag);
    }
  });
}

function pkCreateYoutubePlayer(song){
  if(!song||!song.youtubeId)return;

  let host=document.getElementById("pkYoutubePlayerHost");

  if(!host){
    host=document.createElement("div");
    host.id="pkYoutubePlayerHost";
    host.style.cssText=[
      "position:fixed",
      "left:-10000px",
      "top:-10000px",
      "width:200px",
      "height:200px",
      "overflow:hidden",
      "opacity:0",
      "pointer-events:none",
      "z-index:-1"
    ].join(";");
    document.body.appendChild(host);
  }

  host.innerHTML="";

  pkYoutubePlayer=new YT.Player(host,{
    width:200,
    height:200,
    videoId:song.youtubeId,
    playerVars:{
      autoplay:1,
      controls:0,
      playsinline:1,
      rel:0,
      enablejsapi:1
    },
    events:{
      onReady:event=>{
        event.target.setVolume(muted?0:volume);
        event.target.playVideo();
      },
      onStateChange:event=>{
        if(window.YT&&YT.PlayerState&&event.data===YT.PlayerState.ENDED){
          if(pkIsInfinite()&&running&&!infiniteStageEnding){infiniteStageEnding=true;beginEndingPhase();}
          else event.target.stopVideo();
        }
      },
      onError:event=>{
        console.warn("YouTube IFrame API error:",event.data);
      }
    }
  });
}

function pkStartYoutubeMusic(song){
  if(!song||!song.youtubeId)return;

  pkYoutubePendingSong=song;

  pkLoadYoutubeIframeAPI().then(()=>{
    if(pkYoutubePendingSong){
      const pending=pkYoutubePendingSong;
      pkYoutubePendingSong=null;
      pkCreateYoutubePlayer(pending);
      return;
    }

    if(pkYoutubePlayer&&typeof pkYoutubePlayer.loadVideoById==="function"){
      pkYoutubePlayer.loadVideoById(song.youtubeId);
      pkYoutubePlayer.setVolume(muted?0:volume);
    }
  });
}

function pkStopYoutubeMusic(){
  try{
    if(pkYoutubePlayer){
      if(typeof pkYoutubePlayer.stopVideo==="function")pkYoutubePlayer.stopVideo();
      if(typeof pkYoutubePlayer.destroy==="function")pkYoutubePlayer.destroy();
    }
  }catch(e){}
  pkYoutubePlayer=null;
  pkYoutubePendingSong=null;
  const host=document.getElementById("pkYoutubePlayerHost");
  if(host)host.innerHTML="";
}
function updatePlaylist(){
  const list=pkAllSongsForLevel();
  if(!list.some(s=>s.key===songKey))songKey=list[0].key;
  const select=$("songSelect");
  select.innerHTML=list.map(s=>`<option value="${s.key}">${s.title}</option>`).join("");
  select.value=songKey;
  $("playlistInfo").textContent=`${levels[levelKey].label}: ${list.map(s=>s.title.split(" — ")[0]).join(" • ")}`;
  $("songLinks").innerHTML=list.map(s=>`<div class="songLinkRow"><span>${s.tag}</span><a href="${s.youtube}" target="_blank" rel="noopener noreferrer">${s.title}</a></div>`).join("");
  pkEnsureCustomMusicUI();pkRenderCustomMusicList();pkEnsureModeUI();pkSyncModeUI();
}

function showTab(tab){
  const reg=tab==="register";
  $("registerPanel").classList.toggle("hidden",!reg);$("loginPanel").classList.toggle("hidden",reg);
  $("registerTab").classList.toggle("active",reg);$("loginTab").classList.toggle("active",!reg);
}
$("registerTab").addEventListener("pointerdown",e=>{e.preventDefault();showTab("register")});
$("loginTab").addEventListener("pointerdown",e=>{e.preventDefault();showTab("login")});

$("registerBtn").addEventListener("pointerdown",e=>{
  e.preventDefault();
  const name=$("registerName").value.trim(),pass=$("registerPassword").value.trim();
  if(!name){alert("Digite um nome.");return}
  if(!/^\d{4,6}$/.test(pass)){alert("A senha deve ter de 4 a 6 números.");return}
  const users=getUsers(),key=userKey(name);
  if(users[key]){alert("Esse nome já está cadastrado. Use a aba Entrar.");return}
  users[key]={name,password:pass,best:0};saveUsers(users);
  player=users[key].name;playerKey=key;
  localStorage.setItem("pulseKeysPlayer",player);localStorage.setItem("pulseKeysPlayerKey",playerKey);
  enterGameMenu();
});

// $("loginBtn").addEventListener("pointerdown",e=>{
//   e.preventDefault();
//   const name=$("loginName").value.trim(),pass=$("loginPassword").value.trim();
//   const users=getUsers(),key=userKey(name);
//   if(!users[key]||users[key].password!==pass){$("loginInfo").textContent="Nome ou senha incorretos.";return}
//   player=users[key].name;playerKey=key;
//   localStorage.setItem("pulseKeysPlayer",player);localStorage.setItem("pulseKeysPlayerKey",playerKey);
//   $("loginInfo").textContent="";enterGameMenu();
// });
function doLogin(e){
  if(e){
    e.preventDefault();
    e.stopPropagation();
  }

  const name=$("loginName").value.trim();
  const pass=$("loginPassword").value.trim();

  const users=getUsers();
  const key=userKey(name);

  if(!users[key]||users[key].password!==pass){
    $("loginInfo").textContent="Nome ou senha incorretos.";
    return;
  }

  player=users[key].name;
  playerKey=key;

  localStorage.setItem("pulseKeysPlayer",player);
  localStorage.setItem("pulseKeysPlayerKey",playerKey);

  $("loginInfo").textContent="";
  enterGameMenu();
}

$("loginBtn").addEventListener("pointerdown",doLogin,{passive:false});
$("loginBtn").addEventListener("click",doLogin,{passive:false});
$("levelSelect").addEventListener("change",()=>{levelKey=$("levelSelect").value;updatePlaylist()});
$("songSelect").addEventListener("change",()=>{songKey=$("songSelect").value});
$("startBtn").addEventListener("pointerdown",e=>{e.preventDefault();startGame()});
$("pauseBtn").addEventListener("pointerdown",e=>{e.preventDefault();togglePause()});
$("resumeBtn").addEventListener("pointerdown",e=>{e.preventDefault();resumeGame()});
$("restartPausedBtn").addEventListener("pointerdown",e=>{e.preventDefault();startGame()});
$("lobbyPausedBtn").addEventListener("pointerdown",e=>{e.preventDefault();goToLobby()});
$("againBtn").addEventListener("pointerdown",e=>{e.preventDefault();if(!pkIsInfinite())startGame()});
$("resultLobbyBtn").addEventListener("pointerdown",e=>{e.preventDefault();goToLobby()});
$("muteBtn").addEventListener("pointerdown",e=>{e.preventDefault();toggleMute()});
$("volumeBtn").addEventListener("pointerdown",e=>{e.preventDefault();toggleVolumePanel()});
$("volumeRange").addEventListener("input",e=>setVolume(Number(e.target.value)));
$("shopBtn").addEventListener("pointerdown",e=>{e.preventDefault();openShop()});
$("reviveBtn").addEventListener("pointerdown",e=>{e.preventDefault();useRevive()});
$("closeShopBtn").addEventListener("pointerdown",e=>{e.preventDefault();closeShop()});
document.getElementById("adminCodeClose")?.addEventListener("pointerdown",e=>{e.preventDefault();pkCloseAdminCode();});
$("tutorialOverlay").addEventListener("pointerdown",e=>{e.preventDefault();if(tutorialActive)beginActualGame()});

function pkInfiniteStageText(){return `∞ Infinito • Estágio ${infiniteStage} • ${pkInfiniteStageSpeed(infiniteStage)}× • ${infiniteStageScore}/${PK_INFINITE_STAGE_TARGET} pts`;}
function pkInfiniteRewardMultiplier(){return pkInfiniteStageSpeed(infiniteStage);}
function pkShowInfiniteStageMessage(completedStage, rewardCoins, nextStage){
  const message=document.getElementById("resultText"),tier=document.getElementById("scoreTier"),overlay=document.getElementById("resultOverlay"),again=document.getElementById("againBtn"),lobby=document.getElementById("resultLobbyBtn"),finalScore=document.getElementById("finalScore");
  if(!message||!tier||!overlay)return;
  const mult=pkInfiniteStageSpeed(completedStage);
  tier.textContent=`Estágio ${completedStage} concluído!`;
  if(finalScore)finalScore.textContent=String(rewardCoins);
  message.innerHTML=`<div style="font-size:1.05em;line-height:1.5"><b>Parabéns, você passou do ${completedStage}º estágio!</b><br>Seu ganho deste estágio foi <b>${rewardCoins}</b> moedas.<br>Multiplicador: <b>${mult}×</b>.<br><br>${completedStage===5?`Você finalizou todos os cinco estágios. Você está pronto para começar os próximos cinco estágios, mais difíceis do que os anteriores!<br>O último foi <b>3,5×</b>. O próximo será <b>4×</b>.`:`O próximo estágio será <b>${pkInfiniteStageSpeed(nextStage)}×</b>.`}</div>`;
  if(again){again.textContent=`▶️ Próximo estágio (${nextStage})`;again.classList.remove("hidden");again.onclick=null;again.addEventListener("pointerdown",pkNextInfiniteFromOverlay,{once:true});}
  if(lobby){lobby.textContent="🏠 Voltar ao lobby";lobby.classList.remove("hidden");}
  overlay.classList.remove("hidden");
}
function pkNextInfiniteFromOverlay(e){
  e&&e.preventDefault();
  const overlay=document.getElementById("resultOverlay"); if(overlay)overlay.classList.add("hidden");
  if(!running||!pkIsInfinite())return;
  infiniteStageEnding=false;
  startTime=performance.now();
  totalPaused=0;
  activeDuration=pkInfiniteStageHasTimer()?PK_INFINITE_NOOB_TEST_TIME:PK_INFINITE_DURATION;
  if(spawnTimer){clearTimeout(spawnTimer);spawnTimer=null;}
  clearTiles();
  if(pkYoutubePlayer&&typeof pkYoutubePlayer.setPlaybackRate==="function"){try{pkYoutubePlayer.setPlaybackRate(Math.min(2,pkInfiniteStageSpeed(infiniteStage)));}catch(e){}}
  spawnTile();scheduleSpawn();
}
function pkAdvanceInfiniteStage(){
  if(!pkIsInfinite()||!running)return;
  const completedStage=infiniteStage;
  const rewardCoins=Math.round(infiniteStageScore*pkInfiniteRewardMultiplier());
  const users=getUsers(),u=users[playerKey];
  if(u){
    refreshShopIfNeeded(u);
    u.coins=Number(u.coins||0)+rewardCoins;
    users[playerKey]=u;
    saveUsers(users);
  }
  infiniteStage++;
  infiniteStageScore=0;
  infiniteStageEnding=false;
  clearTiles();
  if(spawnTimer){clearTimeout(spawnTimer);spawnTimer=null;}
  pkShowInfiniteStageMessage(completedStage,rewardCoins,infiniteStage);
}
function applyPlayerStats(consumeShield=false){
  const u=shopState(),stats=upgradeStats(u);
  maxHealth=stats.maxHealth;
  maxShield=stats.maxShield;
  health=maxHealth;
  const hasPurchasedShield=Number(u.shop?.shield||0)>0;
  shield=hasPurchasedShield?maxShield:0;
  if(consumeShield&&hasPurchasedShield){u.shop.shield=Number(u.shop.shield)-1;const users=getUsers();users[playerKey]=u;saveUsers(users);}
  updateLifeHud();
}
function updateLifeHud(){
  const hp=Math.max(0,health),sh=Math.max(0,shield);
  const hpEl=$("healthText"),shEl=$("shieldText"),hpFill=$("healthFill"),shFill=$("shieldFill");
  if(hpEl)hpEl.textContent=`${hp}/${maxHealth}`;
  if(shEl)shEl.textContent=`${sh}/${maxShield}`;
  if(hpFill)hpFill.style.width=`${maxHealth?hp/maxHealth*100:0}%`;
  if(shFill)shFill.style.width=`${maxShield?sh/maxShield*100:0}%`;
}
function takeDamage(amount,pointsLoss=amount){
  amount=Math.max(0,Number(amount)||0); if(!amount||!running)return;
  let remaining=amount;
  const absorbed=Math.min(shield,remaining);shield-=absorbed;remaining-=absorbed;
  health=Math.max(0,health-remaining);
  if(!pkIsInfinite()) if(!pkIsInfinite()) score=Math.max(0,score-Math.max(0,Number(pointsLoss)||0));
  updateLifeHud();$("score").textContent=score;
  if(health<=0)die();
}
function die(){
  if(!running)return;
  running=false;endingPhase=false;paused=false;clearTimers();clearTiles();stopAudio();
  gameWon=false;reviveMultiplier=1;
  const users=getUsers(),u=users[playerKey];
  if(u){
    // A death does not bank the attempt's points.
    users[playerKey]=u;saveUsers(users);
  }
  $("finalScore").textContent="0";
  $("scoreTier").textContent="Derrota";
  $("resultText").textContent=`Sua vida chegou a 0. Você perdeu ${levelKey==="marcus"?"a tentativa":"a partida"}.`;
  const reviveBtn=$("reviveBtn"),available=Number(shopState().shop.revive||0)>0;
  reviveBtn.classList.toggle("hidden",!available);
  $("resultOverlay").classList.remove("hidden");
}

function hitLane(lane,touchY=null){
  if(!running||paused)return;
  const now=performance.now();if(now-lastPointer<120)return;lastPointer=now;
  const rect=$("board").getBoundingClientRect();
  const tiles=[...document.querySelectorAll(`.lane[data-lane="${lane}"] .tile`)];
  if(!tiles.length){score=Math.max(0,score-1);$("score").textContent=score;return}
  if(touchY===null)touchY=rect.height*.78;
  let best=null,dist=Infinity;
  for(const tile of tiles){const tr=tile.getBoundingClientRect(),center=tr.top+tr.height/2-rect.top,d=Math.abs(center-touchY);if(d<dist){dist=d;best=tile}}
  if(best&&dist<135)hitTile(best,lane);else{score=Math.max(0,score-1);$("score").textContent=score}
}

$("board").addEventListener("pointerdown",e=>{
  e.preventDefault();
  if(!running||paused)return;
  const rect=$("board").getBoundingClientRect(),x=e.clientX-rect.left;
  const lane=Math.max(0,Math.min(2,Math.floor(x/(rect.width/3))));
  hitLane(lane,e.clientY-rect.top);
});

document.addEventListener("keydown",e=>{
  if(tutorialActive){if(["ArrowLeft","ArrowUp","ArrowRight","a","A","w","W","d","D","Enter"," "].includes(e.key)){e.preventDefault();beginActualGame()}return}
  if(!running||paused)return;
  const map={ArrowLeft:0,ArrowUp:1,ArrowRight:2,a:0,A:0,w:1,W:1,d:2,D:2};
  if(Object.prototype.hasOwnProperty.call(map,e.key)){e.preventDefault();hitLane(map[e.key]);}
  if(e.key==="Escape"){e.preventDefault();togglePause();}
});

const PK_ADMIN_CODE_SNIPPETS=[{"title":"🎵 Música — startAudio()","description":"Inicia a música escolhida. Se ela for do YouTube, usa o player do YouTube; caso contrário, inicia o áudio criado pelo próprio jogo.","code":"function startAudio(){\n  const selected=currentSong();\n  if(selected&&selected.youtubeId){\n    pkStopYoutubeMusic();\n    pkStartYoutubeMusic(selected);\n    return;\n  }\n  pkStopYoutubeMusic();\n  if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();\n  if(audioCtx.state===\"suspended\")audioCtx.resume();\n}"},{"title":"⬇️ Notas — spawnTile()","description":"Cria uma peça, escolhe uma das três pistas e define os pontos e a aparência da nota.","code":"function spawnTile(){\n  if(!running||paused||endingPhase)return;\n  const lanes=[0,1,2].sort(()=>Math.random()-.5);\n  let lane=lanes.find(l=>{\n    const last=$(\"board\").children[l].querySelector(\".tile:last-child\");\n    if(!last)return true;\n    return parseFloat(last.dataset.y||\"-145\")>179;\n  });\n  if(lane===undefined)return;\n  const tile=document.createElement(\"div\");\n  const note=pickNoteStyle();\n  tile.className=\"tile\";\n  tile.dataset.lane=lane;\n  tile.dataset.points=String(note.points);\n  tile.style.background=note.color;\n  $(\"board\").children[lane].appendChild(tile);\n}"},{"title":"👆 Touch — hitLane() + pointerdown","description":"Detecta onde o jogador tocou, identifica uma das três pistas e procura a peça mais próxima da área de acerto.","code":"function hitLane(lane,touchY=null){\n  if(!running||paused)return;\n  const now=performance.now();\n  if(now-lastPointer<120)return;\n  lastPointer=now;\n  const rect=$(\"board\").getBoundingClientRect();\n  const tiles=[...document.querySelectorAll(`.lane[data-lane=\"${lane}\"] .tile`)];\n  if(!tiles.length)return;\n  if(touchY===null)touchY=rect.height*.78;\n  let best=null,dist=Infinity;\n  for(const tile of tiles){\n    const tr=tile.getBoundingClientRect();\n    const center=tr.top+tr.height/2-rect.top;\n    const d=Math.abs(center-touchY);\n    if(d<dist){dist=d;best=tile}\n  }\n  if(best&&dist<135)hitTile(best,lane);\n}\n\n$(\"board\").addEventListener(\"pointerdown\",e=>{\n  e.preventDefault();\n  const rect=$(\"board\").getBoundingClientRect();\n  const x=e.clientX-rect.left;\n  const lane=Math.max(0,Math.min(2,Math.floor(x/(rect.width/3))));\n  hitLane(lane,e.clientY-rect.top);\n});"},{"title":"🎯 Acerto — hitTile()","description":"Registra o acerto, soma os pontos da nota e prepara a próxima peça.","code":"function hitTile(tile,lane){\n  if(!tile||!tile.isConnected)return;\n  const points=Number(tile.dataset.points||1);\n  score+=points;\n  hits++;\n  if(pkIsInfinite())infiniteStageScore+=points;\n  $(\"score\").textContent=score;\n  tile.classList.add(\"good\");\n  setTimeout(()=>tile.remove(),130);\n  beep(330+lane*90,.045);\n  scheduleSpawn();\n}"},{"title":"❤️🛡️ Vida e escudo — takeDamage()","description":"Controla o dano: primeiro o escudo absorve o máximo possível; o restante é descontado da vida.","code":"function takeDamage(amount,pointsLoss=amount){\n  amount=Math.max(0,Number(amount)||0);\n  if(!amount||!running)return;\n  let remaining=amount;\n  const absorbed=Math.min(shield,remaining);\n  shield-=absorbed;\n  remaining-=absorbed;\n  health=Math.max(0,health-remaining);\n  score=Math.max(0,score-Math.max(0,Number(pointsLoss)||0));\n  updateLifeHud();\n  $(\"score\").textContent=score;\n  if(health<=0)die();\n}"},{"title":"♻️ Ressuscitar — useRevive()","description":"Consome um Reviver comprado na loja, faz a contagem regressiva e reinicia a tentativa.","code":"function useRevive(){\n  const users=getUsers(),u=users[playerKey];\n  if(!u)return;\n  refreshShopIfNeeded(u);\n  if(Number(u.shop.revive||0)<=0)return;\n  u.shop.revive=Number(u.shop.revive)-1;\n  users[playerKey]=u;\n  saveUsers(users);\n  $(\"resultOverlay\").classList.add(\"hidden\");\n  $(\"game\").classList.remove(\"hidden\");\n  reviveMultiplier=2;\n  gameWon=false;\n  score=0;\n  hits=0;\n}"}];

function pkRenderAdminCode(){
  const panel=document.getElementById("adminCodePanel");
  const list=document.getElementById("adminCodeList");
  if(!panel||!list)return;
  const isAdmin=playerKey==="arthur" || !!getUsers()[playerKey]?.admin;
  if(!isAdmin){panel.classList.add("hidden");return;}
  list.innerHTML=PK_ADMIN_CODE_SNIPPETS.map((item,index)=>`<article class="adminCodeCard"><div class="adminCodeTitle">${item.title}</div><p>${item.description}</p><pre><code>${item.code.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</code></pre></article>`).join("");
}
function pkOpenAdminCode(){
  if(playerKey!=="arthur" && !getUsers()[playerKey]?.admin)return;
  pkRenderAdminCode();
  document.getElementById("adminCodePanel")?.classList.remove("hidden");
}
function pkCloseAdminCode(){document.getElementById("adminCodePanel")?.classList.add("hidden");}

function enterGameMenu(){
  $("registerPanel").classList.add("hidden");$("loginPanel").classList.add("hidden");$("gameSettings").classList.remove("hidden");
  $("welcomeText").textContent=`Olá, ${player}! Escolha primeiro a dificuldade e depois uma música.`;
  updateBest();updatePlaylist();renderColorGuide();pkEnsureModeUI();pkSyncModeUI();pkRenderAdminCode();
  const isAdmin=playerKey==="arthur" || !!getUsers()[playerKey]?.admin;
  let adminBtn=document.getElementById("adminCodeBtn");
  if(isAdmin && !adminBtn){
    adminBtn=document.createElement("button");
    adminBtn.id="adminCodeBtn";adminBtn.className="secondary adminCodeBtn";adminBtn.textContent="💻 Ver código principal";
    adminBtn.addEventListener("pointerdown",e=>{e.preventDefault();pkOpenAdminCode();});
    const settings=document.getElementById("gameSettings");
    const best=document.getElementById("bestInfo");
    if(settings&&best)settings.insertBefore(adminBtn,best);
  }
  if(!isAdmin && adminBtn)adminBtn.remove();
}
function renderColorGuide(){
  const box=$("colorGuide");
  if(!box)return;
  box.innerHTML=PK_NOTE_SCORES.map(n=>`<div class="colorGuideItem"><span class="colorSwatch" style="background:${n.color};${n.name==="Preto"?"box-shadow:0 0 0 2px rgba(255,255,255,.45)":""}"></span><span><b>${n.name}</b><small>${n.points} ponto${n.points===1?"":"s"}</small></span></div>`).join("");
}

function updateBest(){const u=getUsers()[playerKey];$("bestInfo").textContent=u?`Melhor pontuação de ${player}: ${u.best}`:""}
function goToLobby(){
  running=false;paused=false;clearTimers();clearTiles();stopAudio();
  $("pauseOverlay").classList.add("hidden");$("resultOverlay").classList.add("hidden");$("game").classList.add("hidden");$("menu").classList.remove("hidden");
  enterGameMenu();
}

function ramp(){
  if(!running)return 1;
  const elapsed=Math.max(0,performance.now()-startTime-totalPaused);
  const progress=pkIsInfinite()?Math.min(1,elapsed/60000):Math.min(1,elapsed/Math.max(1,activeDuration||levels[levelKey].duration));
  const early=Math.min(1,hits/5);
  // Começa suave. Depois do 5º acerto, a aceleração fica bem mais forte.
  const timeRamp=Math.min(1,progress/0.34);
  const clickRamp=hits<5?(0.42+0.58*early):(1+Math.min(0.25,(hits-5)*0.025));
  return Math.min(1.28,0.42+0.58*Math.max(timeRamp,early)+(clickRamp-1)*0.65);
}
function currentSpeed(){
  if(pkIsInfinite())return pkInfiniteDifficultyFactor()*pkInfiniteStageSpeed(infiniteStage);
  return levels[levelKey].speed*ramp();
}
function currentSpawn(){
  if(pkIsInfinite())return Math.max(150,levels[levelKey].spawn/Math.max(1,pkInfiniteStageSpeed(infiniteStage)));
  return Math.max(170,levels[levelKey].spawn/(0.72+0.58*ramp()));
}

function spawnTile(){
  if(!running||paused||endingPhase)return;
  const lanes=[0,1,2].sort(()=>Math.random()-.5);
  const tileHeight=window.innerWidth<=700?125:145;
  let lane=lanes.find(l=>{
    const last=$("board").children[l].querySelector(".tile:last-child");
    if(!last)return true;
    return parseFloat(last.dataset.y||"-145")>tileHeight+34;
  });
  if(lane===undefined)return;
  const tile=document.createElement("div");
  const note=pickNoteStyle();
  tile.className="tile";
  tile.dataset.lane=lane;
  tile.dataset.points=String(note.points);
  tile.dataset.noteColor=note.name;
  tile.style.top=`-${tileHeight}px`;
  tile.dataset.y=`-${tileHeight}`;
  tile.style.background=note.color;
  if(note.name==="Preto") tile.style.boxShadow="0 0 0 2px rgba(255,255,255,.45), 0 8px 24px rgba(0,0,0,.55)";
  $("board").children[lane].appendChild(tile);
  window.pkTotalNotes=Number(window.pkTotalNotes||0)+1;
}
function scheduleSpawn(){
  if(spawnTimer)clearTimeout(spawnTimer);
  if(!running||paused||endingPhase)return;
  spawnTimer=setTimeout(()=>{spawnTile();scheduleSpawn()},currentSpawn());
}
function animate(){if(!raf)raf=requestAnimationFrame(frame)}
function frame(){
  raf=requestAnimationFrame(frame);if(!running||paused)return;
  const bottom=$("board").clientHeight;
  document.querySelectorAll(".tile").forEach(tile=>{
    let y=parseFloat(tile.dataset.y);y+=currentSpeed()*8;tile.dataset.y=y;tile.style.top=y+"px";
    if(y>bottom-45){
      const points=Number(tile.dataset.points||1);
      tile.remove();
      window.pkMissNotes++;
      takeDamage(points,points);
      if(!running)return;
    }
  });
  checkLevelClear();
}
function hitTile(tile,lane){
  if(!tile||!tile.isConnected)return;
  const points=Number(tile.dataset.points||1);
  score+=points;
  hits++;
  if(pkIsInfinite())infiniteStageScore+=points;
  $("score").textContent=score;
  if(pkIsInfinite()&&infiniteStageScore>=PK_INFINITE_STAGE_TARGET&&!infiniteStageEnding){infiniteStageEnding=true;beginEndingPhase();}
  tile.classList.add("good");setTimeout(()=>tile.remove(),130);beep(330+lane*90,.045);
  scheduleSpawn();
}
function beginEndingPhase(){
  if(endingPhase||!running)return;
  endingPhase=true;
  if(spawnTimer){clearTimeout(spawnTimer);spawnTimer=null;}
  $("speedReadout").textContent=pkIsInfinite()?"Estágio concluído — finalizando notas...":"Finalizando notas...";
  checkLevelClear();
}
function checkLevelClear(){
  if(running&&endingPhase&&document.querySelectorAll(".tile").length===0){
    if(pkIsInfinite()){endingPhase=false;pkAdvanceInfiniteStage();}
    else finishGame();
  }
}
function updateClock(){
  if(!running||paused)return;
  const elapsed=performance.now()-startTime-totalPaused;
  if(pkIsInfinite()){
    if(pkInfiniteStageHasTimer()){
      const remain=Math.max(0,PK_INFINITE_NOOB_TEST_TIME-elapsed);
      $("time").textContent=(remain/1000).toFixed(1);
      $("speedReadout").textContent=pkInfiniteStageText()+` • ${hits} acertos • teste`;
      if(remain<=0)beginEndingPhase();
    }else{
      $("time").textContent="∞";
      $("speedReadout").textContent=pkInfiniteStageText()+` • ${hits} acertos`;
    }
    return;
  }
  const remain=Math.max(0,(activeDuration||levels[levelKey].duration)-elapsed);
  $("time").textContent=(remain/1000).toFixed(1);
  $("speedReadout").textContent=`Velocidade ${currentSpeed().toFixed(2)}× • ${hits} acertos`;
  if(remain<=0)beginEndingPhase();
}

function togglePause(){if(!running)return;paused=true;pausedAt=performance.now();$("pauseOverlay").classList.remove("hidden")}
function resumeGame(){if(!running)return;totalPaused+=performance.now()-pausedAt;paused=false;$("pauseOverlay").classList.add("hidden");scheduleSpawn();playMelodyBeat()}
function finishGame(){
  if(!running)return;
  running=false;endingPhase=false;paused=false;clearTimers();clearTiles();stopAudio();
  gameWon=true;
  const rewardMultiplier=reviveMultiplier>1?reviveMultiplier:((shopState().shop&&shopState().shop.double)?2:1);
  awardCoins();
  const rewardedScore=score*rewardMultiplier;
  const users=getUsers(),u=users[playerKey],best=u?Number(u.best||0):0;
  if(u&&rewardedScore>best){u.best=rewardedScore;saveUsers(users)}
  $("finalScore").textContent=rewardedScore;
  const tier=pkTierFromAccuracy();lastResultTier=tier;
  $("resultText").textContent=rewardedScore>best?`Novo recorde! • ${rewardMultiplier}× recompensa`:`Você terminou com vida! • ${rewardMultiplier}× recompensa`;
  pkRecordResult(levelKey,tier);
  const tierEl=$("scoreTier"); if(tierEl)tierEl.textContent=`Classificação: ${tier}`;
  $("reviveBtn").classList.add("hidden");
  $("resultOverlay").classList.remove("hidden");updateBest();
}
function useRevive(){
  const users=getUsers(),u=users[playerKey]; if(!u)return;
  refreshShopIfNeeded(u);
  if(Number(u.shop.revive||0)<=0)return;
  u.shop.revive=Number(u.shop.revive)-1;users[playerKey]=u;saveUsers(users);
  $("resultOverlay").classList.add("hidden");$("game").classList.remove("hidden");
  reviveMultiplier=2;gameWon=false;score=0;hits=0;window.pkHitNotes=0;window.pkMissNotes=0;window.pkTotalNotes=0;
  applyPlayerStats(true);
  const countdown=$("reviveCountdown");let n=3;
  if(countdown){countdown.classList.remove("hidden");countdown.textContent=String(n);}
  const tick=()=>{
    n--;
    if(n<=0){
      if(countdown)countdown.classList.add("hidden");
      clearTimers();clearTiles();running=true;paused=false;endingPhase=false;activeDuration=pkIsInfinite()?PK_INFINITE_DURATION:levels[levelKey].duration;startTime=performance.now();totalPaused=0;lastPointer=0;
      $("score").textContent="0";$("time").textContent=pkIsInfinite()?"∞":(activeDuration/1000).toFixed(1);$("speedReadout").textContent=pkIsInfinite()?"∞ Infinito • Reviver • 2× recompensa":"Reviver • 2× recompensa";spawnTile();scheduleSpawn();clockTimer=setInterval(updateClock,80);startAudio();animate();
      return;
    }
    if(countdown)countdown.textContent=String(n);setTimeout(tick,700);
  };
  setTimeout(tick,700);
}
function clearTiles(){document.querySelectorAll(".tile").forEach(t=>t.remove())}
function clearTimers(){if(spawnTimer)clearTimeout(spawnTimer);if(clockTimer)clearInterval(clockTimer);spawnTimer=clockTimer=null;if(melodyTimer)clearTimeout(melodyTimer);melodyTimer=null;if(raf){cancelAnimationFrame(raf);raf=null}}
function applyAudioVolume(){
  if(master)master.gain.value=muted?0:(volume/100)*0.12;
  $("volumeRange").value=String(volume);
  $("volumeValue").textContent=`${volume}%`;
  $("muteBtn").textContent=(muted||volume===0)?"🔇":"🔊";
}
function setVolume(v){volume=Math.max(0,Math.min(100,v));muted=volume===0;localStorage.setItem("pulseKeysVolume",String(volume));applyAudioVolume()}
function toggleMute(){if(muted){muted=false;if(volume===0)volume=70}else muted=true;applyAudioVolume()}
function toggleVolumePanel(){$("volumePanel").classList.toggle("hidden");applyAudioVolume()}

function startAudio(){
  const selected=currentSong();
  if(selected&&selected.youtubeId){
    pkStopYoutubeMusic();
    pkStartYoutubeMusic(selected);
    return;
  }
  pkStopYoutubeMusic();
  if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==="suspended")audioCtx.resume();
  if(master)master.disconnect();master=audioCtx.createGain();master.connect(audioCtx.destination);applyAudioVolume();
  melodyIndex=0;playMelodyBeat();
}
function playMelodyBeat(){
  if(!running||paused){melodyTimer=null;return}
  const s=currentSong(),speedRamp=Math.min(1.18,0.55+0.45*ramp());
  beep(s.notes[melodyIndex%s.notes.length],.09);melodyIndex++;
  const beat=(60000/s.bpm)/speedRamp;
  melodyTimer=setTimeout(playMelodyBeat,beat);
}
function stopAudio(){if(melodyTimer)clearTimeout(melodyTimer);melodyTimer=null;pkStopYoutubeMusic()}
function beep(freq,dur){
  if(!audioCtx||!master||muted)return;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="sine";o.frequency.value=freq;
  g.gain.setValueAtTime(.0001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.55,audioCtx.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+dur);
  o.connect(g);g.connect(master);o.start();o.stop(audioCtx.currentTime+dur+.02);
}

function startGame(){
  songKey=$("songSelect").value;levelKey=$("levelSelect").value;
  const modeSelect=document.getElementById("pkModeSelect");
  infiniteMode=!!modeSelect&&modeSelect.value==="infinite";
  if(typeof pkUnlocked==="function" && !pkUnlocked(levelKey)){ return; }
  if(infiniteMode&&!currentSong().youtubeId){alert("O modo infinito usa apenas músicas do YouTube.");return;}
  infiniteStage=1;infiniteStageScore=0;infiniteStageEnding=false;

  window.pkHitNotes=0; window.pkMissNotes=0; window.pkTotalNotes=0;

  score=0;hits=0;running=false;paused=false;endingPhase=false;resultRecorded=false;tutorialActive=true;startTime=0;totalPaused=0;lastPointer=0;activeDuration=levels[levelKey].duration;reviveMultiplier=1;gameWon=false;applyPlayerStats(false);
  $("score").textContent="0";$("time").textContent=(levels[levelKey].duration/1000).toFixed(1);$("speedReadout").textContent="Tutorial";
  $("pauseOverlay").classList.add("hidden");$("resultOverlay").classList.add("hidden");$("menu").classList.add("hidden");$("game").classList.remove("hidden");
  $("tutorialOverlay").classList.remove("hidden");
  $("tutorialDifficulty").textContent=`${levels[levelKey].label} • ${currentSong().title.split(" — ")[0]}`;
  $("tutorialSpeed").textContent=pkIsInfinite()?`Modo infinito: você joga até perder toda a vida. A dificuldade base é ${levels[levelKey].label}, com máximo de ${levels[levelKey].speed.toFixed(2)}×.`:`Começa suave e acelera depois dos primeiros 5 acertos. Máximo desta dificuldade: ${levels[levelKey].speed.toFixed(2)}×`;
  $("volumeSongLink").href=currentSong().youtube;
  $("volumeSongLink").textContent=`Ouvir referência: ${currentSong().title}`;
  clearTimers();clearTiles();stopAudio();
  $("songHud").textContent=`${pkIsInfinite()?"∞ Infinito • ":""}${levels[levelKey].label} • ${currentSong().title.split(" — ")[0]}`;
}

function beginActualGame(){
  if(!tutorialActive)return;
  tutorialActive=false;$("tutorialOverlay").classList.add("hidden");
  score=0;hits=0;running=true;endingPhase=false;paused=false;startTime=performance.now();totalPaused=0;lastPointer=0;activeDuration=pkIsInfinite()?(pkInfiniteStageHasTimer()?PK_INFINITE_NOOB_TEST_TIME:PK_INFINITE_DURATION):levels[levelKey].duration;reviveMultiplier=1;gameWon=false;applyPlayerStats(true);
  $("score").textContent="0";$("time").textContent=pkIsInfinite()?(pkInfiniteStageHasTimer()?(PK_INFINITE_NOOB_TEST_TIME/1000).toFixed(1):"∞"):(levels[levelKey].duration/1000).toFixed(1);$("speedReadout").textContent=pkIsInfinite()?pkInfiniteStageText()+" • Preparando...":"Preparando...";
  clearTimers();clearTiles();spawnTile();scheduleSpawn();clockTimer=setInterval(updateClock,80);startAudio();
  if(pkIsInfinite()&&pkYoutubePlayer&&typeof pkYoutubePlayer.setPlaybackRate==="function"){try{pkYoutubePlayer.setPlaybackRate(1);}catch(e){}}
  animate();
}

function resumeAudioNow(){
  try{
    if(typeof audioCtx!=="undefined" && audioCtx){
      if(audioCtx.state==="suspended") audioCtx.resume();
      if(typeof master!=="undefined" && master && audioCtx.currentTime){
        const v=Math.max(0,Math.min(100,Number(volume)||0))/100;
        const target=muted?0:v*0.12;
        master.gain.cancelScheduledValues(audioCtx.currentTime);
        master.gain.setTargetAtTime(target,audioCtx.currentTime,0.015);
      }
    }
  }catch(e){}
}
document.addEventListener("pointerdown",resumeAudioNow,{passive:true});
document.addEventListener("keydown",resumeAudioNow);

function pkUpdateDifficultyMission(){
  const el=document.getElementById("difficultyMission");
  if(!el || typeof levelKey==="undefined") return;
  el.textContent=pkUnlockText(levelKey);
  el.classList.toggle("locked",!pkUnlocked(levelKey));
}
document.addEventListener("DOMContentLoaded",()=>{
  pkUpdateDifficultyMission();
  const sel=document.getElementById("levelSelect")||document.getElementById("difficulty")||document.getElementById("level");
  if(sel) sel.addEventListener("change",()=>setTimeout(pkUpdateDifficultyMission,0));
});

function pkShowTier(){
  const el=document.getElementById("scoreTier");
  if(!el) return;
  const tier=pkTierFromAccuracy();
  el.textContent="Classificação: "+tier;

}
setInterval(()=>{
  const ov=document.getElementById("resultOverlay");
  if(ov && (ov.classList.contains("show") || getComputedStyle(ov).display!=="none")) pkShowTier();
},500);

setInterval(()=>{const ov=$("shopOverlay");if(ov&&!ov.classList.contains("hidden"))renderShop();},1000);
