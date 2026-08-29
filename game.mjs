const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const JOYSTICK_MAX = 32;
const VAMPIRE_HEAL_PER_HIT = 1;
const VAMPIRE_RUNE_CHANCE = .05;
function joystickVector(offsetX, offsetY, max = JOYSTICK_MAX) {
  const distance = Math.hypot(offsetX, offsetY);
  if (!distance || max <= 0) return { x: 0, y: 0 };
  const scale = Math.min(1, max / distance) / max;
  return { x: offsetX * scale, y: offsetY * scale };
}
const tileNoise = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const OBSTACLE_TILE = 224;

function tileRange(camera, viewport, tile) {
  return { start: Math.floor(camera / tile) - 1, end: Math.floor((camera + viewport) / tile) + 1 };
}

function obstacleAt(tileX, tileY) {
  const seed = tileNoise(tileX * 7 + 31, tileY * 11 - 19);
  if (seed < .75) return null;
  const x = tileX * OBSTACLE_TILE + 34 + tileNoise(tileX * 13 - 7, tileY * 5 + 23) * (OBSTACLE_TILE - 68);
  const y = tileY * OBSTACLE_TILE + 34 + tileNoise(tileX * 3 + 41, tileY * 17 - 5) * (OBSTACLE_TILE - 68);
  if (Math.hypot(x, y) < 170) return null;
  return { x, y, r: 20 + Math.floor(tileNoise(tileX * 29 + 2, tileY * 31 + 9) * 10), seed };
}

function hitsObstacle(x, y, radius) {
  const minX = Math.floor((x - radius - 30) / OBSTACLE_TILE);
  const maxX = Math.floor((x + radius + 30) / OBSTACLE_TILE);
  const minY = Math.floor((y - radius - 30) / OBSTACLE_TILE);
  const maxY = Math.floor((y + radius + 30) / OBSTACLE_TILE);
  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      const obstacle = obstacleAt(tileX, tileY);
      if (obstacle && Math.hypot(x - obstacle.x, y - obstacle.y) < radius + obstacle.r) return true;
    }
  }
  return false;
}

function facingAngle(frame) {
  return [-3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4, Math.PI, Math.PI / 2, 0, 3 * Math.PI / 4, Math.PI / 2, Math.PI / 4][frame];
}

function fanAngles(center, count, spread) {
  return Array.from({ length: count }, (_, index) => center + (index - (count - 1) / 2) * spread);
}

function applyPickup(player, kind) {
  if (kind === 'fruit') {
    player.hp = Math.min(player.maxHp, player.hp + 28);
    return { text: '野果 · 生命 +28', color: '#ff9b79' };
  }
  if (kind === 'ember') {
    player.nova = 0;
    return { text: '火种 · 脉冲已就绪', color: '#ffd078' };
  }
  if (kind === 'relic') return { text: '引力晶核 · 全图样本吸收', color: '#8ee7e4', vacuum: true };
  if (kind === 'haste') {
    player.haste = Math.max(player.haste, 8);
    return { text: '疾风孢子 · 加速 8 秒', color: '#c7ef8d' };
  }
  if (kind === 'ward') {
    player.invuln = Math.max(player.invuln, 3);
    return { text: '祖灵护符 · 无敌 3 秒', color: '#aabdf5' };
  }
  if (kind === 'vampire') {
    player.vampireLevel = (player.vampireLevel || 0) + 1;
    return { text: `吸血符文 +1 · 命中回复 ${player.vampireLevel * VAMPIRE_HEAL_PER_HIT}`, color: '#e78aa8' };
  }
  player.pierce += 1;
  return { text: '兽骨 · 穿透 +1', color: '#d9e3be' };
}

function applyVampireHeal(player, stacks) {
  const amount = Math.max(0, Math.floor(stacks || 0)) * VAMPIRE_HEAL_PER_HIT;
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  return player.hp - before;
}

function chooseUnique(items, count, random = Math.random) {
  const pool = [...items];
  const choices = [];
  while (pool.length && choices.length < count) {
    choices.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return choices;
}

const TAU = Math.PI * 2;
const BIOME_DURATION = 40;
const DIFFICULTIES = {
  gentle: { label: '游猎', short: '简', hp: .84, damage: .76, speed: .94, spawnRate: .84, hitInvuln: .65, pickupEvery: 4, scoreMultiplier: .8, description: '敌人较弱，出现较慢' },
  normal: { label: '迁徙', short: '中', hp: 1.08, damage: 1.12, speed: 1.03, spawnRate: 1.12, hitInvuln: .5, pickupEvery: 5, scoreMultiplier: 1, description: '敌人更强，攻势更密集' },
  harsh: { label: '试炼', short: '难', hp: 1.42, damage: 1.48, speed: 1.12, spawnRate: 1.38, hitInvuln: .42, pickupEvery: 6, scoreMultiplier: 1.35, description: '敌人凶猛，补给稀少' },
};

function difficultyFor(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}

function spawnInterval(time, difficulty) {
  return Math.max(.16, .68 - time * .0042) / difficulty.spawnRate;
}

function pickupIndex(kills, pickupEvery, kinds) {
  return (Math.floor(kills / pickupEvery) - 1) % kinds;
}

const GROWTH_FORMS = [
  { name: '萌芽', kind: 'gene', color: '#edf1a6', glow: '#c9d86a', speed: 415, radius: 4.5 },
  { name: '猎手', kind: 'flint', color: '#d9d2bc', glow: '#f0d79b', speed: 470, radius: 5.5 },
  { name: '火种', kind: 'ember', color: '#ff9a52', glow: '#ffcf70', speed: 520, radius: 6.5 },
];

function growthForm(stage) {
  return GROWTH_FORMS[clamp(stage, 0, GROWTH_FORMS.length - 1)];
}

const BIOMES = [
  { name: '潮痕海岸', subtitle: '潮池孕育最初的生命火种', colors: ['#b9c293', '#91a783', '#6b8981'], accent: '#dce5bd', terrain: 'shore', enemies: ['amoeba', 'leech', 'crab', 'savage'], boss: 'tideBoss' },
  { name: '苔木密林', subtitle: '在巨木与藤蔓间寻找部落火种', colors: ['#6d8055', '#4b643d', '#354b34'], accent: '#b4ca78', terrain: 'forest', enemies: ['beetle', 'moth', 'thorn', 'infantry'], boss: 'groveBoss' },
  { name: '火山荒原', subtitle: '穿过熔岩与灰烬，守住文明火种', colors: ['#805240', '#573833', '#33252b'], accent: '#f2a05d', terrain: 'volcano', enemies: ['mutant', 'reclaimer', 'wisp'], boss: 'reversionBoss' },
];
const BOSS_TIME = BIOME_DURATION;

function stageClock(stageTime, bossActive, dt) {
  return bossActive ? stageTime : stageTime + dt;
}

function nextBiomeAfterBoss(biomeIndex) {
  return biomeIndex < BIOMES.length - 1 ? biomeIndex + 1 : null;
}

function getBiomeIndex(time) {
  return clamp(Math.floor(time / BIOME_DURATION), 0, BIOMES.length - 1);
}

function cameraFromPlayer(player, width, height) {
  return { x: player.x - width / 2, y: player.y - height / 2 };
}

function directionFrame(dx, dy) {
  const horizontal = Math.sign(dx);
  const vertical = Math.sign(dy);
  if (vertical < 0) return horizontal < 0 ? 0 : horizontal > 0 ? 2 : 1;
  if (vertical > 0) return horizontal < 0 ? 6 : horizontal > 0 ? 8 : 7;
  return horizontal < 0 ? 3 : horizontal > 0 ? 5 : 4;
}

function mirrorFacing(frame) {
  return frame === 0 || frame === 3 || frame === 6;
}

function enemyVisualScale(enemy, art) {
  return art.scale * art.size * (enemy.boss ? 1.34 : 1) * (1 + Math.min(.14, enemy.xp * .025));
}

const ENEMY_TYPES = {
  amoeba: { hp: 24, speed: 56, radius: 12, xp: 1, score: 8, damage: 8, color: '#76b7a3', form: 'blob', name: '潮池异螺', skill: 'spit', skillEvery: 2.9, skillRange: 265, shotKind: 'goo', shotSpeed: 150, shots: 2, shotSpread: .2 },
  leech: { hp: 18, speed: 90, radius: 8, xp: 1, score: 6, damage: 7, color: '#d5a764', form: 'spore', name: '砂砾虫', skill: 'dash', skillEvery: 3.1, skillRange: 235 },
  crab: { hp: 58, speed: 43, radius: 17, xp: 3, score: 24, damage: 13, color: '#4f8190', form: 'crab', name: '礁甲蟹', skill: 'pulse', skillEvery: 4.1, skillRange: 105, skillRadius: 90, skillPower: 1 },
  savage: { hp: 46, speed: 72, radius: 15, xp: 2, score: 16, damage: 11, color: '#b56b36', form: 'savage', name: '野人', skill: 'dash', skillEvery: 2.45, skillRange: 250 },
  beetle: { hp: 52, speed: 48, radius: 15, xp: 3, score: 22, damage: 12, color: '#78aa54', form: 'shell', name: '苔甲虫', skill: 'shell', skillEvery: 4.3, skillRange: Infinity },
  moth: { hp: 23, speed: 106, radius: 10, xp: 2, score: 14, damage: 8, color: '#c0cd72', form: 'wing', name: '叶翼飞虫', skill: 'fan', skillEvery: 3.1, skillRange: 290, shotKind: 'spore', shotSpeed: 175, shots: 3, canFly: true },
  thorn: { hp: 40, speed: 39, radius: 14, xp: 3, score: 20, damage: 12, color: '#80964c', form: 'thorn', name: '缠根囊', skill: 'root', skillEvery: 3.5, skillRange: 300, shotKind: 'root', shotSpeed: 132 },
  infantry: { hp: 82, speed: 54, radius: 17, xp: 3, score: 28, damage: 16, color: '#7188a1', form: 'infantry', name: '中世纪步兵', skill: 'throw', skillEvery: 2.65, skillRange: 285, shotKind: 'spear', shotSpeed: 255 },
  mutant: { hp: 76, speed: 43, radius: 19, xp: 4, score: 36, damage: 15, color: '#d16e48', form: 'mutant', name: '熔岩蜥', skill: 'dash', skillEvery: 3.7, skillRange: 265 },
  reclaimer: { hp: 42, speed: 82, radius: 13, xp: 2, score: 18, damage: 12, color: '#ab7058', form: 'reclaimer', name: '灰烬猎犬', skill: 'fan', skillEvery: 3.2, skillRange: 285, shotKind: 'ash', shotSpeed: 190, shots: 5, shotSpread: .22 },
  wisp: { hp: 28, speed: 86, radius: 11, xp: 3, score: 25, damage: 11, color: '#ed8a4e', form: 'wisp', name: '熔灰飞灵', skill: 'fire', skillEvery: 2.8, skillRange: 310, shotKind: 'fire', shotSpeed: 205, canFly: true },
  tideBoss: { hp: 620, speed: 39, radius: 42, xp: 14, score: 180, damage: 20, color: '#62aeb8', form: 'boss', name: '潮涌巨蟹', skill: 'tide', skillEvery: 3.65, skillRange: 340, shotKind: 'goo', shotSpeed: 185, shots: 7, shotSpread: .42, sprite: 'tideBoss' },
  groveBoss: { hp: 720, speed: 35, radius: 44, xp: 16, score: 240, damage: 23, color: '#92ad59', form: 'boss', name: '古木守卫', skill: 'grove', skillEvery: 3.15, skillRange: 350, shotKind: 'root', shotSpeed: 190, shots: 5, shotSpread: .18, sprite: 'groveBoss' },
  reversionBoss: { hp: 820, speed: 45, radius: 46, xp: 18, score: 320, damage: 25, color: '#e77c45', form: 'boss', name: '赤焰巨猿', skill: 'pulse', skillEvery: 4.4, skillRange: 300, skillRadius: 175, skillPower: 1.28, shotKind: 'fire', shotSpeed: 215, shots: 5, shotSpread: .2 },
};

const ENEMY_SHOT_STYLES = {
  goo: { color: '#7cd5a7', glow: '#b6f0bf', slow: 1.1 },
  spore: { color: '#d5df79', glow: '#eef3aa', slow: 0 },
  root: { color: '#9ac26a', glow: '#d2e591', slow: 1.55 },
  spear: { color: '#d7e1ee', glow: '#a6c6e8', slow: 0 },
  ash: { color: '#c08b77', glow: '#ebbc9a', slow: 0 },
  fire: { color: '#ff8c54', glow: '#ffd26f', slow: 0 },
};

// Boss shots keep a distinct, biome-led silhouette, with code fallbacks while
// an image is still loading.
const BOSS_SHOT_ART = {
  tideBoss: { id: 'bubble', color: '#91e6ee', glow: '#d0fbff', sprite: 'bubble' },
  groveBoss: { id: 'leaf', color: '#c6ec7c', glow: '#effcb7', sprite: 'leaf' },
  reversionBoss: { id: 'flame', color: '#ff9a59', glow: '#ffd26f', sprite: 'flame' },
};

function bossShotArt(enemy) {
  return enemy?.boss ? BOSS_SHOT_ART[enemy.kind] || null : null;
}

function enemyStats(kind, hpScale = 1, damageScale = 1, speedScale = 1) {
  const base = ENEMY_TYPES[kind];
  return {
    ...base,
    sprite: base.sprite || (ENEMY_ART[kind] ? kind : undefined),
    hp: Math.round(base.hp * hpScale),
    maxHp: Math.round(base.hp * hpScale),
    damage: Math.max(1, Math.round(base.damage * damageScale)),
    speed: base.speed * speedScale,
  };
}

function enemyScore(enemy, difficulty = DIFFICULTIES.normal) {
  return Math.max(1, Math.round((enemy.score ?? enemy.xp * 10) * (difficulty.scoreMultiplier ?? 1)));
}

const SPRITE_FRAMES = [
  { x: 195, y: 129, w: 152, h: 240 }, { x: 547, y: 130, w: 154, h: 240 }, { x: 900, y: 126, w: 150, h: 241 },
  { x: 202, y: 499, w: 135, h: 242 }, { x: 549, y: 499, w: 148, h: 244 }, { x: 907, y: 499, w: 134, h: 243 },
  { x: 195, y: 861, w: 144, h: 240 }, { x: 547, y: 862, w: 150, h: 241 }, { x: 901, y: 858, w: 144, h: 245 },
];

const OBSTACLE_ART = {
  shore: { source: './assets/shore-reef.png?v=20260825-7', height: 2.35, floor: .56 },
  forest: { source: './assets/forest-tree.png?v=20260825-7', height: 3.25, floor: .78 },
  volcano: { source: './assets/volcano-spire.png?v=20260825-7', height: 3.5, floor: .72 },
};

const RELIC_ART = {
  shore: { source: './assets/relic-tide-ruin.png?v=20260828-1', size: 106 },
  forest: { source: './assets/relic-forest-ruin.png?v=20260828-1', size: 110 },
  volcano: { source: './assets/relic-volcano-ruin.png?v=20260828-1', size: 108 },
};

const ENEMY_SPRITE_FRAMES = {
  savage: Array.from({ length: 9 }, (_, index) => ({ x: index % 3 * 418, y: Math.floor(index / 3) * 418, w: 418, h: 418 })),
  infantry: Array.from({ length: 9 }, (_, index) => ({ x: index % 3 * 418, y: Math.floor(index / 3) * 418, w: 418, h: 418 })),
};

const ENEMY_ART = {
  amoeba: { source: './assets/enemy-tide-snail.png?v=20260827-1', frame: [154, 246, 926, 727], scale: .041, size: .95 },
  leech: { source: './assets/enemy-grit-worm.png?v=20260827-1', frame: [109, 275, 1035, 690], scale: .029, size: .88 },
  crab: { source: './assets/enemy-reef-crab.png?v=20260827-1', frame: [74, 217, 1110, 805], scale: .041, size: 1.12 },
  savage: { source: './assets/savage.png?v=20260825-6', frames: ENEMY_SPRITE_FRAMES.savage, scale: .20, size: 1.04 },
  beetle: { source: './assets/enemy-moss-beetle.png?v=20260827-1', frame: [99, 53, 1049, 1113], scale: .042, size: 1.1 },
  moth: { source: './assets/enemy-leaf-moth.png?v=20260827-1', frame: [90, 78, 1050, 1074], scale: .034, size: .98 },
  thorn: { source: './assets/enemy-root-pod.png?v=20260827-1', frame: [113, 39, 1029, 1161], scale: .042, size: 1.05 },
  infantry: { source: './assets/infantry.png?v=20260825-6', frames: ENEMY_SPRITE_FRAMES.infantry, scale: .20, size: 1.1 },
  mutant: { source: './assets/enemy-lava-lizard.png?v=20260827-1', frame: [32, 383, 1181, 510], scale: .050, size: 1.14 },
  reclaimer: { source: './assets/enemy-ash-hound.png?v=20260827-1', frame: [43, 235, 1186, 786], scale: .044, size: 1.04 },
  wisp: { source: './assets/enemy-ash-wisp.png?v=20260827-1', frame: [141, 141, 959, 965], scale: .041, size: 1.02 },
  tideBoss: { source: './assets/boss-tide-crab.png?v=20260828-1', frame: [0, 0, 1254, 1254], scale: .070, size: 1.1 },
  groveBoss: { source: './assets/boss-ancient-warden.png?v=20260828-1', frame: [0, 0, 1254, 1254], scale: .072, size: 1.1 },
  reversionBoss: { source: './assets/enemy-flame-ape.png?v=20260827-1', frame: [23, 22, 1185, 1170], scale: .077, size: 1.15 },
};

const FAN_HANDLE_ANGLE = 1.92;
const EFFECT_ART = {
  fan: { source: './assets/fan.png?v=20260827-14', size: 54 },
  flame: { source: './assets/flame.png?v=20260827-14', size: 28 },
  bubble: { source: './assets/boss-bubble.png?v=20260828-1', size: 32 },
  leaf: { source: './assets/boss-leaf.png?v=20260828-1', size: 34 },
  venom: { source: './assets/venom.png?v=20260827-14', width: 58, height: 42 },
  hurricane: { source: './assets/hurricane.png?v=20260827-14', size: 46 },
};

const HURRICANE_SPEED = 580;
const HURRICANE_KNOCKBACK = 42;

function hurricaneKnockback(vx, vy, boss) {
  if (boss) return null;
  const length = Math.hypot(vx, vy) || 1;
  return { x: vx / length * HURRICANE_KNOCKBACK, y: vy / length * HURRICANE_KNOCKBACK };
}

function healOnLevel(player) {
  player.hp = Math.min(player.maxHp, player.hp + player.maxHp * .5);
}

function orbitFanAngle(orbitAngle) {
  return orbitAngle + Math.PI - FAN_HANDLE_ANGLE;
}

const UPGRADES = [
  { id: 'hunterForm', icon: '◇', name: '猎手蜕变', text: '萌芽弹化为燧石弹：伤害 +5，穿透 +1', requires: p => p.growthStage === 0, apply: p => { p.growthStage = 1; p.damage += 5; p.pierce += 1; } },
  { id: 'fireForm', icon: '✹', name: '火种蜕变', text: '燧石弹化为火种弹：伤害 +8，攻速 +12%', requires: p => p.growthStage === 1, apply: p => { p.growthStage = 2; p.damage += 8; p.fireEvery = Math.max(.12, p.fireEvery * .88); } },
  { id: 'rapid', icon: '✦', name: '神经加速', text: '攻击间隔 -22%', apply: p => { p.fireEvery = Math.max(.12, p.fireEvery * .78); } },
  { id: 'power', icon: '✹', name: '骨刺投射', text: '基因弹伤害 +10', apply: p => { p.damage += 10; } },
  { id: 'split', icon: '✧', name: '群体适应', text: '额外投射 2 枚基因弹', apply: p => { p.projectiles = Math.min(7, p.projectiles + 2); } },
  { id: 'stride', icon: '➜', name: '双足进化', text: '移动速度 +15%', apply: p => { p.speed *= 1.15; } },
  { id: 'vital', icon: '♥', name: '细胞修复', text: '生命上限 +30，并回复 30', apply: p => { p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); } },
  { id: 'pierce', icon: '↯', name: '穿透突变', text: '基因弹额外穿透 2 个敌人', apply: p => { p.pierce += 2; } },
  { id: 'magnet', icon: '◉', name: '群落感知', text: '样本拾取范围 +35%', apply: p => { p.magnet *= 1.35; } },
  { id: 'nova', icon: '☀', name: '演化脉冲', text: '脉冲冷却 -1.8 秒', apply: p => { p.novaMax = Math.max(3.5, p.novaMax - 1.8); } },
  { id: 'spikes', icon: '⌁', name: '石矛增生', text: '扇形石矛 +3，伤害 +8', apply: p => { p.spikeCount = Math.min(9, p.spikeCount + 3); p.spikeDamage += 8; } },
  { id: 'spikeRapid', icon: '➹', name: '投矛熟练', text: '石矛齐射间隔 -0.45 秒', apply: p => { p.spikeEvery = Math.max(.85, p.spikeEvery - .45); } },
  { id: 'orbit', icon: '◌', name: '祖灵扇阵', text: '新增两枚环绕扇子，伤害 +8，攻击更快', requires: p => p.orbitCount < 7, apply: p => { p.orbitCount = Math.min(7, p.orbitCount + 2); p.orbitDamage += 8; p.orbitEvery = Math.max(.18, p.orbitEvery - .06); } },
  { id: 'chain', icon: 'ϟ', name: '雷群感应', text: '学习连锁电弧：自动跳跃攻击 2 个目标', requires: p => !p.chainLevel, apply: p => { p.chainLevel = 1; p.chainTimer = .2; } },
  { id: 'chainPlus', icon: 'ϟ', name: '电弧增幅', text: '连锁电弧额外跳跃 2 次，伤害 +9', requires: p => p.chainLevel > 0 && p.chainLevel < 3, apply: p => { p.chainLevel = Math.min(3, p.chainLevel + 2); p.chainDamage += 9; p.chainEvery = Math.max(1.1, p.chainEvery - .4); } },
  { id: 'wheel', icon: '◈', name: '旋骨飞轮', text: '学习旋骨飞轮：沿面向穿透敌人', requires: p => !p.wheelLevel, apply: p => { p.wheelLevel = 1; p.wheelTimer = .3; } },
  { id: 'wheelPlus', icon: '◈', name: '飞轮淬炼', text: '旋骨飞轮伤害 +9，穿透 +2，发射更快', requires: p => p.wheelLevel > 0 && p.wheelLevel < 3, apply: p => { p.wheelLevel = Math.min(3, p.wheelLevel + 2); p.wheelDamage += 9; p.wheelEvery = Math.max(1.2, p.wheelEvery - .5); } },
];

const PICKUPS = {
  fruit: { color: '#ed806b', glow: '#ffad86' },
  ember: { color: '#f5b35d', glow: '#ffdf79' },
  bone: { color: '#d8ddba', glow: '#f2efcc' },
  relic: { color: '#72d4d0', glow: '#b7fff7' },
  haste: { color: '#a8de66', glow: '#ddffad' },
  ward: { color: '#95a8ed', glow: '#d1dcff' },
  vampire: { color: '#d96f97', glow: '#ffb1c8' },
};

const ACTIVE_SKILLS = {
  dash: { label: '疾驰', key: 'Q', cooldown: 3.2, cooldownStep: .14, color: '#8ee6ce', upgrade: '距离与无敌时间增加，冷却 -0.14 秒' },
  spear: { label: '飓风', key: 'E', cooldown: 5.4, cooldownStep: .24, color: '#9edcff', upgrade: '风势、伤害与穿透小幅增加，冷却 -0.24 秒' },
  ward: { label: '护壁', key: 'R', cooldown: 12, cooldownStep: .54, color: '#aebdff', upgrade: '持续、范围与减伤逐级增强，冷却 -0.54 秒' },
};

// Fixed relics seed the map; more copies appear as the open world expands.
const RELIC_BUILDING_SITES = [
  { x: 230, y: -170, hp: 110, r: 36, skill: 'dash', name: '风痕遗迹' },
  { x: -300, y: 360, hp: 130, r: 38, skill: 'spear', name: '风暴祭坛' },
  { x: 340, y: 760, hp: 150, r: 40, skill: 'ward', name: '祖灵石碑' },
];
const ACTIVE_SKILL_MAX_LEVEL = 10;
const RELIC_RESPAWN_INTERVAL = 7;
const RELIC_MAX_ACTIVE = 9;

function makeRelicBuilding(site, x = site.x, y = site.y, terrain = 'shore') {
  return { ...site, x, y, terrain, maxHp: site.hp, hit: 0, isBuilding: true };
}

function makeRelicBuildings(terrain = 'shore') {
  return RELIC_BUILDING_SITES.map(site => makeRelicBuilding(site, site.x, site.y, terrain));
}

function activeSkillCooldown(player, id) {
  const skill = ACTIVE_SKILLS[id];
  return Math.max(skill.cooldown * .55, skill.cooldown - (player[`${id}Level`] || 0) * skill.cooldownStep);
}

const XP_PER_GEM = 1;
const LEADERBOARD_KEY = 'civilization-fire-leaderboard-v1';
const LEADERBOARD_LIMIT = 20;

function leaderboardStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function normalizePlayerName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 16) || '玩家';
}

function readLeaderboard(storage = leaderboardStorage()) {
  if (!storage) return [];
  try {
    const rows = JSON.parse(storage.getItem(LEADERBOARD_KEY) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row && Number.isFinite(Number(row.score)) && row.name)
      .map(row => ({ name: normalizePlayerName(row.name), score: Math.max(0, Math.floor(Number(row.score))), difficulty: String(row.difficulty || '中'), time: Math.max(0, Math.floor(Number(row.time) || 0)), at: Number(row.at) || 0 }))
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, LEADERBOARD_LIMIT);
  } catch {
    return [];
  }
}

function saveLeaderboardEntry(name, score, difficulty, time, storage = leaderboardStorage()) {
  const row = { name: normalizePlayerName(name), score: Math.max(0, Math.floor(Number(score) || 0)), difficulty: String(difficulty || '中'), time: Math.max(0, Math.floor(Number(time) || 0)), at: Date.now() };
  const rows = [...readLeaderboard(storage), row].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, LEADERBOARD_LIMIT);
  if (storage) {
    try { storage.setItem(LEADERBOARD_KEY, JSON.stringify(rows)); } catch { /* private mode / quota full: keep the run visible in memory */ }
  }
  return rows;
}

const MUSIC_LOOP_SECONDS = 8;
const MUSIC_GAIN = 1.10;
const MUSIC_STAGES = [
  { energy: .10, bass: [-12, -8, -5, -10], melody: [7, 10, 12, 10, 7, 5, 3, 5, 10, 12, 15, 12, 10, 7, 5, 3] },
  { energy: .26, bass: [-10, -7, -3, -8], melody: [5, 8, 10, 12, 10, 8, 5, 3, 8, 10, 13, 12, 10, 8, 5, 1] },
  { energy: .42, bass: [-17, -13, -10, -15], melody: [3, 6, 8, 6, 3, 1, -2, 1, 6, 8, 10, 8, 6, 3, 1, -2] },
  { energy: .58, bass: [-12, -7, -5, -9], melody: [7, 10, 12, 14, 12, 10, 7, 5, 10, 12, 15, 14, 12, 10, 7, 5] },
  { energy: .72, bass: [-10, -6, -3, -7], melody: [5, 8, 12, 10, 8, 5, 3, 1, 8, 10, 13, 12, 10, 8, 5, 3] },
  { energy: .84, bass: [-15, -12, -8, -10], melody: [7, 10, 7, 12, 10, 7, 5, 3, 10, 12, 15, 12, 10, 7, 5, 3] },
  { energy: .68, bass: [-12, -5, -3, -7], melody: [10, 12, 15, 17, 15, 12, 10, 7, 12, 15, 17, 19, 17, 15, 12, 10] },
  { energy: .82, bass: [-10, -5, -1, -5], melody: [8, 12, 15, 17, 15, 12, 8, 5, 12, 15, 19, 17, 15, 12, 8, 5] },
  { energy: 1, bass: [-15, -12, -5, -10], melody: [10, 12, 15, 12, 10, 7, 5, 7, 12, 15, 17, 15, 12, 10, 7, 5] },
];

function musicStageFor(biomeIndex, boss) {
  const index = clamp(boss?.biomeIndex ?? biomeIndex, 0, BIOMES.length - 1);
  if (boss?.boss && !boss.dead) return BIOMES.length + index + (boss.phaseTwo ? BIOMES.length : 0);
  return index;
}

function bossBarVisible(boss) {
  return Boolean(boss?.boss && !boss.dead && boss.hp > 0 && boss.maxHp > 0);
}

function bossBarLayout(width, height) {
  const barWidth = Math.min(440, Math.max(180, width - 54));
  return { x: (width - barWidth) / 2, y: Math.min(120, Math.max(106, Math.round(height * .17))), width: barWidth };
}

function bossArrowLayout(width, height, boss, camera = { x: 0, y: 0 }) {
  if (!bossBarVisible(boss)) return null;
  const margin = 26;
  const top = Math.min(height - 80, bossBarLayout(width, height).y + 56);
  const bottom = height - 28;
  const centerX = width / 2;
  const centerY = (top + bottom) / 2;
  const targetX = boss.x - (camera.x || 0);
  const targetY = boss.y - (camera.y || 0);
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  const onScreen = targetX >= margin && targetX <= width - margin && targetY >= top && targetY <= bottom;
  const distance = Math.hypot(dx, dy);
  const heading = distance > 1 ? Math.atan2(dy, dx) : -Math.PI / 2;
  if (onScreen) return { x: targetX - Math.cos(heading) * 24, y: targetY - Math.sin(heading) * 24, angle: heading, offscreen: false };
  const scale = Math.min((width / 2 - margin) / Math.max(1, Math.abs(dx)), ((bottom - top) / 2 - 8) / Math.max(1, Math.abs(dy)));
  const x = clamp(centerX + dx * scale, margin, width - margin);
  const y = clamp(centerY + dy * scale, top, bottom);
  return { x, y, angle: Math.atan2(targetY - y, targetX - x), offscreen: true };
}

function musicFrequency(semitones) {
  return 110 * 2 ** (semitones / 12);
}

function createMusicLoop(context, stage = 0) {
  const profile = MUSIC_STAGES[clamp(stage, 0, MUSIC_STAGES.length - 1)];
  const energy = profile.energy;
  const frames = Math.round(context.sampleRate * MUSIC_LOOP_SECONDS);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const samples = buffer.getChannelData(0);
  const addTone = (start, duration, semitones, volume, harmonic = 0) => {
    const first = Math.max(0, Math.floor(start * context.sampleRate));
    const last = Math.min(frames, Math.ceil((start + duration) * context.sampleRate));
    const frequency = musicFrequency(semitones);
    for (let index = first; index < last; index += 1) {
      const time = (index - first) / context.sampleRate;
      const envelope = Math.max(0, Math.min(1, time / .025, (duration - time) / .1));
      samples[index] += (Math.sin(TAU * frequency * time) + Math.sin(TAU * frequency * 2 * time) * harmonic) * envelope * volume;
    }
  };
  for (let bar = 0; bar < profile.bass.length; bar += 1) {
    const start = bar * 2;
    addTone(start, 1.55, profile.bass[bar], .105 + energy * .025, .08 + energy * .12);
    for (let beat = 0; beat < 4; beat += 1) {
      const beatStart = start + beat * .5;
      addTone(beatStart, .3, profile.bass[bar] + (beat === 2 ? 7 : 12), .035 + energy * .027, .2 + energy * .28);
      if (energy > .08) addTone(beatStart, .055, profile.bass[bar] - 24, .008 + energy * .018, .05);
      if (energy > .35 && beat % 2 === 1) addTone(beatStart + .25, .045, profile.bass[bar] - 17, .010 + energy * .020, .15);
      if (energy > .32) addTone(beatStart + .18, .08, profile.bass[bar] - 12, .018 + energy * .035, .72);
      if (energy > .5) addTone(beatStart + .25, .06, profile.bass[bar] - 19, .012 + energy * .022, .86);
      if (energy > .68) addTone(beatStart + .36, .055, profile.bass[bar] + 19, .016 + energy * .028, .58);
    }
  }
  profile.melody.forEach((note, index) => addTone(index * .5 + .04, .32, note, .045 + energy * .030, .25 + energy * .38));
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.tanh(samples[index] * (1.35 + energy * .42)) * .6;
  return buffer;
}

class Game {
  constructor(canvas, dom) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dom = dom;
    this.dpr = 1;
    this.width = 360;
    this.height = 640;
    this.keys = new Set();
    this.pointer = null;
    this.joystick = null;
    this.lastFrame = 0;
    this.time = 0;
    this.state = 'menu';
    this.difficultyId = 'normal';
    this.difficulty = difficultyFor(this.difficultyId);
    this.camera = { x: 0, y: 0 };
    this.musicContext = null;
    this.musicGain = null;
    this.musicBuffers = null;
    this.musicSource = null;
    this.musicSourceGain = null;
    this.musicStage = -1;
    this.sprite = new Image();
    this.spriteReady = false;
    this.sprite.addEventListener('load', () => { this.spriteReady = true; });
    this.sprite.addEventListener('error', () => { console.warn('贴图加载失败：evolution-guide.png'); });
    this.sprite.src = './assets/evolution-guide.png?v=20260825-3';
    this.enemySprites = {};
    this.obstacleSprites = {};
    this.relicSprites = {};
    this.effectSprites = {};
    this.loadBiomeSprites(0);
    this.loadEffectSprite('fan');
    this.loadEffectSprite('hurricane');
    this.resize();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(time => this.frame(time));
  }

  loadSprite(store, key, art) {
    if (store[key] || !art) return store[key];
    const image = new Image();
    const sprite = { image, ready: false, failed: false, ...art };
    image.addEventListener('load', () => { sprite.ready = true; });
    image.addEventListener('error', () => {
      sprite.failed = true;
      console.warn(`贴图加载失败：${art.source}`);
    });
    image.src = art.source;
    store[key] = sprite;
    return sprite;
  }

  loadEnemySprite(kind) {
    return this.loadSprite(this.enemySprites, kind, ENEMY_ART[kind]);
  }

  loadEffectSprite(kind) {
    return this.loadSprite(this.effectSprites, kind, EFFECT_ART[kind]);
  }

  loadBiomeSprites(index) {
    const biome = BIOMES[index];
    if (!biome) return;
    biome.enemies.forEach(kind => this.loadEnemySprite(kind));
    this.loadSprite(this.obstacleSprites, biome.terrain, OBSTACLE_ART[biome.terrain]);
    this.loadSprite(this.relicSprites, biome.terrain, RELIC_ART[biome.terrain]);
  }

  startMusic() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.musicContext || this.musicContext.state === 'closed') {
      this.musicContext = new AudioContext();
      this.musicGain = this.musicContext.createGain();
      this.musicGain.gain.value = MUSIC_GAIN;
      this.musicGain.connect(this.musicContext.destination);
      this.musicBuffers = MUSIC_STAGES.map((_, stage) => createMusicLoop(this.musicContext, stage));
    }
    void this.musicContext.resume().catch(() => {});
    this.setMusicStage(musicStageFor(this.biomeIndex || 0, this.boss));
  }

  setMusicStage(stage) {
    if (!this.musicContext || !this.musicGain) return;
    const nextStage = clamp(stage, 0, MUSIC_STAGES.length - 1);
    if (nextStage === this.musicStage && this.musicSource) return;
    const buffer = this.musicBuffers?.[nextStage] || createMusicLoop(this.musicContext, nextStage);
    if (this.musicBuffers) this.musicBuffers[nextStage] = buffer;
    const now = this.musicContext.currentTime;
    const source = this.musicContext.createBufferSource();
    const sourceGain = this.musicContext.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    sourceGain.gain.setValueAtTime(0, now);
    sourceGain.gain.linearRampToValueAtTime(1, now + .24);
    source.connect(sourceGain);
    sourceGain.connect(this.musicGain);
    source.start(now);
    const previousSource = this.musicSource;
    const previousGain = this.musicSourceGain;
    this.musicSource = source;
    this.musicSourceGain = sourceGain;
    this.musicStage = nextStage;
    source.onended = () => {
      source.disconnect();
      sourceGain.disconnect();
      if (this.musicSource === source) {
        this.musicSource = null;
        this.musicSourceGain = null;
      }
    };
    if (previousSource) {
      previousGain.gain.cancelScheduledValues(now);
      previousGain.gain.setValueAtTime(Math.max(.001, previousGain.gain.value), now);
      previousGain.gain.linearRampToValueAtTime(0, now + .24);
      previousSource.stop(now + .26);
    }
  }

  stopMusic() {
    if (this.musicSource) {
      this.musicSource.onended = null;
      this.musicSource.stop();
      this.musicSource.disconnect();
      this.musicSource = null;
    }
    if (this.musicSourceGain) {
      this.musicSourceGain.disconnect();
      this.musicSourceGain = null;
    }
    this.musicStage = -1;
    if (this.musicContext?.state === 'running') void this.musicContext.suspend().catch(() => {});
  }

  reset(difficultyId = 'normal') {
    this.difficultyId = DIFFICULTIES[difficultyId] ? difficultyId : 'normal';
    this.difficulty = difficultyFor(this.difficultyId);
    this.state = 'playing';
    this.time = 0;
    this.score = 0;
    this.scoreSubmitted = false;
    this.kills = 0;
    this.level = 1;
    this.xp = 0;
    this.nextXp = 7;
    this.spawnTimer = .7 / this.difficulty.spawnRate;
    this.bossSpawned = false;
    this.boss = null;
    this.biomeIndex = 0;
    this.loadBiomeSprites(this.biomeIndex);
    this.stageTime = 0;
    this.biomeNotice = 3;
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.buildings = makeRelicBuildings(BIOMES[this.biomeIndex].terrain);
    this.relicTimer = 4;
    this.gems = [];
    this.pickups = [];
    this.particles = [];
    this.rings = [];
    this.zaps = [];
    this.shake = 0;
    this.pickupNotice = null;
    this.player = {
      x: 0, y: 0, r: 17, hp: 100, maxHp: 100, speed: 170, facing: 4,
      fireEvery: .43, fireTimer: .15, damage: 18, projectiles: 1, pierce: 0, magnet: 86,
      spikeEvery: 2.18, spikeTimer: .8, spikeCount: 3, spikeDamage: 16,
      growthStage: 0, orbitCount: 1, orbitDamage: 14, orbitEvery: .36, orbitTimer: .16,
      vampireLevel: 0,
      chainLevel: 0, chainEvery: 2.45, chainTimer: .4, chainDamage: 25,
      wheelLevel: 0, wheelEvery: 2.8, wheelTimer: .6, wheelDamage: 24,
      invuln: 0, hitInvuln: this.difficulty.hitInvuln, nova: 0, novaMax: 9, flash: 0, hitPulse: 0, slow: 0, haste: 0,
      dashCooldown: 0, dashTime: 0, dashAngle: 0, dashLevel: 0,
      spearCooldown: 0, spearLevel: 0,
      wardCooldown: 0, ward: 0, wardLevel: 0,
    };
    this.updateCamera();
    this.dom.nova.hidden = false;
    this.dom.dash.hidden = false;
    this.dom.spear.hidden = false;
    this.dom.ward.hidden = false;
    this.dom.joystick.hidden = false;
    this.joystick = null;
    this.dom.joystickKnob.style.transform = 'translate(0, 0)';
    this.updateNovaButton();
    this.updateSkillButtons();
  }

  start(difficultyId) {
    this.reset(difficultyId);
    this.startMusic();
    this.dom.start.hidden = true;
    this.dom.end.hidden = true;
    this.dom.upgrade.hidden = true;
  }

  showDifficulty() {
    this.stopMusic();
    this.state = 'menu';
    this.keys.clear();
    this.pointer = null;
    this.joystick = null;
    this.dom.joystickKnob.style.transform = 'translate(0, 0)';
    this.dom.nova.hidden = true;
    this.dom.dash.hidden = true;
    this.dom.spear.hidden = true;
    this.dom.ward.hidden = true;
    this.dom.joystick.hidden = true;
    this.dom.upgrade.hidden = true;
    this.dom.end.hidden = true;
    this.dom.start.hidden = false;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.player) this.updateCamera();
  }

  updateCamera() {
    this.camera = cameraFromPlayer(this.player, this.width, this.height);
  }

  moveAgainstTerrain(body, dx, dy, radius, canFly = false) {
    // ponytail: axis-only sliding avoids pathfinding; add navigation only for maze-like obstacle layouts.
    if (canFly) {
      body.x += dx;
      body.y += dy;
      return;
    }
    if (!hitsObstacle(body.x + dx, body.y, radius)) body.x += dx;
    if (!hitsObstacle(body.x, body.y + dy, radius)) body.y += dy;
  }

  makeEnemy(stats, position, kind, boss = false) {
    return {
      ...stats, ...position, kind, boss, hit: 0, attack: 0,
      skillTimer: .5 + Math.random() * stats.skillEvery,
      dash: 0, dashAngle: 0, windup: 0, shield: 0, phase: Math.random() * TAU, facing: 4, flipX: false, phaseTwo: false,
    };
  }

  bindInput() {
    window.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'q', 'e', 'r', 'W', 'A', 'S', 'D', 'Q', 'E', 'R'].includes(event.key)) event.preventDefault();
      this.keys.add(event.key.toLowerCase());
      if (event.repeat || this.state !== 'playing') return;
      if (event.key === ' ') this.nova();
      if (event.key.toLowerCase() === 'q') this.dash();
      if (event.key.toLowerCase() === 'e') this.throwSpear();
      if (event.key.toLowerCase() === 'r') this.castWard();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
    const point = event => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const joystickOffset = event => {
      const rect = this.dom.joystick.getBoundingClientRect();
      return { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) };
    };
    const updateJoystick = event => {
      const offset = joystickOffset(event);
      const vector = joystickVector(offset.x, offset.y);
      this.joystick = { id: event.pointerId, ...vector };
      this.dom.joystickKnob.style.transform = `translate(${vector.x * JOYSTICK_MAX}px, ${vector.y * JOYSTICK_MAX}px)`;
    };
    const releaseJoystick = event => {
      if (this.joystick?.id !== event.pointerId) return;
      this.joystick = null;
      this.dom.joystickKnob.style.transform = 'translate(0, 0)';
    };
    this.canvas.addEventListener('pointerdown', event => {
      if (this.state !== 'playing') return;
      if (this.pointer) return;
      event.preventDefault();
      this.pointer = { id: event.pointerId, ...point(event) };
    });
    const movePointer = event => {
      if (this.pointer?.id === event.pointerId) Object.assign(this.pointer, point(event));
      if (this.joystick?.id === event.pointerId) updateJoystick(event);
    };
    const releasePointer = event => {
      if (this.pointer?.id === event.pointerId) this.pointer = null;
      releaseJoystick(event);
    };
    window.addEventListener('pointermove', movePointer);
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    this.dom.joystick.addEventListener('pointerdown', event => {
      if (this.state !== 'playing' || this.joystick) return;
      event.preventDefault();
      updateJoystick(event);
    });
    const bindActionButton = (button, action) => {
      let lastActivation = 0;
      const invoke = event => {
        const now = Date.now();
        if (now - lastActivation < 80) return;
        lastActivation = now;
        event?.preventDefault();
        action();
      };
      button.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        invoke(event);
      });
      button.addEventListener('touchstart', invoke, { passive: false });
      button.addEventListener('click', event => {
        if (Date.now() - lastActivation < 500) { event.preventDefault(); return; }
        invoke(event);
      });
    };
    bindActionButton(this.dom.nova, () => this.nova());
    bindActionButton(this.dom.dash, () => this.dash());
    bindActionButton(this.dom.spear, () => this.throwSpear());
    bindActionButton(this.dom.ward, () => this.castWard());
  }

  spawnEnemy() {
    // ponytail: bound active enemies for mobile; raise the cap only after profiling a denser encounter.
    if (this.enemies.length >= 45) return;
    const difficulty = 1 + this.time * .0085;
    const biome = BIOMES[this.biomeIndex];
    const kind = biome.enemies[Math.floor(Math.random() * biome.enemies.length)];
    this.loadEnemySprite(kind);
    const s = enemyStats(kind, difficulty * this.difficulty.hp, this.difficulty.damage * (1 + this.time * .0015), this.difficulty.speed * (1 + this.time * .00055));
    const margin = s.radius + 72;
    let p;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const side = Math.floor(Math.random() * 4);
      p = side === 0 ? { x: this.camera.x + Math.random() * this.width, y: this.camera.y - margin }
        : side === 1 ? { x: this.camera.x + this.width + margin, y: this.camera.y + Math.random() * this.height }
        : side === 2 ? { x: this.camera.x + Math.random() * this.width, y: this.camera.y + this.height + margin }
        : { x: this.camera.x - margin, y: this.camera.y + Math.random() * this.height };
      if (!hitsObstacle(p.x, p.y, s.radius + 4)) break;
    }
    this.enemies.push(this.makeEnemy(s, p, kind));
  }

  spawnBoss() {
    const kind = BIOMES[this.biomeIndex].boss;
    this.loadEnemySprite(kind);
    this.loadEffectSprite(BOSS_SHOT_ART[kind]?.sprite);
    const s = enemyStats(kind, (1 + this.time * .0055) * this.difficulty.hp, this.difficulty.damage * (1 + this.time * .0015), this.difficulty.speed * (1 + this.time * .00055));
    let x = this.player.x;
    const y = this.player.y - Math.max(this.width, this.height) * .7;
    for (let attempt = 0; attempt < 6 && hitsObstacle(x, y, s.radius + 4); attempt += 1) x += OBSTACLE_TILE * .45;
    this.boss = this.makeEnemy(s, { x, y }, kind, true);
    this.boss.biomeIndex = this.biomeIndex;
    this.enemies.push(this.boss);
    this.bossSpawned = true;
    this.setMusicStage(musicStageFor(this.biomeIndex, this.boss));
    this.rings.push({ x: this.boss.x, y: this.boss.y, radius: 4, max: Math.max(this.width, this.height), life: 1.1, color: '#ed7180' });
  }

  update(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;
    this.stageTime = stageClock(this.stageTime, this.bossSpawned, dt);
    const p = this.player;
    this.biomeNotice = Math.max(0, this.biomeNotice - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt * 4);
    p.hitPulse = Math.max(0, p.hitPulse - dt * 4.5);
    p.nova = Math.max(0, p.nova - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.haste = Math.max(0, p.haste - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.spearCooldown = Math.max(0, p.spearCooldown - dt);
    p.wardCooldown = Math.max(0, p.wardCooldown - dt);
    p.ward = Math.max(0, p.ward - dt);
    p.spikeTimer -= dt;
    p.orbitTimer -= dt;
    p.chainTimer -= dt;
    p.wheelTimer -= dt;
    if (this.pickupNotice) this.pickupNotice.life = Math.max(0, this.pickupNotice.life - dt);
    this.updateNovaButton();
    this.updateSkillButtons();
    this.movePlayer(dt);
    this.updateCamera();
    p.fireTimer -= dt;
    if (p.fireTimer <= 0) {
      this.shoot();
      p.fireTimer += p.fireEvery;
    }
    if (p.spikeTimer <= 0) {
      this.shootSpikes();
      p.spikeTimer += p.spikeEvery;
    }
    if (p.orbitCount && p.orbitTimer <= 0) {
      this.orbitAttack();
      p.orbitTimer += p.orbitEvery;
    }
    if (p.chainLevel && p.chainTimer <= 0) {
      this.chainAttack();
      p.chainTimer += p.chainEvery;
    }
    if (p.wheelLevel && p.wheelTimer <= 0) {
      this.shootWheel();
      p.wheelTimer += p.wheelEvery;
    }
    if (this.state !== 'playing') return;
    if (!this.bossSpawned) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnTimer += spawnInterval(this.time, this.difficulty);
      }
      if (this.stageTime >= BOSS_TIME) this.spawnBoss();
    } else if (this.boss && this.boss.hp > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnTimer += .7 / this.difficulty.spawnRate;
      }
    }
    this.updateBuildings(dt);
    this.updateBullets(dt);
    if (this.state !== 'playing') return;
    this.updateEnemyBullets(dt);
    if (this.state !== 'playing') return;
    this.updateEnemies(dt);
    if (this.state !== 'playing') return;
    this.updateGems(dt);
    if (this.state !== 'playing') return;
    this.updatePickups(dt);
    this.updateEffects(dt);
    this.shake = Math.max(0, this.shake - dt * 20);
  }

  movePlayer(dt) {
    const p = this.player;
    if (p.dashTime > 0) {
      const dashSpeed = 720 + p.dashLevel * 35;
      this.moveAgainstTerrain(p, Math.cos(p.dashAngle) * dashSpeed * dt, Math.sin(p.dashAngle) * dashSpeed * dt, p.r);
      return;
    }
    let dx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    let dy = (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0);
    if (this.joystick) {
      dx = this.joystick.x;
      dy = this.joystick.y;
    } else if (this.pointer) {
      dx += this.pointer.x - this.width / 2;
      dy += this.pointer.y - this.height / 2;
    }
    const length = Math.hypot(dx, dy);
    if (length > (this.joystick ? .08 : .5)) {
      const speed = p.speed * (p.slow > 0 ? .65 : 1) * (p.haste > 0 ? 1.3 : 1);
      const pace = this.joystick ? speed * dt * Math.min(1, length) : Math.min(speed * dt, this.pointer ? length : speed * dt);
      this.moveAgainstTerrain(p, dx / length * pace, dy / length * pace, p.r);
      p.facing = directionFrame(dx, dy);
    }
  }

  dash() {
    const p = this.player;
    if (this.state !== 'playing' || p.dashCooldown > 0) return;
    p.dashCooldown = activeSkillCooldown(p, 'dash');
    p.dashTime = .18 + p.dashLevel * .022;
    p.dashAngle = facingAngle(p.facing);
    p.invuln = Math.max(p.invuln, .28 + p.dashLevel * .02);
    this.rings.push({ x: p.x, y: p.y, radius: 8, max: 76, life: .26, color: '#9be6d1' });
    this.particles.push(...Array.from({ length: 12 }, () => ({ x: p.x, y: p.y, vx: (Math.random() - .5) * 240, vy: (Math.random() - .5) * 240, life: .28, max: .28, color: '#a6ead7', size: 2 }))); 
  }

  throwSpear() {
    const p = this.player;
    if (this.state !== 'playing' || p.spearCooldown > 0 || this.bullets.length >= 72) return;
    const angle = facingAngle(p.facing);
    p.spearCooldown = activeSkillCooldown(p, 'spear');
    this.bullets.push({ kind: 'hurricane', stage: p.growthStage, x: p.x, y: p.y, vx: Math.cos(angle) * HURRICANE_SPEED, vy: Math.sin(angle) * HURRICANE_SPEED, r: 13 + p.spearLevel, damage: Math.round(p.damage * (2.35 + p.spearLevel * .18) + 10), pierce: 5 + p.spearLevel, life: .85 + p.spearLevel * .04, trail: [], hits: new Set() });
    this.rings.push({ x: p.x, y: p.y, radius: 5, max: 46, life: .2, color: ACTIVE_SKILLS.spear.color });
  }

  castWard() {
    const p = this.player;
    if (this.state !== 'playing' || p.wardCooldown > 0) return;
    p.wardCooldown = activeSkillCooldown(p, 'ward');
    p.ward = 3.2 + p.wardLevel * .32;
    const wardRadius = 125 + p.wardLevel * 12;
    this.enemyBullets = this.enemyBullets.filter(bullet => {
      if (Math.hypot(bullet.x - p.x, bullet.y - p.y) > wardRadius) return true;
      this.particles.push({ x: bullet.x, y: bullet.y, vx: 0, vy: 0, life: .2, max: .2, color: '#aabdf5', size: 4 });
      return false;
    });
    this.rings.push({ x: p.x, y: p.y, radius: 10, max: wardRadius, life: .55, color: '#aabdf5' });
  }

  shoot() {
    const p = this.player;
    const target = this.findAttackTarget();
    if (!target) return;
    const form = growthForm(p.growthStage);
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const spread = p.projectiles === 1 ? 0 : .2;
    // ponytail: cap player projectiles for mobile; use pooling only if this cap proves limiting.
    for (let i = 0; i < p.projectiles && this.bullets.length < 72; i += 1) {
      const angle = base + (i - (p.projectiles - 1) / 2) * spread;
      this.bullets.push({ kind: form.kind, stage: p.growthStage, x: p.x, y: p.y, vx: Math.cos(angle) * form.speed, vy: Math.sin(angle) * form.speed, r: form.radius, damage: p.damage, pierce: p.pierce, life: 1.2, trail: [], hits: new Set() });
    }
    this.particles.push(...Array.from({ length: 3 }, () => ({ x: p.x, y: p.y, vx: (Math.random() - .5) * 55, vy: (Math.random() - .5) * 55, life: .22, max: .22, color: form.color, size: 2 })));
  }

  findAttackTarget(source = this.player, range = Infinity, excluded = new Set()) {
    let target = null;
    let closest = range;
    for (const candidate of [...this.enemies, ...this.buildings]) {
      if (candidate.dead || excluded.has(candidate)) continue;
      const distance = Math.hypot(candidate.x - source.x, candidate.y - source.y);
      if (distance < closest) { closest = distance; target = candidate; }
    }
    return target;
  }

  damageTarget(target, amount) {
    if (target.isBuilding) this.damageBuilding(target, amount);
    else this.damageEnemy(target, amount);
  }

  shootSpikes() {
    const p = this.player;
    const form = growthForm(p.growthStage);
    for (const angle of fanAngles(facingAngle(p.facing), p.spikeCount, .23)) {
      if (this.bullets.length >= 72) break;
      this.bullets.push({ kind: 'spike', stage: p.growthStage, x: p.x, y: p.y, vx: Math.cos(angle) * (315 + p.growthStage * 18), vy: Math.sin(angle) * (315 + p.growthStage * 18), r: 6 + p.growthStage * .35, damage: p.spikeDamage, pierce: 0, life: .48, trail: [], hits: new Set() });
    }
    this.particles.push(...Array.from({ length: 5 }, () => ({ x: p.x, y: p.y, vx: (Math.random() - .5) * 95, vy: (Math.random() - .5) * 95, life: .2, max: .2, color: form.color, size: 2 })));
  }

  orbitPoint(index) {
    const p = this.player;
    const angle = this.time * 3.6 + index / p.orbitCount * TAU;
    return { x: p.x + Math.cos(angle) * 74, y: p.y + Math.sin(angle) * 74, angle };
  }

  orbitAttack() {
    const p = this.player;
    let struck = false;
    for (let index = 0; index < p.orbitCount; index += 1) {
      const point = this.orbitPoint(index);
      for (const enemy of this.enemies) {
        if (!enemy.dead && Math.hypot(enemy.x - point.x, enemy.y - point.y) < enemy.radius + 9) {
          this.damageEnemy(enemy, p.orbitDamage);
          if (this.state !== 'playing') return;
          struck = true;
        }
      }
      for (const building of this.buildings) {
        if (!building.dead && Math.hypot(building.x - point.x, building.y - point.y) < building.r + 9) {
          this.damageBuilding(building, p.orbitDamage);
          struck = true;
        }
      }
    }
    if (struck) this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: .16, max: .16, color: growthForm(p.growthStage).color, size: 5 });
  }

  shootWheel() {
    const p = this.player;
    if (this.bullets.length >= 72 || !this.findAttackTarget()) return;
    const angle = facingAngle(p.facing);
    const speed = 275 + p.growthStage * 20;
    this.bullets.push({ kind: 'wheel', stage: p.growthStage, x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 10, damage: p.wheelDamage, pierce: 1 + p.wheelLevel, life: 1.05, trail: [], hits: new Set(), spin: Math.random() * TAU });
  }

  chainAttack() {
    const p = this.player;
    let source = { x: p.x, y: p.y };
    const struck = new Set();
    for (let jump = 0; jump <= p.chainLevel; jump += 1) {
      const target = this.findAttackTarget(source, jump ? 145 : 300, struck);
      if (!target) break;
      this.damageTarget(target, p.chainDamage);
      if (this.state !== 'playing') return;
      this.zaps.push({ x1: source.x, y1: source.y, x2: target.x, y2: target.y, life: .14, max: .14, color: growthForm(p.growthStage).color });
      struck.add(target);
      source = target;
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const b = this.bullets[i];
      b.life -= dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 4) b.trail.shift();
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let removed = b.life <= 0;
      for (const e of this.enemies) {
        if (e.dead || b.hits.has(e) || Math.hypot(e.x - b.x, e.y - b.y) > e.radius + b.r) continue;
        this.damageEnemy(e, b.damage);
        if (this.state !== 'playing') return;
        const push = b.kind === 'hurricane' && !e.dead ? hurricaneKnockback(b.vx, b.vy, e.boss) : null;
        if (push) this.moveAgainstTerrain(e, push.x, push.y, e.radius, e.canFly);
        b.hits.add(e);
        if (b.pierce > 0) b.pierce -= 1;
        else removed = true;
        break;
      }
      if (!removed) for (const building of this.buildings) {
        if (building.dead || b.hits.has(building) || Math.hypot(building.x - b.x, building.y - b.y) > building.r + b.r) continue;
        this.damageBuilding(building, b.damage);
        b.hits.add(building);
        if (b.pierce > 0) b.pierce -= 1;
        else removed = true;
        break;
      }
      if (removed) this.bullets.splice(i, 1);
    }
  }

  damageEnemy(enemy, amount) {
    const damage = enemy.shield > 0 ? Math.max(1, Math.round(amount * .52)) : amount;
    enemy.hp -= damage;
    const vampireHealed = applyVampireHeal(this.player, this.player.vampireLevel);
    if (vampireHealed > 0) this.particles.push({ x: this.player.x, y: this.player.y - 22, vx: 0, vy: -18, life: .22, max: .22, color: '#f09ab3', size: 2.5 });
    enemy.hit = .15;
    this.particles.push(...Array.from({ length: enemy.boss ? 6 : 3 }, () => ({ x: enemy.x, y: enemy.y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, life: .28, max: .28, color: enemy.shield > 0 ? '#d8eaa2' : enemy.color, size: 2 + Math.random() * 2 })));
    if (enemy.hp <= 0 && !enemy.dead) this.killEnemy(enemy);
  }

  updateBuildings(dt) {
    for (const building of this.buildings) building.hit = Math.max(0, building.hit - dt * 4);
    if (this.buildings.length >= RELIC_MAX_ACTIVE) return;
    this.relicTimer -= dt;
    if (this.relicTimer > 0) return;
    this.relicTimer = RELIC_RESPAWN_INTERVAL + Math.random() * 2;
    this.spawnRelicBuilding();
  }

  spawnRelicBuilding() {
    const levels = RELIC_BUILDING_SITES.map(site => this.player[`${site.skill}Level`] || 0);
    const lowestLevel = Math.min(...levels);
    const sites = RELIC_BUILDING_SITES.filter(site => (this.player[`${site.skill}Level`] || 0) === lowestLevel && lowestLevel < ACTIVE_SKILL_MAX_LEVEL);
    if (!sites.length) return;
    const site = sites[Math.floor(Math.random() * sites.length)];
    const minDistance = Math.max(220, Math.min(340, Math.max(this.width, this.height) * .48));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = Math.random() * TAU;
      const distance = minDistance + Math.random() * 110;
      const x = this.player.x + Math.cos(angle) * distance;
      const y = this.player.y + Math.sin(angle) * distance;
      if (hitsObstacle(x, y, site.r + 6) || this.buildings.some(building => Math.hypot(building.x - x, building.y - y) < building.r + site.r + 52)) continue;
      this.buildings.push(makeRelicBuilding(site, x, y, BIOMES[this.biomeIndex].terrain));
      this.rings.push({ x, y, radius: 4, max: 36, life: .35, color: ACTIVE_SKILLS[site.skill].color });
      return;
    }
  }

  damageBuilding(building, amount) {
    if (building.dead) return;
    building.hp -= amount;
    building.hit = .18;
    const skill = ACTIVE_SKILLS[building.skill];
    this.particles.push(...Array.from({ length: 3 }, () => ({ x: building.x, y: building.y, vx: (Math.random() - .5) * 110, vy: (Math.random() - .5) * 110, life: .24, max: .24, color: skill.color, size: 2 })));
    if (building.hp > 0) return;
    building.dead = true;
    const levelKey = `${building.skill}Level`;
    this.player[levelKey] = Math.min(ACTIVE_SKILL_MAX_LEVEL, this.player[levelKey] + 1);
    this.buildings = this.buildings.filter(candidate => candidate !== building);
    this.pickupNotice = { text: `${skill.label} 强化 · ${skill.upgrade}`, color: skill.color, life: 2.4 };
    this.rings.push({ x: building.x, y: building.y, radius: 8, max: 82, life: .48, color: skill.color });
    this.particles.push(...Array.from({ length: 18 }, () => ({ x: building.x, y: building.y, vx: (Math.random() - .5) * 220, vy: (Math.random() - .5) * 220, life: .35 + Math.random() * .18, max: .53, color: skill.color, size: 2 + Math.random() * 2 })));
    this.updateSkillButtons();
  }

  hurtPlayer(amount, slow = 0) {
    const p = this.player;
    if (this.state !== 'playing' || p.invuln > 0) return false;
    p.hp -= Math.max(1, Math.round(amount * (p.ward > 0 ? Math.max(.24, .42 - p.wardLevel * .018) : 1)));
    p.invuln = p.hitInvuln;
    p.flash = 1;
    p.hitPulse = 1;
    p.slow = Math.max(p.slow, slow);
    this.shake = Math.max(this.shake, 4);
    this.rings.push({ x: p.x, y: p.y, radius: 5, max: 72, life: .36, color: '#ff597a' });
    this.particles.push(...Array.from({ length: 6 }, () => ({ x: p.x + (Math.random() - .5) * 14, y: p.y + (Math.random() - .5) * 14, vx: (Math.random() - .5) * 74, vy: (Math.random() - .5) * 74, life: .22, max: .22, color: '#ff8d97', size: 2 })));
    if (p.hp <= 0) this.finish(false);
    return true;
  }

  killEnemy(enemy) {
    enemy.dead = true;
    this.score += enemyScore(enemy, this.difficulty);
    this.kills += 1;
    if (enemy.boss) {
      this.particles.push(...Array.from({ length: 45 }, () => ({ x: enemy.x, y: enemy.y, vx: (Math.random() - .5) * 360, vy: (Math.random() - .5) * 360, life: .65 + Math.random() * .4, max: 1, color: Math.random() > .5 ? '#ffd37a' : '#ff749a', size: 2 + Math.random() * 4 })));
      const nextBiome = nextBiomeAfterBoss(enemy.biomeIndex ?? this.biomeIndex);
      if (nextBiome === null) {
        this.finish(true);
        return;
      }
      this.boss = null;
      this.bossSpawned = false;
      this.stageTime = 0;
      this.biomeIndex = nextBiome;
      this.loadBiomeSprites(this.biomeIndex);
      this.biomeNotice = 3.4;
      this.spawnTimer = .7 / this.difficulty.spawnRate;
      this.enemyBullets = [];
      this.buildings = makeRelicBuildings(BIOMES[this.biomeIndex].terrain);
      this.relicTimer = 4;
      this.setMusicStage(musicStageFor(this.biomeIndex));
      this.rings.push({ x: this.player.x, y: this.player.y, radius: 10, max: 180, life: .75, color: BIOMES[this.biomeIndex].accent });
      return;
    }
    const drops = Math.max(1, Math.ceil(enemy.xp / 2));
    for (let i = 0; i < drops; i += 1) this.gems.push({ x: enemy.x + (Math.random() - .5) * 12, y: enemy.y + (Math.random() - .5) * 12, r: 5, value: XP_PER_GEM, t: Math.random() * 3 });
    if (this.kills % this.difficulty.pickupEvery === 0) {
      const kinds = Object.keys(PICKUPS);
      const kind = kinds.filter(kindName => kindName !== 'vampire')[pickupIndex(this.kills, this.difficulty.pickupEvery, kinds.length - 1)];
      this.pickups.push({ kind, x: enemy.x, y: enemy.y, r: 10, t: 0 });
    }
    if (Math.random() < VAMPIRE_RUNE_CHANCE) this.pickups.push({ kind: 'vampire', x: enemy.x + (Math.random() - .5) * 18, y: enemy.y + (Math.random() - .5) * 18, r: 11, t: 0 });
  }

  fireEnemyShots(enemy, dx, dy) {
    const style = ENEMY_SHOT_STYLES[enemy.shotKind];
    const bossArt = bossShotArt(enemy);
    if (bossArt) this.loadEffectSprite(bossArt.sprite);
    const count = enemy.shots || (enemy.skill === 'fan' ? 3 : 1);
    const base = Math.atan2(dy, dx);
    const spread = count > 1 ? enemy.shotSpread ?? .28 : 0;
    for (const angle of fanAngles(base, count, spread)) {
      // ponytail: bound hostile projectiles; switch to pooling only if this cap is intentionally raised.
      if (this.enemyBullets.length >= 36) break;
      this.enemyBullets.push({
        kind: enemy.shotKind, x: enemy.x, y: enemy.y, vx: Math.cos(angle) * enemy.shotSpeed, vy: Math.sin(angle) * enemy.shotSpeed,
        r: enemy.shotKind === 'fire' ? 7 : 5, damage: enemy.damage * (enemy.shotKind === 'fire' ? .82 : .68), slow: style.slow, life: 2.35,
        bossArt: bossArt?.id || null, bossSprite: bossArt?.sprite || null,
      });
    }
    this.particles.push({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: .18, max: .18, color: style.color, size: 5 });
  }

  fireRootZone(enemy, dx, dy, distance) {
    if (this.enemyBullets.length >= 36) return;
    const range = Math.min(72, Math.max(40, distance - 24));
    const bossArt = bossShotArt(enemy);
    if (!bossArt) this.loadEffectSprite('venom');
    this.enemyBullets.push({ kind: 'root', x: enemy.x + dx / distance * range, y: enemy.y + dy / distance * range, vx: 0, vy: 0, r: 20, damage: enemy.damage * .58, slow: 1.65, life: 2.2, zone: true, bossArt: bossArt?.id || null, bossSprite: bossArt?.sprite || null });
    this.rings.push({ x: enemy.x + dx / distance * range, y: enemy.y + dy / distance * range, radius: 6, max: 34, life: .35, color: '#a8d86b' });
  }

  castEnemySkill(enemy, dx, dy, distance) {
    if (enemy.skill === 'melee') {
      enemy.skillTimer = enemy.skillEvery;
      return;
    }
    if (enemy.skill === 'shell' || enemy.skill === 'guard') {
      enemy.shield = enemy.skill === 'guard' ? .95 : 1.35;
      enemy.skillTimer = enemy.skillEvery;
      this.rings.push({ x: enemy.x, y: enemy.y, radius: enemy.radius, max: enemy.radius * 1.8, life: .42, color: enemy.skill === 'guard' ? '#b9d4eb' : '#cbe98b' });
      return;
    }
    if (distance > enemy.skillRange) return;
    if (enemy.skill === 'dash') {
      enemy.dash = .62;
      enemy.windup = .28;
      enemy.dashAngle = Math.atan2(dy, dx);
      enemy.skillTimer = enemy.skillEvery;
      this.rings.push({ x: enemy.x, y: enemy.y, radius: enemy.radius, max: 54, life: .24, color: enemy.color });
      return;
    }
    if (enemy.skill === 'tide') {
      this.fireEnemyShots(enemy, dx, dy);
      enemy.skillTimer = enemy.skillEvery;
      return;
    }
    if (enemy.skill === 'grove') {
      this.fireEnemyShots(enemy, dx, dy);
      this.fireRootZone(enemy, dx, dy, distance);
      enemy.skillTimer = enemy.skillEvery;
      return;
    }
    if (enemy.skill === 'root') {
      this.fireRootZone(enemy, dx, dy, distance);
      enemy.skillTimer = enemy.skillEvery;
      return;
    }
    if (enemy.skill === 'pulse') {
      const radius = enemy.skillRadius || enemy.radius * 4;
      enemy.skillTimer = enemy.skillEvery;
      this.rings.push({ x: enemy.x, y: enemy.y, radius: 7, max: radius, life: .45, color: enemy.color });
      if (distance < radius) this.hurtPlayer(enemy.damage * (enemy.skillPower || 1));
      if (enemy.boss) this.fireEnemyShots(enemy, dx, dy);
      if (enemy.boss) this.shake = Math.max(this.shake, 6);
      return;
    }
    this.fireEnemyShots(enemy, dx, dy);
    enemy.skillTimer = enemy.skillEvery;
  }

  updateEnemyBullets(dt) {
    const p = this.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.enemyBullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      let removed = bullet.life <= 0 || (!bullet.zone && hitsObstacle(bullet.x, bullet.y, bullet.r));
      if (!removed && Math.hypot(p.x - bullet.x, p.y - bullet.y) < p.r + bullet.r) {
        this.hurtPlayer(bullet.damage, bullet.slow);
        if (this.state !== 'playing') return;
        this.rings.push({ x: bullet.x, y: bullet.y, radius: 4, max: 34, life: .22, color: ENEMY_SHOT_STYLES[bullet.kind].color });
        removed = !bullet.zone;
      }
      if (removed) this.enemyBullets.splice(i, 1);
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      e.hit = Math.max(0, e.hit - dt * 4);
      e.attack = Math.max(0, e.attack - dt);
      e.skillTimer -= dt;
      e.dash = Math.max(0, e.dash - dt);
      e.windup = Math.max(0, e.windup - dt);
      e.shield = Math.max(0, e.shield - dt);
      if (e.boss && !e.phaseTwo && e.hp <= e.maxHp * .5) {
        e.phaseTwo = true;
        e.skillEvery = 3;
        e.skillTimer = Math.min(e.skillTimer, .55);
        this.setMusicStage(musicStageFor(this.biomeIndex, e));
        this.rings.push({ x: e.x, y: e.y, radius: e.radius, max: e.radius * 3.2, life: .75, color: '#ffbd68' });
      }
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (e.skillTimer <= 0) this.castEnemySkill(e, dx, dy, distance);
      const dashing = e.dash > 0 && e.windup <= 0;
      const speed = e.speed * (dashing ? 2.75 : e.windup > 0 ? .24 : 1);
      const lateral = e.canFly && !dashing ? Math.sin(this.time * 4.5 + e.phase) * e.speed * .34 : 0;
      const moveX = dashing ? Math.cos(e.dashAngle) * speed * dt : dx / distance * speed * dt - dy / distance * lateral * dt;
      const moveY = dashing ? Math.sin(e.dashAngle) * speed * dt : dy / distance * speed * dt + dx / distance * lateral * dt;
      e.facing = directionFrame(dx, dy);
      e.flipX = mirrorFacing(e.facing);
      this.moveAgainstTerrain(e, moveX, moveY, e.radius, e.canFly);
      if (distance < p.r + e.radius && e.attack <= 0) {
        this.hurtPlayer(e.damage);
        if (this.state !== 'playing') return;
        e.attack = .75;
      }
    }
  }

  updateGems(dt) {
    const p = this.player;
    for (let i = this.gems.length - 1; i >= 0; i -= 1) {
      const gem = this.gems[i];
      gem.t += dt * 6;
      const dx = p.x - gem.x;
      const dy = p.y - gem.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (gem.vacuum) gem.vacuum = Math.max(0, gem.vacuum - dt);
      if (gem.vacuum || distance < p.magnet) {
        const pull = gem.vacuum ? Math.max(900, distance * 5) : 150 + (p.magnet - distance) * 5;
        gem.x += dx / distance * pull * dt;
        gem.y += dy / distance * pull * dt;
      }
      if (distance < p.r + gem.r + 5) {
        this.gainXp(gem.value);
        this.gems.splice(i, 1);
        if (this.state !== 'playing') break;
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const item = this.pickups[i];
      item.t += dt * 4;
      const dx = p.x - item.x;
      const dy = p.y - item.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < p.magnet * .82) {
        const pull = 120 + (p.magnet - distance) * 4;
        item.x += dx / distance * pull * dt;
        item.y += dy / distance * pull * dt;
      }
      if (distance < p.r + item.r + 6) {
        this.collectPickup(item);
        this.pickups.splice(i, 1);
      }
    }
  }

  collectPickup(item) {
    const reward = applyPickup(this.player, item.kind);
    if (reward.vacuum) for (const gem of this.gems) gem.vacuum = Infinity;
    this.pickupNotice = { ...reward, life: 1.6 };
    this.rings.push({ x: this.player.x, y: this.player.y, radius: 6, max: 86, life: .42, color: reward.color });
    this.particles.push(...Array.from({ length: 14 }, () => ({ x: item.x, y: item.y, vx: (Math.random() - .5) * 190, vy: (Math.random() - .5) * 190, life: .35, max: .35, color: reward.color, size: 2 + Math.random() * 2 })));
    this.updateNovaButton();
  }

  gainXp(amount) {
    this.xp += amount;
    if (this.xp >= this.nextXp) {
      this.xp -= this.nextXp;
      this.level += 1;
      this.nextXp = Math.ceil(this.nextXp * 1.38 + 2);
      this.levelUp();
    }
  }

  levelUp() {
    if (this.state !== 'playing') return;
    healOnLevel(this.player);
    this.state = 'upgrade';
    const options = chooseUnique(UPGRADES.filter(option => !option.requires || option.requires(this.player)), 3);
    this.dom.choices.replaceChildren(...options.map(option => {
      const button = document.createElement('button');
      button.className = 'choice';
      button.innerHTML = `<strong>${option.icon}　${option.name}</strong><span>${option.text}</span>`;
      button.addEventListener('click', () => {
        option.apply(this.player);
        this.dom.upgrade.hidden = true;
        this.state = 'playing';
      }, { once: true });
      return button;
    }));
    this.dom.upgrade.hidden = false;
  }

  nova() {
    if (this.state !== 'playing' || this.player.nova > 0) return;
    const p = this.player;
    const form = growthForm(p.growthStage);
    p.nova = p.novaMax;
    this.rings.push({ x: p.x, y: p.y, radius: 7, max: Math.max(this.width, this.height) * .68, life: .65, color: form.color, stage: p.growthStage });
    this.shake = 7;
    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.x - p.x, enemy.y - p.y);
      if (distance < 240 + p.growthStage * 18) this.damageEnemy(enemy, 36 + this.player.damage * .6 + p.growthStage * 8);
    }
    for (const building of this.buildings) {
      const distance = Math.hypot(building.x - p.x, building.y - p.y);
      if (distance < 240 + p.growthStage * 18) this.damageBuilding(building, 36 + this.player.damage * .6 + p.growthStage * 8);
    }
    this.particles.push(...Array.from({ length: 32 }, () => ({ x: p.x, y: p.y, vx: (Math.random() - .5) * 430, vy: (Math.random() - .5) * 430, life: .4 + Math.random() * .3, max: .7, color: form.color, size: 2 + Math.random() * 3 })));
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= .95;
      p.vy *= .95;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      ring.life -= dt;
      ring.radius += ring.max * dt * 1.55;
      if (ring.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.zaps.length - 1; i >= 0; i -= 1) {
      this.zaps[i].life -= dt;
      if (this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }
  }

  finish(victory) {
    if (this.state === 'ended') return;
    this.stopMusic();
    this.state = 'ended';
    this.dom.nova.hidden = true;
    this.dom.dash.hidden = true;
    this.dom.spear.hidden = true;
    this.dom.ward.hidden = true;
    this.dom.joystick.hidden = true;
    this.joystick = null;
    this.dom.joystickKnob.style.transform = 'translate(0, 0)';
    this.dom.endKicker.textContent = victory ? 'EVOLUTION COMPLETE' : 'EVOLUTION INTERRUPTED';
    this.dom.endTitle.textContent = victory ? '文明火种得以延续' : '火种熄灭';
    this.dom.endSummary.textContent = victory
      ? `你在 ${Math.ceil(this.time)} 秒内穿越三种生态，击败 ${this.kills} 个敌对生物，回收 ${this.score} 份基因样本。`
      : `你坚持了 ${Math.ceil(this.time)} 秒，击败 ${this.kills} 个敌对生物，回收 ${this.score} 份基因样本。`;
    this.dom.finalScore.textContent = String(this.score);
    try { this.dom.playerName.value = leaderboardStorage()?.getItem('civilization-fire-player-name') || ''; } catch { this.dom.playerName.value = ''; }
    this.dom.scoreStatus.textContent = '输入名字后保存本轮成绩';
    this.dom.scoreForm.querySelector('button').disabled = false;
    this.renderLeaderboard();
    this.dom.end.hidden = false;
  }

  renderLeaderboard() {
    const rows = readLeaderboard();
    this.dom.leaderboard.replaceChildren(...rows.map((row, index) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${index + 1}. ${row.name}`;
      const score = document.createElement('strong');
      score.textContent = `${row.score} 分 · ${row.difficulty}`;
      item.append(name, score);
      return item;
    }));
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = '还没有历史成绩';
      this.dom.leaderboard.append(empty);
    }
  }

  submitScore(name) {
    if (this.scoreSubmitted) return;
    const playerName = normalizePlayerName(name);
    saveLeaderboardEntry(playerName, this.score, this.difficulty.short, this.time);
    try { leaderboardStorage()?.setItem('civilization-fire-player-name', playerName); } catch { /* private mode: score still appears this session */ }
    this.dom.playerName.value = playerName;
    this.dom.scoreStatus.textContent = '本轮成绩已加入榜单';
    this.scoreSubmitted = true;
    this.dom.scoreForm.querySelector('button').disabled = true;
    this.renderLeaderboard();
  }

  updateNovaButton() {
    const ready = this.player.nova <= 0;
    this.dom.nova.dataset.ready = String(ready);
    this.dom.nova.innerHTML = ready ? '脉冲<small>就绪</small>' : `脉冲<small>${this.player.nova.toFixed(1)}s</small>`;
  }

  updateSkillButtons() {
    for (const [id, skill] of Object.entries(ACTIVE_SKILLS)) {
      const cooldown = this.player[`${id}Cooldown`];
      const ready = cooldown <= 0;
      const button = this.dom[id];
      const level = this.player[`${id}Level`] || 0;
      const name = level ? `${skill.label}+${level}` : skill.label;
      button.dataset.ready = String(ready);
      button.innerHTML = ready ? `${name}<small>${skill.key} · 就绪</small>` : `${name}<small>${cooldown.toFixed(1)}s</small>`;
    }
  }

  frame(time) {
    const dt = Math.min(.033, (time - this.lastFrame) / 1000 || 0);
    this.lastFrame = time;
    this.update(dt);
    this.draw();
    requestAnimationFrame(next => this.frame(next));
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const biome = BIOMES[this.biomeIndex || 0];
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, biome.colors[0]);
    gradient.addColorStop(.55, biome.colors[1]);
    gradient.addColorStop(1, biome.colors[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawBackground(ctx, biome);
    if (!this.player) return;
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);
    this.drawObstacles(ctx, biome);
    ctx.restore();
    const sx = this.shake ? (Math.random() - .5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - .5) * this.shake : 0;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.translate(-this.camera.x, -this.camera.y);
    this.drawBuildings(ctx);
    this.drawPickups(ctx);
    this.drawGems(ctx);
    this.drawBullets(ctx);
    this.drawEnemyBullets(ctx);
    this.drawEnemies(ctx);
    this.drawEffects(ctx);
    ctx.restore();
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);
    this.drawOrbit(ctx);
    this.drawPlayer(ctx);
    ctx.restore();
    this.drawHud(ctx);
    this.drawBossBar(ctx);
    this.drawBossArrow(ctx);
    this.drawPickupNotice(ctx);
    this.drawBiomeBanner(ctx);
  }

  drawBackground(ctx, biome) {
    const camera = this.camera;
    // ponytail: integer world tiles avoid floating-index flicker; cache terrain only if art becomes substantially heavier.
    const tile = 112;
    const xTiles = tileRange(camera.x, this.width, tile);
    const yTiles = tileRange(camera.y, this.height, tile);
    for (let worldY = yTiles.start; worldY <= yTiles.end; worldY += 1) {
      const y = worldY * tile - camera.y;
      for (let worldX = xTiles.start; worldX <= xTiles.end; worldX += 1) {
        const x = worldX * tile - camera.x;
        const noise = tileNoise(worldX, worldY);
        const twist = tileNoise(worldX + 31, worldY - 17);
        ctx.save();
        ctx.translate(x, y);
        if (biome.terrain === 'shore') {
          const poolX = 20 + twist * 58;
          const poolY = 28 + noise * 44;
          ctx.globalAlpha = .28;
          ctx.fillStyle = '#5f8986';
          ctx.beginPath();
          for (let i = 0; i < 7; i += 1) {
            const angle = i / 7 * TAU + twist;
            const radius = 11 + noise * 15 + (i % 2 ? 5 : 0);
            i ? ctx.lineTo(poolX + Math.cos(angle) * radius, poolY + Math.sin(angle) * radius * .65) : ctx.moveTo(poolX + Math.cos(angle) * radius, poolY + Math.sin(angle) * radius * .65);
          }
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = .42;
          ctx.strokeStyle = '#dde0b9'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(8, 18 + twist * 18); ctx.bezierCurveTo(27, 10 + noise * 22, 43, 31 + twist * 19, 64, 20 + noise * 23); ctx.stroke();
          if (noise < .28) {
            ctx.fillStyle = '#80634a';
            ctx.beginPath(); ctx.arc(80, 36 + twist * 30, 4, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(89, 42 + twist * 22, 3, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(96, 35 + twist * 28, 5, 0, TAU); ctx.fill();
          }
        } else if (biome.terrain === 'forest') {
          const trunkX = 28 + twist * 53;
          ctx.globalAlpha = .42;
          ctx.fillStyle = '#4e3b29'; ctx.fillRect(trunkX, 18 + noise * 15, 11, 54);
          ctx.fillStyle = '#36503a';
          ctx.beginPath(); ctx.arc(trunkX + 4, 25, 22 + noise * 9, 0, TAU); ctx.fill();
          ctx.fillStyle = '#718653';
          ctx.beginPath(); ctx.arc(trunkX - 11, 36, 13 + twist * 8, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(trunkX + 18, 43, 15 + noise * 8, 0, TAU); ctx.fill();
          ctx.globalAlpha = .38;
          ctx.strokeStyle = '#3f5734'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(4, 7 + twist * 20); ctx.bezierCurveTo(31, 29, 36, 64, 71, 88); ctx.stroke();
          if (noise > .58) {
            ctx.fillStyle = '#a7bf70';
            ctx.beginPath(); ctx.ellipse(83, 70, 7, 17, twist * TAU, 0, TAU); ctx.fill();
          }
        } else {
          ctx.globalAlpha = .34;
          ctx.fillStyle = noise > .52 ? '#7e5d50' : '#35262c';
          ctx.beginPath();
          for (let i = 0; i < 5; i += 1) {
            const angle = i / 5 * TAU + twist;
            const radius = 14 + noise * 13 + (i % 2 ? 5 : 0);
            i ? ctx.lineTo(52 + Math.cos(angle) * radius, 52 + Math.sin(angle) * radius) : ctx.moveTo(52 + Math.cos(angle) * radius, 52 + Math.sin(angle) * radius);
          }
          ctx.closePath(); ctx.fill();
          if (noise > .57) {
            ctx.globalAlpha = .58;
            ctx.strokeStyle = '#e98247'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(25 + twist * 27, 38); ctx.lineTo(48 + noise * 24, 52); ctx.lineTo(40 + twist * 33, 74); ctx.stroke();
          } else if (noise < .2) {
            ctx.globalAlpha = .52;
            ctx.fillStyle = '#c18c73';
            ctx.fillRect(80, 19 + twist * 31, 5, 5);
            ctx.fillRect(89, 38 + noise * 26, 4, 4);
          }
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawObstacles(ctx, biome) {
    const xTiles = tileRange(this.camera.x, this.width, OBSTACLE_TILE);
    const yTiles = tileRange(this.camera.y, this.height, OBSTACLE_TILE);
    for (let tileY = yTiles.start; tileY <= yTiles.end; tileY += 1) {
      for (let tileX = xTiles.start; tileX <= xTiles.end; tileX += 1) {
        const obstacle = obstacleAt(tileX, tileY);
        if (!obstacle) continue;
        ctx.save();
        ctx.translate(obstacle.x, obstacle.y);
        ctx.fillStyle = 'rgba(15, 23, 18, .25)';
        ctx.beginPath(); ctx.ellipse(0, obstacle.r * .72, obstacle.r * 1.18, obstacle.r * .42, 0, 0, TAU); ctx.fill();
        const art = OBSTACLE_ART[biome.terrain];
        const sprite = this.obstacleSprites[biome.terrain];
        if (sprite?.ready) {
          const height = obstacle.r * art.height;
          const width = height * sprite.image.width / sprite.image.height;
          ctx.globalAlpha = .94;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite.image, -width / 2, obstacle.r * art.floor - height, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.restore();
          continue;
        }
        ctx.shadowColor = 'rgba(0, 0, 0, .48)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
        if (biome.terrain === 'shore') {
          ctx.fillStyle = '#35444a';
          ctx.beginPath(); ctx.arc(0, 0, obstacle.r, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#c2d0af'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#829592';
          ctx.beginPath(); ctx.arc(-obstacle.r * .25, -obstacle.r * .28, obstacle.r * .44, 0, TAU); ctx.fill();
          ctx.fillStyle = '#9eb273';
          ctx.beginPath(); ctx.arc(obstacle.r * .42, obstacle.r * .06, obstacle.r * .22, 0, TAU); ctx.fill();
        } else if (biome.terrain === 'forest') {
          ctx.fillStyle = '#382014'; ctx.fillRect(-obstacle.r * .38, -obstacle.r * 1.2, obstacle.r * .76, obstacle.r * 1.72);
          ctx.strokeStyle = '#a98b57'; ctx.lineWidth = 2; ctx.strokeRect(-obstacle.r * .38, -obstacle.r * 1.2, obstacle.r * .76, obstacle.r * 1.72);
          ctx.strokeStyle = '#60401e'; ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(-obstacle.r * .2, obstacle.r * .22); ctx.lineTo(-obstacle.r, obstacle.r * .78); ctx.moveTo(obstacle.r * .2, obstacle.r * .22); ctx.lineTo(obstacle.r, obstacle.r * .78); ctx.stroke();
          ctx.fillStyle = '#183b26';
          ctx.beginPath(); ctx.arc(0, -obstacle.r, obstacle.r * .86, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#91ad59'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#9cae58';
          ctx.beginPath(); ctx.arc(-obstacle.r * .42, -obstacle.r * .82, obstacle.r * .42, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = '#251d25';
          ctx.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const angle = i / 6 * TAU + obstacle.seed;
            const r = obstacle.r * (i % 2 ? .78 : 1.12);
            i ? ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r) : ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
          }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#bd9383'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.strokeStyle = '#ffb057'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-obstacle.r * .45, -obstacle.r * .2); ctx.lineTo(obstacle.r * .2, obstacle.r * .12); ctx.lineTo(obstacle.r * .48, obstacle.r * .5); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  drawBuildings(ctx) {
    for (const building of this.buildings) {
      const skill = ACTIVE_SKILLS[building.skill];
      const art = RELIC_ART[building.terrain];
      const sprite = this.relicSprites[building.terrain];
      const size = art?.size || building.r * 4.2;
      ctx.save();
      ctx.translate(building.x, building.y);
      ctx.fillStyle = 'rgba(10, 18, 24, .45)';
      ctx.beginPath(); ctx.ellipse(0, size * .36, size * .42, size * .12, 0, 0, TAU); ctx.fill();
      ctx.shadowColor = skill.color; ctx.shadowBlur = building.hit > 0 ? 20 : 10;
      if (sprite?.ready) {
        ctx.globalAlpha = building.hit > 0 ? .74 : 1;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite.image, -size / 2, -size / 2, size, size);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.fillStyle = building.hit > 0 ? '#fff3d5' : '#34404a';
        ctx.fillRect(-building.r * .72, -building.r * .16, building.r * 1.44, building.r * .92);
        ctx.fillStyle = skill.color;
        ctx.beginPath();
        ctx.moveTo(0, -building.r * 1.24); ctx.lineTo(building.r * .52, -building.r * .12); ctx.lineTo(-building.r * .52, -building.r * .12); ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#e9f0d0';
      ctx.font = '800 11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${skill.key} 强化`, 0, -size * .60);
      this.drawBar(ctx, -size * .42, size * .43, size * .84, 4, building.hp / building.maxHp, skill.color);
      ctx.restore();
    }
  }

  drawPickups(ctx) {
    for (const item of this.pickups) {
      const style = PICKUPS[item.kind];
      ctx.save();
      ctx.translate(item.x, item.y + Math.sin(item.t) * 3);
      ctx.shadowColor = style.glow; ctx.shadowBlur = 16;
      ctx.fillStyle = style.color;
      if (item.kind === 'fruit') {
        ctx.beginPath(); ctx.arc(0, 2, item.r * .72, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9ccc63'; ctx.beginPath(); ctx.ellipse(4, -7, 4, 7, .6, 0, TAU); ctx.fill();
      } else if (item.kind === 'ember') {
        ctx.rotate(Math.PI / 4 + Math.sin(item.t) * .12);
        ctx.fillRect(-item.r * .62, -item.r * .62, item.r * 1.24, item.r * 1.24);
      } else if (item.kind === 'relic') {
        ctx.rotate(item.t * .3);
        ctx.lineWidth = 2; ctx.strokeStyle = style.color;
        ctx.beginPath(); ctx.arc(0, 0, item.r * .72, 0, TAU); ctx.stroke();
        ctx.fillRect(-3, -item.r, 6, item.r * 2);
      } else if (item.kind === 'haste') {
        ctx.rotate(Math.sin(item.t) * .3);
        ctx.beginPath(); ctx.moveTo(0, -item.r); ctx.lineTo(item.r * .76, item.r * .75); ctx.lineTo(-item.r * .76, item.r * .75); ctx.closePath(); ctx.fill();
      } else if (item.kind === 'ward') {
        ctx.beginPath(); ctx.moveTo(0, -item.r); ctx.lineTo(item.r * .78, -item.r * .45); ctx.lineTo(item.r * .58, item.r * .7); ctx.lineTo(0, item.r); ctx.lineTo(-item.r * .58, item.r * .7); ctx.lineTo(-item.r * .78, -item.r * .45); ctx.closePath(); ctx.fill();
      } else if (item.kind === 'vampire') {
        ctx.rotate(Math.sin(item.t) * .12);
        ctx.beginPath(); ctx.moveTo(0, item.r * .82); ctx.lineTo(-item.r * .78, -item.r * .1); ctx.arc(-item.r * .38, -item.r * .18, item.r * .4, Math.PI, 0); ctx.arc(item.r * .38, -item.r * .18, item.r * .4, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe1eb'; ctx.beginPath(); ctx.arc(0, item.r * .1, item.r * .18, 0, TAU); ctx.fill();
      } else {
        ctx.rotate(Math.sin(item.t) * .14);
        ctx.fillRect(-item.r * .7, -3, item.r * 1.4, 6);
        ctx.beginPath(); ctx.arc(-item.r * .7, 0, 4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(item.r * .7, 0, 4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawGems(ctx) {
    for (const gem of this.gems) {
      ctx.save();
      ctx.translate(gem.x, gem.y + Math.sin(gem.t) * 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#b9e58b';
      ctx.shadowColor = '#94c76c'; ctx.shadowBlur = 12;
      ctx.fillRect(-gem.r, -gem.r, gem.r * 2, gem.r * 2);
      ctx.restore();
    }
  }

  drawBullets(ctx) {
    for (const b of this.bullets) {
      const form = growthForm(b.stage || 0);
      if (b.kind === 'hurricane') {
        const art = EFFECT_ART.hurricane;
        const sprite = this.effectSprites.hurricane;
        const size = art.size + b.r * 1.4;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.shadowColor = '#aee8ff'; ctx.shadowBlur = 14;
        if (sprite?.ready) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite.image, -size / 2, -size / 2, size, size);
          ctx.imageSmoothingEnabled = true;
        } else {
          ctx.strokeStyle = '#aee8ff'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, b.r, .2, TAU - .55); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, b.r * .55, .5, TAU); ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      if (b.kind === 'spike') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = form.color;
        ctx.shadowColor = form.glow; ctx.shadowBlur = 8 + (b.stage || 0) * 3;
        if (b.stage === 2) {
          ctx.fillStyle = '#ffcf70';
          ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, -7); ctx.lineTo(-4, 0); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-8, -5); ctx.lineTo(-8, 5); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        continue;
      }
      if (b.kind === 'wheel') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(this.time * 14 + b.spin);
        ctx.fillStyle = form.color; ctx.shadowColor = form.glow; ctx.shadowBlur = 12;
        ctx.fillRect(-10, -3, 20, 6); ctx.fillRect(-3, -10, 6, 20);
        ctx.fillStyle = '#fff1bd'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
        ctx.restore();
        continue;
      }
      if (b.kind === 'flint') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = form.color; ctx.shadowColor = form.glow; ctx.shadowBlur = 11;
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -6); ctx.lineTo(-5, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.strokeStyle = b.kind === 'ember' ? 'rgba(255, 126, 70, .45)' : 'rgba(220, 233, 159, .35)';
      ctx.lineWidth = b.kind === 'ember' ? 4 : 3;
      ctx.beginPath();
      b.trail.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = form.color;
      ctx.shadowColor = form.glow; ctx.shadowBlur = 13;
      if (b.kind === 'ember') {
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-6, -7); ctx.lineTo(-2, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawEnemyBullets(ctx) {
    for (const bullet of this.enemyBullets) {
      const style = ENEMY_SHOT_STYLES[bullet.kind];
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      const angle = Math.atan2(bullet.vy, bullet.vx);
      if (bullet.bossArt === 'bubble') {
        const sprite = this.effectSprites[bullet.bossSprite];
        if (sprite?.ready) {
          const size = Math.max(EFFECT_ART.bubble.size, bullet.r * 4.2);
          ctx.globalAlpha = .92;
          ctx.shadowColor = '#b9f7fb'; ctx.shadowBlur = 12;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite.image, -size / 2, -size / 2, size, size);
          ctx.imageSmoothingEnabled = true;
          ctx.restore();
          continue;
        }
        const radius = bullet.r * 1.65;
        ctx.globalAlpha = .84;
        ctx.fillStyle = 'rgba(129, 222, 234, .32)';
        ctx.shadowColor = '#b9f7fb'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#d6fcff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, .78)';
        ctx.beginPath(); ctx.arc(-radius * .3, -radius * .34, Math.max(1.5, radius * .17), 0, TAU); ctx.fill();
        ctx.restore();
        continue;
      }
      if (bullet.bossArt === 'leaf') {
        const radius = bullet.zone ? bullet.r * .78 : bullet.r * 1.55;
        ctx.rotate(angle + (bullet.zone ? this.time * 2.8 : Math.PI / 2));
        const sprite = this.effectSprites[bullet.bossSprite];
        if (sprite?.ready) {
          const size = Math.max(EFFECT_ART.leaf.size, radius * 2.75);
          ctx.globalAlpha = bullet.zone ? .86 : 1;
          ctx.shadowColor = '#e8ffae'; ctx.shadowBlur = 11;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite.image, -size / 2, -size / 2, size, size);
          ctx.imageSmoothingEnabled = true;
          ctx.restore();
          continue;
        }
        ctx.fillStyle = '#bde879'; ctx.shadowColor = '#e8ffae'; ctx.shadowBlur = 11;
        ctx.beginPath(); ctx.ellipse(0, 0, radius * .48, radius, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#597a3e'; ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.moveTo(0, -radius * .82); ctx.lineTo(0, radius * .82); ctx.stroke();
        if (bullet.zone) {
          ctx.rotate(Math.PI * 2 / 3); ctx.fillStyle = '#91cc64';
          ctx.beginPath(); ctx.ellipse(0, 0, radius * .42, radius * .88, 0, 0, TAU); ctx.fill();
          ctx.rotate(Math.PI * 2 / 3);
          ctx.beginPath(); ctx.ellipse(0, 0, radius * .42, radius * .88, 0, 0, TAU); ctx.fill();
        }
        ctx.restore();
        continue;
      }
      if (bullet.zone && this.effectSprites.venom?.ready) {
        const art = EFFECT_ART.venom;
        const width = Math.max(art.width, bullet.r * 3);
        const height = Math.max(art.height, bullet.r * 2.15);
        ctx.globalAlpha = Math.min(.9, bullet.life / .28);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.effectSprites.venom.image, -width / 2, -height / 2, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.restore();
        continue;
      }
      if (bullet.bossArt === 'flame' && this.effectSprites.flame?.ready) {
        const size = EFFECT_ART.flame.size + bullet.r * 1.7;
        ctx.rotate(angle + Math.PI / 2);
        ctx.shadowColor = style.glow; ctx.shadowBlur = 11;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.effectSprites.flame.image, -size / 2, -size / 2, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.restore();
        continue;
      }
      ctx.rotate(angle);
      ctx.fillStyle = style.color; ctx.shadowColor = style.glow; ctx.shadowBlur = 11;
      if (bullet.zone) {
        ctx.globalAlpha = Math.min(.75, bullet.life / .28);
        ctx.beginPath(); ctx.arc(0, 0, bullet.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = style.glow; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, bullet.r * .7, 0, TAU); ctx.stroke();
      } else if (bullet.kind === 'root' || bullet.kind === 'spear') {
        ctx.fillRect(-bullet.r, -3, bullet.r * 2, 6);
      } else if (bullet.kind === 'fire') {
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, bullet.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawEnemies(ctx) {
    for (const e of this.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      const scale = e.boss ? 1 + Math.sin(this.time * 3) * .05 : 1;
      ctx.scale(scale, scale);
      const sprite = this.enemySprites[e.sprite];
      if (sprite?.ready) {
        const frame = sprite.frames?.[e.facing];
        const [x, y, width, height] = frame ? [frame.x, frame.y, frame.w, frame.h] : sprite.frame;
        const artScale = enemyVisualScale(e, sprite);
        ctx.globalAlpha = e.hit > 0 ? .72 : 1;
        if (!sprite.frames && e.flipX) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite.image, x, y, width, height, -width * artScale / 2, -height * artScale / 2, width * artScale, height * artScale);
        ctx.imageSmoothingEnabled = true;
        ctx.restore();
        if (e.boss || e.hp < e.maxHp) this.drawBar(ctx, e.x - e.radius, e.y - e.radius - 11, e.radius * 2, 4, e.hp / e.maxHp, e.boss ? '#ff7499' : '#efb0ff');
        continue;
      }
      ctx.shadowColor = e.color; ctx.shadowBlur = e.boss ? 24 : 14;
      ctx.fillStyle = e.hit > 0 ? '#fff5f8' : e.color;
      const sides = e.form === 'spore' ? 10 : e.form === 'wing' ? 4 : e.form === 'shell' ? 6 : e.form === 'mutant' ? 7 : 8;
      ctx.beginPath();
      for (let i = 0; i < sides; i += 1) {
        const pointy = e.form === 'spore' || e.form === 'wing';
        const radius = e.radius * (pointy && i % 2 ? .48 : e.form === 'shell' && i % 2 ? .82 : 1);
        const angle = i / sides * TAU + this.time * (e.boss ? .55 : e.form === 'wing' ? 1.8 : -.7);
        i ? ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius) : ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1b1036';
      ctx.beginPath(); ctx.arc(-e.radius * .24, -e.radius * .12, Math.max(2, e.radius * .13), 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(e.radius * .24, -e.radius * .12, Math.max(2, e.radius * .13), 0, TAU); ctx.fill();
      ctx.restore();
      if (e.boss || e.hp < e.maxHp) this.drawBar(ctx, e.x - e.radius, e.y - e.radius - 11, e.radius * 2, 4, e.hp / e.maxHp, e.boss ? '#ff7499' : '#efb0ff');
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.ward > 0) {
      ctx.globalAlpha = .35 + Math.sin(this.time * 10) * .12;
      ctx.strokeStyle = '#b7c8ff'; ctx.lineWidth = 3; ctx.shadowColor = '#9bb9ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, 31 + p.wardLevel * 4, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (p.hitPulse > 0) {
      ctx.globalAlpha = .12 + p.hitPulse * .18;
      ctx.strokeStyle = '#ff8d97'; ctx.lineWidth = 2; ctx.shadowColor = '#ff8d97'; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(0, 2, p.r + 7, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = p.invuln > 0 ? .55 + Math.sin(this.time * 22) * .3 : 1;
    ctx.fillStyle = 'rgba(11, 30, 25, .42)';
    ctx.beginPath(); ctx.ellipse(0, 29, 24, 7, 0, 0, TAU); ctx.fill();
    if (this.spriteReady) {
      const frame = SPRITE_FRAMES[p.facing];
      const scale = .35;
      const width = frame.w * scale;
      const height = frame.h * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.shadowColor = p.flash > 0 ? '#fff0b2' : '#d4e790';
      ctx.shadowBlur = p.flash > 0 ? 18 : 7;
      ctx.drawImage(this.sprite, frame.x, frame.y, frame.w, frame.h, -width / 2, -height / 2, width, height);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.shadowColor = '#c6df84'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#e8efe0';
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawOrbit(ctx) {
    const p = this.player;
    if (!p.orbitCount) return;
    const form = growthForm(p.growthStage);
    for (let index = 0; index < p.orbitCount; index += 1) {
      const point = this.orbitPoint(index);
      ctx.save();
      ctx.translate(point.x, point.y);
      if (this.effectSprites.fan?.ready) {
        const size = EFFECT_ART.fan.size;
        ctx.rotate(orbitFanAngle(point.angle));
        ctx.shadowColor = '#d4e9ff'; ctx.shadowBlur = 12;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.effectSprites.fan.image, -size / 2, -size / 2, size, size);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.rotate(point.angle);
        ctx.fillStyle = form.color; ctx.shadowColor = form.glow; ctx.shadowBlur = 13;
        if (form.kind === 'gene') {
          ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
        } else if (form.kind === 'flint') {
          ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(0, -7); ctx.lineTo(-8, 0); ctx.lineTo(0, 7); ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-4, -7); ctx.lineTo(-1, 0); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawEffects(ctx) {
    for (const zap of this.zaps) {
      const midX = (zap.x1 + zap.x2) / 2 + (zap.y1 - zap.y2) * .08;
      const midY = (zap.y1 + zap.y2) / 2 + (zap.x2 - zap.x1) * .08;
      ctx.save();
      ctx.globalAlpha = clamp(zap.life / zap.max, 0, 1);
      ctx.strokeStyle = zap.color; ctx.lineWidth = 2.5; ctx.shadowColor = zap.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(zap.x1, zap.y1); ctx.lineTo(midX, midY); ctx.lineTo(zap.x2, zap.y2); ctx.stroke();
      ctx.restore();
    }
    for (const ring of this.rings) {
      ctx.save();
      ctx.globalAlpha = clamp(ring.life * 1.8, 0, .9);
      ctx.strokeStyle = ring.color; ctx.lineWidth = 3;
      ctx.shadowColor = ring.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawBar(ctx, x, y, width, height, ratio, color) {
    ctx.fillStyle = 'rgba(5, 7, 20, .65)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * clamp(ratio, 0, 1), height);
  }

  drawHud(ctx) {
    const p = this.player;
    const biome = BIOMES[this.biomeIndex];
    const buffs = [
      p.haste > 0 && `疾行 ${Math.ceil(p.haste)}s`,
      p.invuln > 1 && `护符 ${Math.ceil(p.invuln)}s`,
      p.ward > 0 && `护壁 ${Math.ceil(p.ward)}s`,
      p.vampireLevel > 0 && `吸血 ×${p.vampireLevel}`,
    ].filter(Boolean).join(' · ');
    ctx.save();
    ctx.fillStyle = 'rgba(9, 24, 20, .64)';
    ctx.fillRect(12, 12, Math.min(258, this.width - 24), buffs ? 78 : 62);
    ctx.fillStyle = '#eff5dc';
    ctx.font = '700 13px system-ui';
    ctx.fillText(`${biome.name} · ${this.difficulty.short} · Lv.${this.level}`, 20, 33);
    this.drawBar(ctx, 20, 41, Math.min(180, this.width - 100), 9, p.hp / p.maxHp, '#db7875');
    this.drawBar(ctx, 20, 56, Math.min(180, this.width - 100), 6, this.xp / this.nextXp, '#b5df76');
    ctx.fillStyle = growthForm(p.growthStage).color;
    ctx.font = '700 11px system-ui';
    ctx.fillText(growthForm(p.growthStage).name, 210, 61);
    if (buffs) {
      ctx.fillStyle = '#aee6d0';
      ctx.font = '700 10px system-ui';
      ctx.fillText(buffs, 20, 76);
    }
    const activeBoss = bossBarVisible(this.boss);
    const objective = activeBoss ? this.boss.name : `火种迁徙 ${Math.max(0, Math.ceil(BOSS_TIME - this.stageTime))}s`;
    ctx.textAlign = 'right';
    ctx.fillStyle = activeBoss ? '#f1b1b5' : '#d3e6ad';
    ctx.fillText(objective, this.width - 18, 33);
    ctx.fillStyle = '#eff5dc';
    ctx.font = '800 19px system-ui';
    ctx.fillText(`${String(Math.floor(this.time / 60)).padStart(2, '0')}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`, this.width - 18, 59);
    ctx.fillStyle = '#ffd27a';
    ctx.font = '800 13px system-ui';
    ctx.fillText(`积分 ${this.score}`, this.width - 18, 84);
    ctx.restore();
  }

  drawBossBar(ctx) {
    const boss = this.boss;
    if (!bossBarVisible(boss)) return;
    const { x, y, width } = bossBarLayout(this.width, this.height);
    const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(28, 12, 20, .8)';
    ctx.fillRect(x - 10, y - 24, width + 20, 43);
    ctx.strokeStyle = boss.phaseTwo ? '#ffd06f' : '#ff8d9d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 10, y - 24, width + 20, 43);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff0d9';
    ctx.font = '800 13px system-ui';
    ctx.fillText(`BOSS · ${boss.name}${boss.phaseTwo ? ' · 狂怒' : ''}`, this.width / 2, y - 8);
    this.drawBar(ctx, x, y, width, 10, ratio, boss.phaseTwo ? '#ffbe5d' : '#ef657a');
    ctx.fillStyle = '#ffd9d2';
    ctx.font = '700 10px system-ui';
    ctx.fillText(`${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`, this.width / 2, y + 29);
    ctx.restore();
  }

  drawBossArrow(ctx) {
    const point = bossArrowLayout(this.width, this.height, this.boss, this.camera);
    if (!point) return;
    const pulse = .8 + Math.sin(this.time * 5.5) * .12;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle + Math.PI / 2);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd06c';
    ctx.shadowColor = '#ff7d65';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();
    if (point.offscreen) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff0d0';
      ctx.font = '800 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS', 0, 21);
    }
    ctx.restore();
  }

  drawPickupNotice(ctx) {
    const notice = this.pickupNotice;
    if (!notice || notice.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, notice.life * 2);
    ctx.textAlign = 'center';
    ctx.font = '800 14px system-ui';
    ctx.fillStyle = notice.color;
    ctx.fillText(notice.text, this.width / 2, this.height * .72);
    ctx.restore();
  }

  drawBiomeBanner(ctx) {
    if (this.biomeNotice <= 0) return;
    const biome = BIOMES[this.biomeIndex];
    const alpha = Math.min(1, this.biomeNotice * 1.7, (3.4 - this.biomeNotice) * 1.7);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(5, 14, 11, .55)';
    ctx.fillRect(30, this.height * .39, this.width - 60, 65);
    ctx.fillStyle = biome.accent;
    ctx.font = '800 21px system-ui';
    ctx.fillText(`生态阶段 ${this.biomeIndex + 1} · ${biome.name}`, this.width / 2, this.height * .39 + 28);
    ctx.fillStyle = '#e8f1dc';
    ctx.font = '500 12px system-ui';
    ctx.fillText(biome.subtitle, this.width / 2, this.height * .39 + 49);
    ctx.restore();
  }
}

function boot() {
  const dom = {
    start: document.querySelector('#start-screen'),
    upgrade: document.querySelector('#upgrade-screen'),
    end: document.querySelector('#end-screen'),
    restartButton: document.querySelector('#restart-button'),
    difficultyButtons: [...document.querySelectorAll('[data-difficulty]')],
    choices: document.querySelector('#choice-list'),
    endKicker: document.querySelector('#end-kicker'),
    endTitle: document.querySelector('#end-title'),
    endSummary: document.querySelector('#end-summary'),
    finalScore: document.querySelector('#final-score'),
    scoreForm: document.querySelector('#score-form'),
    playerName: document.querySelector('#player-name'),
    scoreStatus: document.querySelector('#score-status'),
    leaderboard: document.querySelector('#leaderboard'),
    nova: document.querySelector('#nova'),
    dash: document.querySelector('#dash'),
    spear: document.querySelector('#spear'),
    ward: document.querySelector('#ward'),
    joystick: document.querySelector('#joystick'),
    joystickKnob: document.querySelector('#joystick-knob'),
  };
  const game = new Game(document.querySelector('#game'), dom);
  dom.difficultyButtons.forEach(button => button.addEventListener('click', () => game.start(button.dataset.difficulty)));
  dom.scoreForm.addEventListener('submit', event => {
    event.preventDefault();
    game.submitScore(dom.playerName.value);
  });
  dom.restartButton.addEventListener('click', () => game.showDifficulty());
}

if (typeof document === 'undefined') {
globalThis.__civilizationTest = { clamp, joystickVector, chooseUnique, enemyStats, enemyScore, XP_PER_GEM, VAMPIRE_HEAL_PER_HIT, VAMPIRE_RUNE_CHANCE, LEADERBOARD_LIMIT, normalizePlayerName, readLeaderboard, saveLeaderboardEntry, BIOME_DURATION, BOSS_TIME, BIOMES, OBSTACLE_ART, RELIC_ART, ENEMY_ART, ENEMY_SPRITE_FRAMES, EFFECT_ART, BOSS_SHOT_ART, HURRICANE_SPEED, HURRICANE_KNOCKBACK, hurricaneKnockback, healOnLevel, FAN_HANDLE_ANGLE, ACTIVE_SKILLS, ACTIVE_SKILL_MAX_LEVEL, RELIC_BUILDING_SITES, RELIC_RESPAWN_INTERVAL, RELIC_MAX_ACTIVE, MUSIC_LOOP_SECONDS, MUSIC_GAIN, MUSIC_STAGES, UPGRADES, PICKUPS, makeRelicBuilding, makeRelicBuildings, activeSkillCooldown, createMusicLoop, enemyVisualScale, getBiomeIndex, cameraFromPlayer, directionFrame, mirrorFacing, orbitFanAngle, pickupIndex, tileRange, obstacleAt, hitsObstacle, facingAngle, fanAngles, applyPickup, applyVampireHeal, difficultyFor, musicFrequency, musicStageFor, bossBarVisible, bossBarLayout, bossArrowLayout, bossShotArt, spawnInterval, growthForm, stageClock, nextBiomeAfterBoss };
} else {
  boot();
}
