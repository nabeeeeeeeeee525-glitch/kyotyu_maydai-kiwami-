/* ------------------------------
   Firebase 初期化
------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyBpXMBf6P2-e4bZwwcZzApDebgVj5lULNI",
  authDomain: "maydie-kyoryu-kiwami.firebaseapp.com",
  projectId: "maydie-kyoryu-kiwami",
  storageBucket: "maydie-kyoryu-kiwami.firebasestorage.app",
  messagingSenderId: "339192034172",
  appId: "1:339192034172:web:ee3cd70d471a3adda52af9"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ------------------------------
   音源
------------------------------ */
const jumpSound = new Audio("sound/jump.mp3");
const gameOverSound = new Audio("sound/gameover.mp3");
const bgm = new Audio("sound/bgm.mp3");
bgm.loop = true;

// ★ 初期音量を 0.10 に設定
jumpSound.volume = 0.10;
gameOverSound.volume = 0.10;
bgm.volume = 0.10;


document.getElementById("volumeControl").addEventListener("input", e => {
  const v = e.target.value;
  jumpSound.volume = v;
  gameOverSound.volume = v;
  bgm.volume = v;
});

/* ------------------------------
   ゲーム変数
------------------------------ */
const game = document.getElementById("game");
const dino = document.getElementById("dino");
const scoreEl = document.getElementById("score");
const messageEl = document.getElementById("message");
const ground = document.getElementById("ground");

const gameWidth = 800;
const groundY = 20;

let dinoY = 0;
let dinoVY = 0;
const gravity = -0.5;
const jumpVelocity = 12;
let isOnGround = true;
let isCrouching = false;

let obstacles = [];
let lastTime = 0;
let spawnTimer = 0;
let spawnInterval = 1000;
let speed = 6;
let score = 0;
let isRunning = false;
let isGameOver = false;

let speedTimer = 0;
let slowEventActive = false;

/* ------------------------------
   Firestore
------------------------------ */
async function saveScore(name, score) {
  await db.collection("scores").add({
    name,
    score,
    createdAt: Date.now()
  });
}

async function loadRanking() {
  const snap = await db.collection("scores")
    .orderBy("score", "desc")
    .limit(50)
    .get();

  const list = document.getElementById("rankingList");
  list.innerHTML = "";

  snap.forEach(doc => {
    const data = doc.data();
    const li = document.createElement("li");
    li.textContent = `${data.name}：${data.score}`;
    list.appendChild(li);
  });

  document.getElementById("ranking").style.display = "block";
}

/* ------------------------------
   ゲームロジック
------------------------------ */
function resetGame() {
  obstacles.forEach(o => o.el.remove());
  obstacles = [];
  dinoY = 0;
  dinoVY = 0;
  isOnGround = true;
  isCrouching = false;
  score = 0;
  speed = 6;
  spawnTimer = 0;
  speedTimer = 0;
  slowEventActive = false;
  scoreEl.textContent = "0";
  isGameOver = false;

  dino.classList.remove("crouch");

  // ★ 追加：スコア送信 UI を必ず閉じる
  document.getElementById("nameInput").style.display = "none";

  messageEl.innerHTML = "スペースキーでスタート";
  messageEl.style.display = "block";

  loadRanking();
}

function startGame() {
  if (isRunning) return;
  isRunning = true;
  messageEl.style.display = "none";
  lastTime = performance.now();
  bgm.currentTime = 0;
  bgm.play();
  requestAnimationFrame(loop);
}

function gameOver() {
  isRunning = false;
  isGameOver = true;

  bgm.pause();
  gameOverSound.currentTime = 0;
  gameOverSound.play();

  const finalScore = Math.floor(score);

  const tweetURL =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `めいだい恐竜ゲーム -極- のスコアは${finalScore}でした！`
    )}`;

  messageEl.innerHTML =
    `ゲームオーバー\nスコア: ${finalScore}\n\n` +
    `<a class="tweet-btn" href="${tweetURL}" target="_blank">Xで共有</a>\n\n` +
    `スペースキーでリトライ`;

  messageEl.style.display = "block";

  document.getElementById("nameInput").style.display = "block";

  document.getElementById("submitScore").onclick = async () => {
    const name = document.getElementById("playerName").value.trim();
    if (name === "") return;

    await saveScore(name, finalScore);
    document.getElementById("nameInput").style.display = "none";
    loadRanking();
  };

  document.getElementById("skipScore").onclick = () => {
    document.getElementById("nameInput").style.display = "none";
    resetGame();
    startGame();
  };
}

/* ------------------------------
   obstacle 生成
------------------------------ */
function spawnObstacle() {
  const el = document.createElement("div");
  el.className = "obstacle";
  game.appendChild(el);

  const type = Math.random();

  let bottom = groundY;
  let height = 40;
  let willDrop = false;

  // ▼ 地上 obstacle
  if (type < 0.33) {
    bottom = groundY;
    height = 40;
  }
  // ▼ 中段 obstacle（しゃがみ必須）
  else if (type < 0.66) {
    bottom = groundY + 30;
    height = 40;
  }
  // ▼ 一番上の空中 obstacle（ここが「落ちる or 落ちない」の対象）
  else {
    bottom = groundY + 120;
    height = 40;

    // ★ ここで「落ちるかどうか」をランダムに決める
    // 50% の確率でカクッと落ちる
    willDrop = Math.random() < 0.5;
  }

  el.style.bottom = bottom + "px";
  el.style.height = height + "px";

  const obstacle = {
    el,
    x: gameWidth,
    y: bottom,
    willDrop,   // ← 空中の一部だけ true になる
    dropped: false
  };

  el.style.left = obstacle.x + "px";
  obstacles.push(obstacle);
}

/* ------------------------------
   更新処理
------------------------------ */
function update(delta) {
  const groundOffset = (performance.now() / 5) % gameWidth;
  ground.style.transform = `translateX(${-groundOffset}px)`;

  score += delta * 0.01;
  scoreEl.textContent = Math.floor(score);

  speedTimer += delta;
 if (speedTimer >= 5000) {
  speedTimer = 0;
  speed *= 1.1;

  if (!slowEventActive && Math.random() < 0.4) {
    slowEventActive = true;

    const originalSpeed = speed;

    // ★ 下限 1.1 を守りつつ、減速しすぎないように調整
    const slowed = originalSpeed * 0.5;
    speed = Math.max(1.1, slowed);

    // ★ 減速時間を短くして「ゆっくりすぎる」問題を解消
    setTimeout(() => {
      speed = originalSpeed;
      slowEventActive = false;
    }, 600);  // ← 1200 → 600 に短縮
  }
}

  spawnInterval = 600 + Math.random() * 900;

 // 上昇中（dinoVY > 0）は今まで通り
if (dinoVY > 0) {
  dinoVY += gravity;  // gravity = -0.7 のままでOK
}
// 下降中（dinoVY <= 0）は弱い重力にする
else {
  dinoVY += gravity * 0.45;  // ← 落下だけゆっくり
}
  dinoY += dinoVY;
  if (dinoY < 0) {
    dinoY = 0;
    dinoVY = 0;
    isOnGround = true;
  }
  dino.style.bottom = (groundY + dinoY) + "px";

obstacles.forEach(o => {
  // 横移動（FPS非依存）
  o.x -= speed * (delta / 16.67);
  o.el.style.left = o.x + "px";

  // ▼ 空中 obstacle の「カクッと落下」処理（完全版）
if (o.willDrop && !o.dropped) {
  if (o.x < 420) {   // ← 260 → 420 に変更
    o.y = groundY + 30;
    o.el.style.bottom = o.y + "px";
    o.dropped = true;
  }
}
});


  obstacles = obstacles.filter(o => {
    if (o.x + 20 < 0) {
      o.el.remove();
      return false;
    }
    return true;
  });

  spawnTimer += delta;
  if (spawnTimer >= spawnInterval && !slowEventActive) {
    spawnTimer = 0;
    spawnObstacle();
  }

  const dinoRect = dino.getBoundingClientRect();
  for (const o of obstacles) {
    const r = o.el.getBoundingClientRect();

    const padding = 7;

    const dinoHit = {
      left: dinoRect.left + padding,
      right: dinoRect.right - padding,
      top: dinoRect.top + padding,
      bottom: dinoRect.bottom - padding
    };

    const obsHit = {
      left: r.left + padding,
      right: r.right - padding,
      top: r.top + padding,
      bottom: r.bottom - padding
    };

    const overlapX = dinoHit.right > obsHit.left && dinoHit.left < obsHit.right;
    const overlapY = dinoHit.bottom > obsHit.top && dinoHit.top < obsHit.bottom;

    if (overlapX && overlapY) {
      gameOver();
      break;
    }
  }
}

function loop(time) {
  if (!isRunning) return;
  const delta = time - lastTime;
  lastTime = time;
  update(delta);
  requestAnimationFrame(loop);
}

/* ------------------------------
   操作
------------------------------ */
function handleJump() {
  const nameInputVisible = document.getElementById("nameInput").style.display === "block";

  // ★ スコア送信 UI が出ているときは何もさせない
  if (nameInputVisible) return;

  if (!isRunning && !isGameOver) {
    startGame();
  } else if (isGameOver) {
    resetGame();
    startGame();
  } else {
    if (isOnGround && !isCrouching) {
      dinoVY = jumpVelocity;
      isOnGround = false;
      jumpSound.currentTime = 0;
      jumpSound.play();
    }
  }
}

window.addEventListener("keydown", e => {
  const nameInputVisible = document.getElementById("nameInput").style.display === "block";

  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();

    // ★ スコア送信 UI が出ているときは無効化
    if (nameInputVisible) return;

    handleJump();
  }

  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    isCrouching = true;
    dino.classList.add("crouch");
  }
});

window.addEventListener("keyup", e => {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    isCrouching = false;
    dino.classList.remove("crouch");
  }
});

document.getElementById("jumpBtn").addEventListener("click", handleJump);

resetGame();