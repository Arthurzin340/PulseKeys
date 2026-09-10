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

const PK_LEVEL_ORDER=["noob","medium","hard","insane","marcus"];
const PK_TIER_NAMES=["Ruim","Bom","Médio","Alto","Perfeito"];

function pkProgressAll(){
  try{return JSON.parse(localStorage.getItem("pulseKeysProgress")||"{}");}
  catch(e){return {};}
}

function pkSaveProgress(p){
  localStorage.setItem("pulseKeysProgress",JSON.stringify(p));
}

function pkPlayerId(){
  return playerKey||String(player||"").trim().toLowerCase();
}

function pkPlayerProgress(){
  const all=pkProgressAll(),id=pkPlayerId();
  if(!all[id]) all[id]={};
  return {all,id,data:all[id]};
}

function pkTierFromAccuracy(){
  const total=Math.max(1,Number(window.pkTotalNotes||0));
  const hits=Number(window.pkHitNotes||0);
  const misses=Number(window.pkMissNotes||0);
  const ratio=hits/total;

  if(total>0 && hits===total && misses===0)return "Perfeito";
  if(ratio>=0.82)return "Alto";
  if(ratio>=0.62)return "Médio";
  if(ratio>=0.38)return "Bom";
  return "Ruim";
}

function pkRecordResult(level,tier){
  const {all,id,data}=pkPlayerProgress();

  data[level] ||= {perfects:0,bestTier:"Ruim"};

  if(tier==="Perfeito")data[level].perfects++;

  if(
    PK_TIER_NAMES.indexOf(tier)>
    PK_TIER_NAMES.indexOf(data[level].bestTier)
  ){
    data[level].bestTier=tier;
  }

  pkSaveProgress(all);
}

function pkUnlocked(level){
  if(playerKey==="arthur")return true;

  const i=PK_LEVEL_ORDER.indexOf(level);

  if(i<=0)return true;

  const prev=pkPlayerProgress().data[PK_LEVEL_ORDER[i-1]];

  return !!prev &&
    (
      (prev.perfects||0)>=3 ||
      PK_TIER_NAMES.indexOf(prev.bestTier)>=2
    );
}

function pkUnlockText(level){
  const i=PK_LEVEL_ORDER.indexOf(level);

  if(i<=0)return "Disponível";

  const prev=PK_LEVEL_ORDER[i-1];
  const p=pkPlayerProgress().data[prev];

  if(!p){
    return "🔒 Bloqueado — consiga nível Médio ou 3 Perfeitos em "+prev+".";
  }

  return "🔒 Bloqueado — nível Médio já libera; 3 Perfeitos também liberam.";
}


/* =========================================================
   SISTEMA DE CORES E PONTUAÇÃO
========================================================= */

const PK_NOTE_SCORES=[
  {name:"Verde",color:"#35d07f",points:1,weight:38},
  {name:"Amarelo",color:"#ffd43b",points:2,weight:25},
  {name:"Azul",color:"#4dabf7",points:3,weight:16},
  {name:"Roxo",color:"#b56cff",points:5,weight:10},
  {name:"Branco",color:"#f8fbff",points:8,weight:6},
  {name:"Preto",color:"#252525",points:10,weight:5}
];

const PK_LEVEL_COLOR_BOOST={
  noob:0,
  medium:.18,
  hard:.38,
  insane:.62,
  marcus:.86
};

function pickNoteStyle(){
  const boost=PK_LEVEL_COLOR_BOOST[levelKey]||0;

  const entries=PK_NOTE_SCORES.map((n,i)=>({
    n,
    w:n.weight*(1+(i>=3?boost:0))
  }));

  const total=entries.reduce((a,e)=>a+e.w,0);
  let r=Math.random()*total;

  for(const e of entries){
    r-=e.w;
    if(r<=0)return e.n;
  }

  return entries[0].n;
}


/* =========================================================
   DIFICULDADES
========================================================= */

const levels={
  noob:{
    duration:18000,
    spawn:1120,
    speed:.34,
    label:"Noob"
  },

  medium:{
    duration:18500,
    spawn:780,
    speed:.58,
    label:"Médio"
  },

  hard:{
    duration:19500,
    spawn:590,
    speed:.90,
    label:"Difícil"
  },

  insane:{
    duration:20000,
    spawn:420,
    speed:1.30,
    label:"Insano"
  },

  marcus:{
    duration:20000,
    spawn:300,
    speed:2.50,
    label:"Marcus"
  }
};


/* =========================================================
   PLAYLISTS
========================================================= */

const playlists={
  noob:[
    {
      key:"glorious",
      title:"Glorious Morning — Waterflame",
      bpm:112,
      notes:[261.63,293.66,329.63,392,329.63,293.66,261.63,220],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Glorious+Morning",
      tag:"calma • entrada suave"
    },
    {
      key:"crystallize",
      title:"Crystallize — Creo",
      bpm:114,
      notes:[261.63,329.63,392,440,392,329.63,293.66,329.63],
      youtube:"https://www.youtube.com/results?search_query=Creo+Crystallize",
      tag:"melódica • tranquila"
    },
    {
      key:"time-machine",
      title:"Time Machine — Waterflame",
      bpm:116,
      notes:[293.66,329.63,392,349.23,293.66,261.63,293.66,392],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Time+Machine",
      tag:"leve • aventura"
    },
    {
      key:"skyward",
      title:"Skyward — Creo",
      bpm:118,
      notes:[261.63,329.63,369.99,440,369.99,329.63,293.66,261.63],
      youtube:"https://www.youtube.com/results?search_query=Creo+Skyward",
      tag:"suave • espacial"
    },
    {
      key:"sunrise",
      title:"Sunrise — Waterflame",
      bpm:120,
      notes:[293.66,349.23,392,440,392,349.23,329.63,293.66],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Sunrise",
      tag:"calma • progressiva"
    }
  ],

  medium:[
    {
      key:"sphere",
      title:"Sphere — Creo",
      bpm:124,
      notes:[293.66,349.23,440,523.25,440,349.23,392,493.88],
      youtube:"https://www.youtube.com/results?search_query=Creo+Sphere",
      tag:"ritmo moderado"
    },
    {
      key:"dimension",
      title:"Dimension — Creo",
      bpm:126,
      notes:[329.63,392,493.88,392,349.23,440,523.25,440],
      youtube:"https://www.youtube.com/results?search_query=Creo+Dimension",
      tag:"mais pulsante"
    },
    {
      key:"glome",
      title:"Glome — Creo",
      bpm:128,
      notes:[329.63,392,440,523.25,493.88,440,392,329.63],
      youtube:"https://www.youtube.com/results?search_query=Creo+Glome",
      tag:"eletrônica • crescente"
    },
    {
      key:"arcade-punk",
      title:"Arcade Punk — Waterflame",
      bpm:132,
      notes:[349.23,440,523.25,587.33,523.25,440,392,493.88],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Arcade+Punk",
      tag:"arcade • energético"
    },
    {
      key:"press-start",
      title:"Press Start — MDK",
      bpm:134,
      notes:[392,493.88,587.33,659.25,587.33,493.88,523.25,392],
      youtube:"https://www.youtube.com/results?search_query=MDK+Press+Start",
      tag:"chiptune • animada"
    }
  ],

  hard:[
    {
      key:"exosphere",
      title:"Exosphere — Creo",
      bpm:140,
      notes:[329.63,415.30,493.88,554.37,493.88,415.30,369.99,493.88],
      youtube:"https://www.youtube.com/results?search_query=Creo+Exosphere",
      tag:"eletrônica • acelera"
    },
    {
      key:"endgame",
      title:"Endgame — Waterflame",
      bpm:148,
      notes:[392,493.88,587.33,659.25,587.33,493.88,440,554.37],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Endgame",
      tag:"chiptune • rápido"
    },
    {
      key:"carnivores",
      title:"Carnivores — Creo",
      bpm:150,
      notes:[392,493.88,587.33,698.46,587.33,493.88,554.37,659.25],
      youtube:"https://www.youtube.com/results?search_query=Creo+Carnivores",
      tag:"rápida • intensa"
    },
    {
      key:"jumper",
      title:"Jumper — Waterflame",
      bpm:154,
      notes:[440,554.37,659.25,783.99,659.25,587.33,493.88,698.46],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Jumper",
      tag:"arcade • veloz"
    },
    {
      key:"jelly-castle",
      title:"Jelly Castle — MDK",
      bpm:158,
      notes:[440,554.37,659.25,739.99,659.25,554.37,493.88,783.99],
      youtube:"https://www.youtube.com/results?search_query=MDK+Jelly+Castle",
      tag:"elétrica • divertida"
    }
  ],

  insane:[
    {
      key:"skyfortress",
      title:"Sky Fortress — Waterflame",
      bpm:164,
      notes:[392,493.88,587.33,698.46,659.25,587.33,493.88,783.99],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Sky+Fortress",
      tag:"épica • muito rápida"
    },
    {
      key:"lightspeed",
      title:"Lightspeed — Waterflame",
      bpm:174,
      notes:[440,554.37,659.25,783.99,880,783.99,659.25,987.77],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Lightspeed",
      tag:"trance • alta energia"
    },
    {
      key:"theory-of-everything",
      title:"Theory of Everything — DJ-Nate",
      bpm:178,
      notes:[493.88,659.25,783.99,987.77,880,783.99,1046.5,1174.66],
      youtube:"https://www.youtube.com/results?search_query=DJ-Nate+Theory+of+Everything",
      tag:"eletrônica • frenética"
    },
    {
      key:"blast-processing",
      title:"Blast Processing — Waterflame",
      bpm:182,
      notes:[523.25,659.25,783.99,987.77,1046.5,880,783.99,1174.66],
      youtube:"https://www.youtube.com/results?search_query=Waterflame+Blast+Processing",
      tag:"arcade • acelerada"
    },
    {
      key:"surface",
      title:"Surface — Creo",
      bpm:184,
      notes:[493.88,587.33,739.99,880,987.77,880,739.99,659.25],
      youtube:"https://www.youtube.com/results?search_query=Creo+Surface",
      tag:"synth • muito rápida"
    }
  ],

  marcus:[
    {
      key:"fingerbang",
      title:"Fingerbang — MDK",
      bpm:188,
      notes:[493.88,659.25,783.99,987.77,880,783.99,1046.5,1174.66],
      youtube:"https://www.youtube.com/watch?v=BuPmq7yjDnI",
      tag:"elétrica • frenética"
    },
    {
      key:"nautilus",
      title:"Nautilus — Creo",
      bpm:192,
      notes:[440,554.37,659.25,830.61,987.77,830.61,739.99,1108.73],
      youtube:"https://www.youtube.com/results?search_query=Creo+Nautilus",
      tag:"build-up • pancadão"
    },
    {
      key:"press-start-extreme",
      title:"Press Start — MDK",
      bpm:196,
      notes:[523.25,659.25,783.99,1046.5,1174.66,987.77,1318.51,1567.98],
      youtube:"https://www.youtube.com/results?search_query=MDK+Press+Start",
      tag:"arcade • extrema"
    },
    {
      key:"powerless",
      title:"Powerless — Creo",
      bpm:200,
      notes:[554.37,659.25,830.61,987.77,1108.73,987.77,880,1174.66],
      youtube:"https://www.youtube.com/results?search_query=Creo+Powerless",
      tag:"energia • brutal"
    },
    {
      key:"ghost",
      title:"Ghost — Creo",
      bpm:204,
      notes:[587.33,739.99,880,1046.5,1174.66,1046.5,987.77,1318.51],
      youtube:"https://www.youtube.com/results?search_query=Creo+Ghost",
      tag:"rápida • final intenso"
    }
  ]
};


/* =========================================================
   LOJA
========================================================= */

const SHOP_ITEMS={
  double:{
    name:"2× Pontos",
    cost:250,
    type:"once",
    desc:"Dobra os pontos ganhos na próxima partida."
  },

  revive:{
    name:"Reviver",
    cost:80,
    type:"consumable",
    limit:3,
    desc:"Reinicia o nível após a derrota e dobra a recompensa da nova tentativa."
  },

  shield:{
    name:"Escudo",
    cost:120,
    type:"consumable",
    limit:5,
    desc:"Carga extra consumível da loja para proteger contra erros."
  },

  healthUp:{
    name:"Melhoria de Vida",
    costs:[180,360,620,980,1450],
    type:"upgrade",
    desc:"Aumenta a vida máxima em +5 HP por nível."
  },

  shieldUp:{
    name:"Melhoria de Escudo",
    costs:[160,320,540,850,1250],
    type:"upgrade",
    desc:"Aumenta o escudo máximo em +3 por nível."
  }
};

const SHOP_REFRESH_MS=5*60*1000;

const UPGRADE_LIMIT_BY_LEVEL={
  noob:0,
  medium:1,
  hard:2,
  insane:4,
  marcus:5
};

function randomStock(limit){
  return 1+Math.floor(Math.random()*limit);
}

function refreshShopIfNeeded(u){
  u.shop=u.shop||{};
  u.shop.double=!!u.shop.double;
  u.shop.revive=Number(u.shop.revive||0);
  u.shop.shield=Number(u.shop.shield||0);

  u.shop.stock=u.shop.stock||{};
  u.shop.purchases=u.shop.purchases||{};
  u.shop.upgrades=u.shop.upgrades||{
    health:0,
    shield:0
  };

  u.shop.upgrades.health=Math.min(
    5,
    Number(u.shop.upgrades.health||0)
  );

  u.shop.upgrades.shield=Math.min(
    5,
    Number(u.shop.upgrades.shield||0)
  );

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
  const users=getUsers();
  const u=users[playerKey]||{};

  u.coins=Number(u.coins||0);

  refreshShopIfNeeded(u);

  users[playerKey]=u;
  saveUsers(users);

  return u;
}

function shopUnlocked(){
  return playerKey==="arthur" || pkUnlocked("medium");
}

function awardCoins(){
  const users=getUsers();
  const u=users[playerKey];

  if(!u||!gameWon)return;

  refreshShopIfNeeded(u);

  const baseMultiplier=
    (u.shop&&u.shop.double)?2:1;

  const finalMultiplier=
    reviveMultiplier>1?
      reviveMultiplier:
      baseMultiplier;

  u.coins=
    Number(u.coins||0)+
    (score*finalMultiplier);

  if(u.shop&&u.shop.double){
    u.shop.double=false;
  }

  users[playerKey]=u;
  saveUsers(users);
}

function shopRefreshText(u){
  const left=Math.max(
    0,
    Number(u.shop.refreshAt||0)-Date.now()
  );

  const sec=Math.ceil(left/1000);

  return sec>0?
    `Atualiza em ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`:
    "Atualizando...";
}

function upgradeStats(u){
  const h=Math.min(
    5,
    Number(u.shop?.upgrades?.health||0)
  );

  const sh=Math.min(
    5,
    Number(u.shop?.upgrades?.shield||0)
  );

  return {
    healthLevel:h,
    shieldLevel:sh,
    maxHealth:20+h*5,
    maxShield:5+sh*3,
    total:h+sh
  };
}

function renderShop(){
  const box=$("shopItems");
  const u=shopState();

  if(!box)return;

  const stats=upgradeStats(u);
  const cap=UPGRADE_LIMIT_BY_LEVEL[levelKey]||0;

  $("shopPoints").textContent=
    `Pontos disponíveis: ${u.coins}`;

  const upgrades=`
    <div class="shopSectionTitle">🛡️ Melhorias</div>

    <div class="upgradeInfo">
      No <b>${levels[levelKey].label}</b>,
      você pode ter até <b>${cap}</b>
      melhoria${cap===1?'':'s'}
      comprada${cap===1?'':'s'} no total.
      As melhorias ficam salvas na conta.
    </div>

    ${renderUpgradeItem(
      'health',
      SHOP_ITEMS.healthUp,
      stats.healthLevel,
      cap,
      u
    )}

    ${renderUpgradeItem(
      'shield',
      SHOP_ITEMS.shieldUp,
      stats.shieldLevel,
      cap,
      u
    )}
  `;

  const items=
    Object.entries(SHOP_ITEMS)
      .filter(([id])=>id!=="healthUp"&&id!=="shieldUp")
      .map(([id,it])=>{

        if(id==="double"){
          const disabled=
            !shopUnlocked()||
            u.coins<it.cost||
            u.shop.double;

          return `
            <div class="shopItem">
              <div>
                <b>${it.name}</b>
                <span>${it.desc}</span>
                <small>
                  ${
                    u.shop.double?
                    "Compra permanente já feita":
                    "Compra única • não volta para a loja"
                  }
                </small>
              </div>

              <button
                class="shopBuy"
                data-shop="${id}"
                ${disabled?'disabled':''}
              >
                ${it.cost} pts
              </button>
            </div>
          `;
        }

        const stock=Number(
          u.shop.stock[id]||0
        );

        const purchases=Number(
          u.shop.purchases[id]||0
        );

        const limit=it.limit;

        const disabled=
          !shopUnlocked()||
          u.coins<it.cost||
          stock<=0||
          purchases>=limit;

        return `
          <div class="shopItem">
            <div>
              <b>${it.name}</b>
              <span>${it.desc}</span>
              <small>
                Compras: ${purchases}/${limit}
                • Unidades: ${stock}
              </small>
            </div>

            <button
              class="shopBuy"
              data-shop="${id}"
              ${disabled?'disabled':''}
            >
              ${it.cost} pts
            </button>
          </div>
        `;
      })
      .join("");

  box.innerHTML=
    upgrades+
    `<div class="shopSectionTitle consumablesTitle">🎒 Itens</div>`+
    items+
    `<p class="shopRefresh">🔄 ${shopRefreshText(u)}</p>`;

  box.querySelectorAll(".shopBuy")
    .forEach(btn=>{
      btn.addEventListener(
        "pointerdown",
        e=>{
          e.preventDefault();

          buyItem(
            btn.dataset.shop||
            ((btn.dataset.upgrade||"")+"Up")
          );
        }
      );
    });
}

function renderUpgradeItem(
  kind,
  it,
  level,
  cap,
  u
){
  const total=
    Number(u.shop.upgrades.health||0)+
    Number(u.shop.upgrades.shield||0);

  const next=Math.min(5,level+1);
  const cost=it.costs[level];

  const atMax=level>=5;
  const atCap=total>=cap;

  const disabled=
    !shopUnlocked()||
    atMax||
    atCap||
    u.coins<cost;

  const effect=
    kind==="health"?
      `❤️ ${20+level*5} → ${20+next*5} HP`:
      `🛡️ ${5+level*3} → ${5+next*3}`;

  return `
    <div class="shopItem upgradeItem">
      <div>
        <b>${it.name} ${level}/5</b>
        <span>${it.desc}</span>
        <small>${effect} • Limite ${cap}</small>
      </div>

      <button
        class="shopBuy"
        data-upgrade="${kind}"
        ${disabled?'disabled':''}
      >
        ${
          atMax?
          'Máximo':
          atCap?
          'Limite':
          cost+' pts'
        }
      </button>
    </div>
  `;
}

function buyItem(id){
  const users=getUsers();
  const u=users[playerKey];

  if(!u||!shopUnlocked())return;

  refreshShopIfNeeded(u);

  u.coins=Number(u.coins||0);
  u.shop=u.shop||{};

  if(id==="healthUp"||id==="shieldUp"){

    const kind=
      id==="healthUp"?
      "health":
      "shield";

    const level=
      Number(u.shop.upgrades?.[kind]||0);

    const cap=
      UPGRADE_LIMIT_BY_LEVEL[levelKey]||0;

    const total=
      Number(u.shop.upgrades?.health||0)+
      Number(u.shop.upgrades?.shield||0);

    const it=SHOP_ITEMS[id];
    const cost=it.costs[level];

    if(
      level>=5||
      total>=cap||
      u.coins<cost
    )return;

    u.shop.upgrades[kind]=level+1;
    u.coins-=cost;

  }else{

    const it=SHOP_ITEMS[id];

    if(u.coins<it.cost)return;

    if(id==="double"&&u.shop.double)return;

    if(id!=="double"){

      const stock=
        Number(u.shop.stock[id]||0);

      const purchases=
        Number(u.shop.purchases[id]||0);

      if(
        stock<=0||
        purchases>=it.limit
      )return;

      u.shop.stock[id]=stock-1;
      u.shop.purchases[id]=purchases+1;
      u.shop[id]=
        Number(u.shop[id]||0)+1;

    }else{
      u.shop.double=true;
    }

    u.coins-=it.cost;
  }

  users[playerKey]=u;
  saveUsers(users);
  renderShop();
}

function openShop(){
  if(!shopUnlocked())return;

  renderShop();

  $("shopOverlay").classList.remove("hidden");
}

function closeShop(){
  $("shopOverlay").classList.add("hidden");
}


/* =========================================================
   USUÁRIOS
========================================================= */

function getUsers(){
  try{
    return JSON.parse(
      localStorage.getItem("pulseKeysUsers")||"{}"
    );
  }catch(e){
    return {};
  }
}

function saveUsers(users){
  localStorage.setItem(
    "pulseKeysUsers",
    JSON.stringify(users)
  );
}

function ensureAdminAccount(){
  const users=getUsers();
  const old=users.arthur||{};

  users.arthur={
    ...old,
    name:"Arthur",
    password:"1234",
    best:Number(old.best||0),
    admin:true
  };

  saveUsers(users);
}

ensureAdminAccount();

function userKey(name){
  return name.trim().toLowerCase();
}


/* =========================================================
   MÚSICAS PERSONALIZADAS
========================================================= */

function currentSong(){
  return pkAllSongsForLevel()
    .find(s=>s.key===songKey)||
    pkAllSongsForLevel()[0];
}

function pkCustomSongs(){
  try{
    return JSON.parse(
      localStorage.getItem("pulseKeysCustomSongs")||"[]"
    );
  }catch(e){
    return [];
  }
}

function pkSaveCustomSongs(list){
  localStorage.setItem(
    "pulseKeysCustomSongs",
    JSON.stringify(list)
  );
}

function pkYoutubeId(url){
  try{
    const u=new URL(url);

    if(u.hostname.includes("youtu.be")){
      return u.pathname.slice(1).split("/")[0];
    }

    if(u.hostname.includes("youtube.com")){

      if(u.pathname==="/watch"){
        return u.searchParams.get("v");
      }

      const m=u.pathname.match(
        /\/(?:embed|shorts|live)\/([^/?]+)/
      );

      if(m)return m[1];
    }

  }catch(e){}

  return null;
}

function pkCustomSongsForLevel(){
  return pkCustomSongs()
    .filter(s=>s.level===levelKey);
}

function pkCustomSongByKey(key){
  return pkCustomSongs()
    .find(s=>s.key===key)||null;
}

function pkEnsureCustomMusicUI(){
  if(document.getElementById("pkCustomMusicBox"))return;

  const host=
    document.getElementById("songSelect")?.parentElement?.parentElement||
    document.getElementById("songSelect")?.parentElement;

  if(!host)return;

  const box=document.createElement("div");

  box.id="pkCustomMusicBox";
  box.className="customMusicBox";

  box.innerHTML=`
    <div class="shopSectionTitle">🎵 Sua música</div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">

      <input
        id="pkCustomMusicName"
        type="text"
        maxlength="50"
        placeholder="Nome da música (opcional)"
        style="flex:1;min-width:180px"
      >

      <input
        id="pkCustomMusicUrl"
        type="url"
        placeholder="Cole o link do YouTube aqui"
        style="flex:2;min-width:240px"
      >

      <button
        id="pkAddCustomMusic"
        type="button"
      >
        Adicionar música
      </button>

    </div>

    <small style="display:block;margin-top:6px;opacity:.8">
      Aceita links do YouTube, incluindo youtu.be.
      A música fica salva neste navegador.
    </small>

    <div
      id="pkCustomMusicList"
      style="margin-top:8px"
    ></div>
  `;

  host.parentNode.insertBefore(
    box,
    host.nextSibling
  );

  document
    .getElementById("pkAddCustomMusic")
    .addEventListener(
      "pointerdown",
      e=>{
        e.preventDefault();
        pkAddCustomMusic();
      }
    );

  pkRenderCustomMusicList();
}

function pkAddCustomMusic(){
  const input=
    document.getElementById("pkCustomMusicUrl");

  const nameInput=
    document.getElementById("pkCustomMusicName");

  if(!input)return;

  const url=input.value.trim();
  const id=pkYoutubeId(url);

  if(!id){
    alert("Cole um link válido do YouTube.");
    return;
  }

  const list=pkCustomSongs();

  if(list.some(s=>s.youtubeId===id)){
    alert("Essa música já foi adicionada.");
    return;
  }

  const title=
    (nameInput.value.trim()||"Minha música")+
    " — YouTube";

  const item={
    key:"custom-"+Date.now(),
    title,
    bpm:140,
    notes:[
      261.63,
      329.63,
      392,
      523.25,
      392,
      329.63,
      293.66,
      392
    ],
    youtube:"https://www.youtube.com/watch?v="+id,
    youtubeId:id,
    level:levelKey,
    tag:"🎵 personalizada"
  };

  list.push(item);

  pkSaveCustomSongs(list);

  input.value="";
  nameInput.value="";

  songKey=item.key;

  updatePlaylist();
  pkRenderCustomMusicList();

  alert(
    "Música adicionada! Ela ficou disponível nesta dificuldade."
  );
}

function pkRenderCustomMusicList(){
  const box=
    document.getElementById("pkCustomMusicList");

  if(!box)return;

  const list=pkCustomSongsForLevel();

  box.innerHTML=
    list.length?
      list.map(s=>`
        <div
          style="
            display:flex;
            gap:8px;
            align-items:center;
            margin:4px 0
          "
        >
          <span style="flex:1">${s.title}</span>

          <button
            type="button"
            class="pkRemoveCustom"
            data-key="${s.key}"
          >
            Remover
          </button>
        </div>
      `).join(""):
      "<small>Nenhuma música personalizada nesta dificuldade.</small>";

  box
    .querySelectorAll(".pkRemoveCustom")
    .forEach(b=>{
      b.addEventListener(
        "pointerdown",
        e=>{
          e.preventDefault();
          pkRemoveCustomMusic(
            b.dataset.key
          );
        }
      );
    });
}

function pkRemoveCustomMusic(key){
  const list=
    pkCustomSongs()
      .filter(s=>s.key!==key);

  pkSaveCustomSongs(list);

  if(songKey===key){
    songKey=playlists[levelKey][0].key;
  }

  updatePlaylist();
  pkRenderCustomMusicList();
}

function pkAllSongsForLevel(){
  return playlists[levelKey]
    .concat(pkCustomSongsForLevel());
}


/* =========================================================
   YOUTUBE
========================================================= */

function pkStartYoutubeMusic(song){
  let frame=
    document.getElementById("pkYoutubePlayer");

  if(!frame){
    frame=document.createElement("iframe");

    frame.id="pkYoutubePlayer";

    frame.allow=
      "autoplay; encrypted-media";

    frame.style.cssText=
      "position:fixed;"+
      "left:-9999px;"+
      "top:-9999px;"+
      "width:2px;"+
      "height:2px;"+
      "border:0;"+
      "opacity:0;"+
      "pointer-events:none";

    document.body.appendChild(frame);
  }

  if(song&&song.youtubeId){

    frame.src=
      "https://www.youtube.com/embed/"+
      encodeURIComponent(song.youtubeId)+
      "?autoplay=1&controls=0&loop=1&playlist="+
      encodeURIComponent(song.youtubeId);
  }
}

function pkStopYoutubeMusic(){
  const frame=
    document.getElementById("pkYoutubePlayer");

  if(frame){
    frame.src="about:blank";
  }
}


/* =========================================================
   PLAYLIST
========================================================= */

function updatePlaylist(){
  const list=pkAllSongsForLevel();

  if(!list.some(s=>s.key===songKey)){
    songKey=list[0].key;
  }

  const select=$("songSelect");

  select.innerHTML=
    list.map(s=>
      `<option value="${s.key}">
        ${s.title}
      </option>`
    ).join("");

  select.value=songKey;

  $("playlistInfo").textContent=
    `${levels[levelKey].label}: `+
    list
      .map(s=>s.title.split(" — ")[0])
      .join(" • ");

  $("songLinks").innerHTML=
    list.map(s=>`
      <div class="songLinkRow">
        <span>${s.tag}</span>
        <a
          href="${s.youtube}"
          target="_blank"
          rel="noopener noreferrer"
        >
          ${s.title}
        </a>
      </div>
    `).join("");

  pkEnsureCustomMusicUI();
  pkRenderCustomMusicList();
}


/* =========================================================
   LOGIN / REGISTRO
========================================================= */

function showTab(tab){
  const reg=tab==="register";

  $("registerPanel")
    .classList.toggle("hidden",!reg);

  $("loginPanel")
    .classList.toggle("hidden",reg);

  $("registerTab")
    .classList.toggle("active",reg);

  $("loginTab")
    .classList.toggle("active",!reg);
}

$("registerTab").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    showTab("register");
  }
);

$("loginTab").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    showTab("login");
  }
);

$("registerBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();

    const name=
      $("registerName").value.trim();

    const pass=
      $("registerPassword").value.trim();

    if(!name){
      alert("Digite um nome.");
      return;
    }

    if(!/^\d{4,6}$/.test(pass)){
      alert(
        "A senha deve ter de 4 a 6 números."
      );
      return;
    }

    const users=getUsers();
    const key=userKey(name);

    if(users[key]){
      alert(
        "Esse nome já está cadastrado. Use a aba Entrar."
      );
      return;
    }

    users[key]={
      name,
      password:pass,
      best:0
    };

    saveUsers(users);

    player=users[key].name;
    playerKey=key;

    localStorage.setItem(
      "pulseKeysPlayer",
      player
    );

    localStorage.setItem(
      "pulseKeysPlayerKey",
      playerKey
    );

    enterGameMenu();
  }
);

$("loginBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();

    const name=
      $("loginName").value.trim();

    const pass=
      $("loginPassword").value.trim();

    const users=getUsers();
    const key=userKey(name);

    if(
      !users[key]||
      users[key].password!==pass
    ){
      $("loginInfo").textContent=
        "Nome ou senha incorretos.";

      return;
    }

    player=users[key].name;
    playerKey=key;

    localStorage.setItem(
      "pulseKeysPlayer",
      player
    );

    localStorage.setItem(
      "pulseKeysPlayerKey",
      playerKey
    );

    $("loginInfo").textContent="";

    enterGameMenu();
  }
);


/* =========================================================
   CONTROLES DO MENU
========================================================= */

$("levelSelect").addEventListener(
  "change",
  ()=>{
    levelKey=$("levelSelect").value;
    updatePlaylist();
  }
);

$("songSelect").addEventListener(
  "change",
  ()=>{
    songKey=$("songSelect").value;
  }
);

$("startBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    startGame();
  }
);

$("pauseBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    togglePause();
  }
);

$("resumeBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    resumeGame();
  }
);

$("restartPausedBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    startGame();
  }
);

$("lobbyPausedBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    goToLobby();
  }
);

$("againBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    startGame();
  }
);

$("resultLobbyBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    goToLobby();
  }
);

$("muteBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    toggleMute();
  }
);

$("volumeBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    toggleVolumePanel();
  }
);

$("volumeRange").addEventListener(
  "input",
  e=>{
    setVolume(Number(e.target.value));
  }
);

$("shopBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    openShop();
  }
);

$("reviveBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    useRevive();
  }
);

$("closeShopBtn").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();
    closeShop();
  }
);

$("tutorialOverlay").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();

    if(tutorialActive){
      beginActualGame();
    }
  }
);


/* =========================================================
   VIDA
========================================================= */

function applyPlayerStats(){
  const u=shopState();
  const stats=upgradeStats(u);

  maxHealth=stats.maxHealth;
  maxShield=stats.maxShield;

  health=maxHealth;
  shield=maxShield;

  updateLifeHud();
}

function updateLifeHud(){
  const hp=Math.max(0,health);
  const sh=Math.max(0,shield);

  const hpEl=$("healthText");
  const shEl=$("shieldText");

  const hpFill=$("healthFill");
  const shFill=$("shieldFill");

  if(hpEl){
    hpEl.textContent=
      `${hp}/${maxHealth}`;
  }

  if(shEl){
    shEl.textContent=
      `${sh}/${maxShield}`;
  }

  if(hpFill){
    hpFill.style.width=
      `${maxHealth?hp/maxHealth*100:0}%`;
  }

  if(shFill){
    shFill.style.width=
      `${maxShield?sh/maxShield*100:0}%`;
  }
}

function takeDamage(amount,pointsLoss=amount){
  amount=Math.max(
    0,
    Number(amount)||0
  );

  if(!amount||!running)return;

  let remaining=amount;

  const absorbed=
    Math.min(shield,remaining);

  shield-=absorbed;
  remaining-=absorbed;

  health=
    Math.max(
      0,
      health-remaining
    );

  score=
    Math.max(
      0,
      score-Math.max(
        0,
        Number(pointsLoss)||0
      )
    );

  updateLifeHud();

  $("score").textContent=score;

  if(health<=0){
    die();
  }
}

function die(){
  if(!running)return;

  running=false;
  endingPhase=false;
  paused=false;

  clearTimers();
  clearTiles();
  stopAudio();

  gameWon=false;
  reviveMultiplier=1;

  const users=getUsers();
  const u=users[playerKey];

  if(u){
    users[playerKey]=u;
    saveUsers(users);
  }

  $("finalScore").textContent="0";
  $("scoreTier").textContent="Derrota";

  $("resultText").textContent=
    `Sua vida chegou a 0. Você perdeu ${
      levelKey==="marcus"?
      "a tentativa":
      "a partida"
    }.`;

  const reviveBtn=$("reviveBtn");

  const available=
    Number(
      shopState().shop.revive||0
    )>0;

  reviveBtn.classList.toggle(
    "hidden",
    !available
  );

  $("resultOverlay")
    .classList.remove("hidden");
}


/* =========================================================
   JOGO / TOUCH
========================================================= */

function hitLane(lane,touchY=null){
  if(!running||paused)return;

  const now=performance.now();

  if(now-lastPointer<120)return;

  lastPointer=now;

  const rect=
    $("board").getBoundingClientRect();

  const tiles=[
    ...document.querySelectorAll(
      `.lane[data-lane="${lane}"] .tile`
    )
  ];

  if(!tiles.length){
    score=
      Math.max(
        0,
        score-1
      );

    $("score").textContent=score;
    return;
  }

  if(touchY===null){
    touchY=rect.height*.78;
  }

  let best=null;
  let dist=Infinity;

  for(const tile of tiles){

    const tr=
      tile.getBoundingClientRect();

    const center=
      tr.top+
      tr.height/2-
      rect.top;

    const d=
      Math.abs(
        center-touchY
      );

    if(d<dist){
      dist=d;
      best=tile;
    }
  }

  if(best&&dist<135){
    hitTile(best,lane);
  }else{
    score=
      Math.max(
        0,
        score-1
      );

    $("score").textContent=score;
  }
}

$("board").addEventListener(
  "pointerdown",
  e=>{
    e.preventDefault();

    if(!running||paused)return;

    const rect=
      $("board").getBoundingClientRect();

    const x=
      e.clientX-rect.left;

    const lane=
      Math.max(
        0,
        Math.min(
          2,
          Math.floor(
            x/(rect.width/3)
          )
        )
      );

    hitLane(
      lane,
      e.clientY-rect.top
    );
  }
);


/* =========================================================
   TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  e=>{

    if(tutorialActive){

      if([
        "ArrowLeft",
        "ArrowUp",
        "ArrowRight",
        "a",
        "A",
        "w",
        "W",
        "d",
        "D",
        "Enter",
        " "
      ].includes(e.key)){

        e.preventDefault();
        beginActualGame();
      }

      return;
    }

    if(!running||paused)return;

    const map={
      ArrowLeft:0,
      ArrowUp:1,
      ArrowRight:2,
      a:0,
      A:0,
      w:1,
      W:1,
      d:2,
      D:2
    };

    if(
      Object.prototype.hasOwnProperty.call(
        map,
        e.key
      )
    ){

      e.preventDefault();

      hitLane(
        map[e.key]
      );
    }

    if(e.key==="Escape"){
      e.preventDefault();
      togglePause();
    }
  }
);


/* =========================================================
   MENU PRINCIPAL
========================================================= */

function enterGameMenu(){

  $("registerPanel")
    .classList.add("hidden");

  $("loginPanel")
    .classList.add("hidden");

  $("gameSettings")
    .classList.remove("hidden");

  $("welcomeText").textContent=
    `Olá, ${player}! Escolha primeiro a dificuldade e depois uma música.`;

  updateBest();
  updatePlaylist();
  renderColorGuide();
}

function renderColorGuide(){

  const box=$("colorGuide");

  if(!box)return;

  box.innerHTML=
    PK_NOTE_SCORES.map(n=>`
      <div class="colorGuideItem">

        <span
          class="colorSwatch"
          style="
            background:${n.color};
            ${
              n.name==="Preto"?
              "box-shadow:0 0 0 2px rgba(255,255,255,.45)":
              ""
            }
          "
        ></span>

        <span>
          <b>${n.name}</b>

          <small>
            ${n.points}
            ponto${n.points===1?"":"s"}
          </small>
        </span>

      </div>
    `).join("");
}

function updateBest(){
  const u=getUsers()[playerKey];

  $("bestInfo").textContent=
    u?
      `Melhor pontuação de ${player}: ${u.best}`:
      "";
}

function goToLobby(){

  running=false;
  paused=false;

  clearTimers();
  clearTiles();
  stopAudio();

  $("pauseOverlay")
    .classList.add("hidden");

  $("resultOverlay")
    .classList.add("hidden");

  $("game")
    .classList.add("hidden");

  $("menu")
    .classList.remove("hidden");

  enterGameMenu();
}


/* =========================================================
   VELOCIDADE
========================================================= */

function ramp(){

  if(!running)return 1;

  const elapsed=
    Math.max(
      0,
      performance.now()-
      startTime-
      totalPaused
    );

  const progress=
    Math.min(
      1,
      elapsed/
      Math.max(
        1,
        activeDuration||
        levels[levelKey].duration
      )
    );

  const early=
    Math.min(
      1,
      hits/5
    );

  const timeRamp=
    Math.min(
      1,
      progress/0.34
    );

  const clickRamp=
    hits<5?
      (0.42+0.58*early):
      (
        1+
        Math.min(
          0.25,
          (hits-5)*0.025
        )
      );

  return Math.min(
    1.28,
    0.42+
    0.58*
    Math.max(
      timeRamp,
      early
    )+
    (clickRamp-1)*0.65
  );
}

function currentSpeed(){
  return levels[levelKey].speed*ramp();
}

function currentSpawn(){
  return Math.max(
    170,
    levels[levelKey].spawn/
    (0.72+0.58*ramp())
  );
}


/* =========================================================
   NOTAS
========================================================= */

function spawnTile(){

  if(
    !running||
    paused||
    endingPhase
  )return;

  const lanes=[
    0,
    1,
    2
  ].sort(
    ()=>Math.random()-.5
  );

  const tileHeight=
    window.innerWidth<=700?
    125:
    145;

  let lane=lanes.find(l=>{

    const last=
      $("board")
        .children[l]
        .querySelector(
          ".tile:last-child"
        );

    if(!last)return true;

    return parseFloat(
      last.dataset.y||
      "-145"
    )>
      tileHeight+34;
  });

  if(lane===undefined)return;

  const tile=
    document.createElement("div");

  const note=pickNoteStyle();

  tile.className="tile";

  tile.dataset.lane=lane;
  tile.dataset.points=
    String(note.points);

  tile.dataset.noteColor=
    note.name;

  tile.style.top=
    `-${tileHeight}px`;

  tile.dataset.y=
    `-${tileHeight}`;

  tile.style.background=
    note.color;

  if(note.name==="Preto"){
    tile.style.boxShadow=
      "0 0 0 2px rgba(255,255,255,.45), 0 8px 24px rgba(0,0,0,.55)";
  }

  $("board")
    .children[lane]
    .appendChild(tile);

  window.pkTotalNotes=
    Number(window.pkTotalNotes||0)+1;
}

function scheduleSpawn(){

  if(spawnTimer){
    clearTimeout(spawnTimer);
  }

  if(
    !running||
    paused||
    endingPhase
  )return;

  spawnTimer=
    setTimeout(
      ()=>{
        spawnTile();
        scheduleSpawn();
      },
      currentSpawn()
    );
}

function animate(){

  if(!raf){
    raf=
      requestAnimationFrame(frame);
  }
}

function frame(){

  raf=
    requestAnimationFrame(frame);

  if(!running||paused)return;

  const bottom=
    $("board").clientHeight;

  document
    .querySelectorAll(".tile")
    .forEach(tile=>{

      let y=
        parseFloat(
          tile.dataset.y
        );

      y+=currentSpeed()*8;

      tile.dataset.y=y;
      tile.style.top=y+"px";

      if(y>bottom-45){

        const points=
          Number(
            tile.dataset.points||1
          );

        tile.remove();

        window.pkMissNotes++;

        takeDamage(
          points,
          points
        );

        if(!running)return;
      }
    });

  checkLevelClear();
}

function hitTile(tile,lane){

  if(!tile||!tile.isConnected)return;

  const points=
    Number(
      tile.dataset.points||1
    );

  score+=points;
  hits++;

  window.pkHitNotes=
    Number(window.pkHitNotes||0)+1;

  $("score").textContent=score;

  tile.classList.add("good");

  setTimeout(
    ()=>tile.remove(),
    130
  );

  beep(
    330+lane*90,
    .045
  );

  scheduleSpawn();
}


/* =========================================================
   FINALIZAÇÃO
========================================================= */

function beginEndingPhase(){

  if(endingPhase||!running)return;

  endingPhase=true;

  if(spawnTimer){
    clearTimeout(spawnTimer);
    spawnTimer=null;
  }

  $("speedReadout").textContent=
    "Finalizando notas...";

  checkLevelClear();
}

function checkLevelClear(){

  if(
    running&&
    endingPhase&&
    document.querySelectorAll(".tile").length===0
  ){
    finishGame();
  }
}

function updateClock(){

  if(!running||paused)return;

  const elapsed=
    performance.now()-
    startTime-
    totalPaused;

  const remain=
    Math.max(
      0,
      (
        activeDuration||
        levels[levelKey].duration
      )-
      elapsed
    );

  $("time").textContent=
    (remain/1000).toFixed(1);

  $("speedReadout").textContent=
    `Velocidade ${currentSpeed().toFixed(2)}× • ${hits} acertos`;

  if(remain<=0){
    beginEndingPhase();
  }
}


/* =========================================================
   PAUSA
========================================================= */

function togglePause(){

  if(!running)return;

  paused=true;
  pausedAt=performance.now();

  $("pauseOverlay")
    .classList.remove("hidden");
}

function resumeGame(){

  if(!running)return;

  totalPaused+=
    performance.now()-pausedAt;

  paused=false;

  $("pauseOverlay")
    .classList.add("hidden");

  scheduleSpawn();
  playMelodyBeat();
}


/* =========================================================
   FINAL DA PARTIDA
========================================================= */

function finishGame(){

  if(!running)return;

  running=false;
  endingPhase=false;
  paused=false;

  clearTimers();
  clearTiles();
  stopAudio();

  gameWon=true;

  const rewardMultiplier=
    reviveMultiplier>1?
      reviveMultiplier:
      (
        shopState().shop&&
        shopState().shop.double?
        2:
        1
      );

  awardCoins();

  const rewardedScore=
    score*rewardMultiplier;

  const users=getUsers();
  const u=users[playerKey];

  const best=
    u?
    Number(u.best||0):
    0;

  if(
    u&&
    rewardedScore>best
  ){
    u.best=rewardedScore;
    saveUsers(users);
  }

  $("finalScore").textContent=
    rewardedScore;

  const tier=
    pkTierFromAccuracy();

  lastResultTier=tier;

  $("resultText").textContent=
    rewardedScore>best?
      `Novo recorde! • ${rewardMultiplier}× recompensa`:
      `Você terminou com vida! • ${rewardMultiplier}× recompensa`;

  pkRecordResult(
    levelKey,
    tier
  );

  const tierEl=$("scoreTier");

  if(tierEl){
    tierEl.textContent=
      `Classificação: ${tier}`;
  }

  $("reviveBtn")
    .classList.add("hidden");

  $("resultOverlay")
    .classList.remove("hidden");

  updateBest();
}


/* =========================================================
   REVIVER
========================================================= */

function useRevive(){

  const users=getUsers();
  const u=users[playerKey];

  if(!u)return;

  refreshShopIfNeeded(u);

  if(
    Number(u.shop.revive||0)<=0
  )return;

  u.shop.revive=
    Number(u.shop.revive)-1;

  users[playerKey]=u;
  saveUsers(users);

  $("resultOverlay")
    .classList.add("hidden");

  $("game")
    .classList.remove("hidden");

  reviveMultiplier=2;
  gameWon=false;
  score=0;
  hits=0;

  window.pkHitNotes=0;
  window.pkMissNotes=0;
  window.pkTotalNotes=0;

  applyPlayerStats();

  const countdown=
    $("reviveCountdown");

  let n=3;

  if(countdown){
    countdown.classList.remove("hidden");
    countdown.textContent=String(n);
  }

  const tick=()=>{

    n--;

    if(n<=0){

      if(countdown){
        countdown.classList.add("hidden");
      }

      clearTimers();
      clearTiles();

      running=true;
      paused=false;
      endingPhase=false;

      activeDuration=
        levels[levelKey].duration;

      startTime=
        performance.now();

      totalPaused=0;
      lastPointer=0;

      $("score").textContent="0";

      $("time").textContent=
        (activeDuration/1000)
        .toFixed(1);

      $("speedReadout").textContent=
        "Reviver • 2× recompensa";

      spawnTile();
      scheduleSpawn();

      clockTimer=
        setInterval(
          updateClock,
          80
        );

      startAudio();
      animate();

      return;
    }

    if(countdown){
      countdown.textContent=
        String(n);
    }

    setTimeout(
      tick,
      700
    );
  };

  setTimeout(
    tick,
    700
  );
}


/* =========================================================
   LIMPEZA
========================================================= */

function clearTiles(){
  document
    .querySelectorAll(".tile")
    .forEach(
      t=>t.remove()
    );
}

function clearTimers(){

  if(spawnTimer){
    clearTimeout(spawnTimer);
  }

  if(clockTimer){
    clearInterval(clockTimer);
  }

  spawnTimer=null;
  clockTimer=null;

  if(melodyTimer){
    clearTimeout(melodyTimer);
  }

  melodyTimer=null;

  if(raf){
    cancelAnimationFrame(raf);
    raf=null;
  }
}


/* =========================================================
   ÁUDIO
========================================================= */

function applyAudioVolume(){

  if(master){
    master.gain.value=
      muted?
      0:
      (volume/100)*0.12;
  }

  if($("volumeRange")){
    $("volumeRange").value=
      String(volume);
  }

  if($("volumeValue")){
    $("volumeValue").textContent=
      `${volume}%`;
  }

  if($("muteBtn")){
    $("muteBtn").textContent=
      (muted||volume===0)?
      "🔇":
      "🔊";
  }
}

function setVolume(v){

  volume=
    Math.max(
      0,
      Math.min(
        100,
        v
      )
    );

  muted=
    volume===0;

  localStorage.setItem(
    "pulseKeysVolume",
    String(volume)
  );

  applyAudioVolume();
}

function toggleMute(){

  if(muted){

    muted=false;

    if(volume===0){
      volume=70;
    }

  }else{
    muted=true;
  }

  applyAudioVolume();
}

function toggleVolumePanel(){

  $("volumePanel")
    .classList.toggle("hidden");

  applyAudioVolume();
}

function startAudio(){

  const selected=currentSong();

  if(
    selected&&
    selected.youtubeId
  ){
    pkStartYoutubeMusic(selected);
    return;
  }

  if(!audioCtx){
    audioCtx=
      new(
        window.AudioContext||
        window.webkitAudioContext
      )();
  }

  if(audioCtx.state==="suspended"){
    audioCtx.resume();
  }

  if(master){
    master.disconnect();
  }

  master=
    audioCtx.createGain();

  master.connect(
    audioCtx.destination
  );

  applyAudioVolume();

  melodyIndex=0;

  playMelodyBeat();
}

function playMelodyBeat(){

  if(!running||paused){
    melodyTimer=null;
    return;
  }

  const s=currentSong();

  const speedRamp=
    Math.min(
      1.18,
      0.55+
      0.45*ramp()
    );

  beep(
    s.notes[
      melodyIndex%s.notes.length
    ],
    .09
  );

  melodyIndex++;

  const beat=
    (60000/s.bpm)/
    speedRamp;

  melodyTimer=
    setTimeout(
      playMelodyBeat,
      beat
    );
}

function stopAudio(){

  if(melodyTimer){
    clearTimeout(
      melodyTimer
    );
  }

  melodyTimer=null;

  pkStopYoutubeMusic();
}

function beep(freq,dur){

  if(
    !audioCtx||
    !master||
    muted
  )return;

  const o=
    audioCtx.createOscillator();

  const g=
    audioCtx.createGain();

  o.type="sine";
  o.frequency.value=freq;

  g.gain.setValueAtTime(
    .0001,
    audioCtx.currentTime
  );

  g.gain.exponentialRampToValueAtTime(
    .55,
    audioCtx.currentTime+.01
  );

  g.gain.exponentialRampToValueAtTime(
    .0001,
    audioCtx.currentTime+dur
  );

  o.connect(g);
  g.connect(master);

  o.start();

  o.stop(
    audioCtx.currentTime+
    dur+
    .02
  );
}


/* =========================================================
   INICIAR PARTIDA
========================================================= */

function startGame(){

  songKey=
    $("songSelect").value;

  levelKey=
    $("levelSelect").value;

  /*
    CORREÇÃO IMPORTANTE:
    a dificuldade é lida ANTES de verificar
    se ela está desbloqueada.
  */

  if(
    typeof pkUnlocked==="function"&&
    !pkUnlocked(levelKey)
  ){
    return;
  }

  window.pkHitNotes=0;
  window.pkMissNotes=0;
  window.pkTotalNotes=0;

  score=0;
  hits=0;

  running=false;
  paused=false;
  endingPhase=false;

  resultRecorded=false;
  tutorialActive=true;

  startTime=0;
  totalPaused=0;
  lastPointer=0;

  activeDuration=
    levels[levelKey].duration;

  reviveMultiplier=1;
  gameWon=false;

  applyPlayerStats();

  $("score").textContent="0";

  $("time").textContent=
    (
      levels[levelKey].duration/
      1000
    ).toFixed(1);

  $("speedReadout").textContent=
    "Tutorial";

  $("pauseOverlay")
    .classList.add("hidden");

  $("resultOverlay")
    .classList.add("hidden");

  $("menu")
    .classList.add("hidden");

  $("game")
    .classList.remove("hidden");

  $("tutorialOverlay")
    .classList.remove("hidden");

  $("tutorialDifficulty").textContent=
    `${levels[levelKey].label} • ${
      currentSong().title.split(" — ")[0]
    }`;

  $("tutorialSpeed").textContent=
    `Começa suave e acelera depois dos primeiros 5 acertos. Máximo desta dificuldade: ${levels[levelKey].speed.toFixed(2)}×`;

  $("volumeSongLink").href=
    currentSong().youtube;

  $("volumeSongLink").textContent=
    `Ouvir referência: ${currentSong().title}`;

  clearTimers();
  clearTiles();
  stopAudio();

  $("songHud").textContent=
    `${levels[levelKey].label} • ${
      currentSong().title.split(" — ")[0]
    }`;
}


/* =========================================================
   COMEÇAR APÓS TUTORIAL
========================================================= */

function beginActualGame(){

  if(!tutorialActive)return;

  tutorialActive=false;

  $("tutorialOverlay")
    .classList.add("hidden");

  score=0;
  hits=0;

  running=true;
  endingPhase=false;
  paused=false;

  startTime=
    performance.now();

  totalPaused=0;
  lastPointer=0;

  activeDuration=
    levels[levelKey].duration;

  reviveMultiplier=1;
  gameWon=false;

  window.pkHitNotes=0;
  window.pkMissNotes=0;
  window.pkTotalNotes=0;

  applyPlayerStats();

  $("score").textContent="0";

  $("time").textContent=
    (levels[levelKey].duration/1000)
    .toFixed(1);

  $("speedReadout").textContent=
    "Preparando...";

  clearTimers();
  clearTiles();

  spawnTile();
  scheduleSpawn();

  clockTimer=
    setInterval(
      updateClock,
      80
    );

  startAudio();
  animate();
}


/* =========================================================
   CORREÇÃO DO ÁUDIO AO TOCAR
========================================================= */

function resumeAudioNow(){

  try{

    if(
      typeof audioCtx!=="undefined"&&
      audioCtx
    ){

      if(
        audioCtx.state==="suspended"
      ){
        audioCtx.resume();
      }

      if(
        typeof master!=="undefined"&&
        master&&
        audioCtx.currentTime
      ){

        const target=
          muted?
          0:
          (volume/100)*0.12;

        master.gain.cancelScheduledValues(
          audioCtx.currentTime
        );

        master.gain.setTargetAtTime(
          target,
          audioCtx.currentTime,
          0.015
        );
      }
    }

  }catch(e){}
}

document.addEventListener(
  "pointerdown",
  resumeAudioNow,
  {passive:true}
);

document.addEventListener(
  "keydown",
  resumeAudioNow
);


/* =========================================================
   MISSÃO DA DIFICULDADE
========================================================= */

function pkUpdateDifficultyMission(){

  const el=
    document.getElementById(
      "difficultyMission"
    );

  if(
    !el||
    typeof levelKey==="undefined"
  )return;

  el.textContent=
    pkUnlockText(levelKey);

  el.classList.toggle(
    "locked",
    !pkUnlocked(levelKey)
  );
}

document.addEventListener(
  "DOMContentLoaded",
  ()=>{

    pkUpdateDifficultyMission();

    const sel=
      document.getElementById(
        "levelSelect"
      )||
      document.getElementById(
        "difficulty"
      )||
      document.getElementById(
        "level"
      );

    if(sel){

      sel.addEventListener(
        "change",
        ()=>{
          setTimeout(
            pkUpdateDifficultyMission,
            0
          );
        }
      );
    }
  }
);


/* =========================================================
   CLASSIFICAÇÃO
========================================================= */

function pkShowTier(){

  const el=
    document.getElementById(
      "scoreTier"
    );

  if(!el)return;

  const tier=
    pkTierFromAccuracy();

  el.textContent=
    "Classificação: "+tier;
}

setInterval(
  ()=>{
    const ov=
      document.getElementById(
        "resultOverlay"
      );

    if(
      ov&&
      (
        ov.classList.contains("show")||
        getComputedStyle(ov).display!=="none"
      )
    ){
      pkShowTier();
    }
  },
  500
);


/* =========================================================
   ATUALIZAÇÃO DA LOJA
========================================================= */

setInterval(
  ()=>{
    const ov=$("shopOverlay");

    if(
      ov&&
      !ov.classList.contains("hidden")
    ){
      renderShop();
    }
  },
  1000
);
