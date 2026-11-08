// ホーム画面用アイコン（PNG）を生成する。外部ライブラリなしで描画・PNG化する。
// 使い方: node scripts/makeIcons.mjs
// デザイン：赤い背景に白い円、その中に赤い「？」（RandomDex の待機中表示と同じモチーフ）
// 背景は全面塗りなので、Android の maskable（丸や角丸で切り抜かれる）にもそのまま使える。

import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'icons');

const colorRed = [217, 59, 59];
const colorWhite = [255, 255, 255];

// ---------------------------------------------------------------------------
// 図形（0〜1 の座標系。中なら true）
// ---------------------------------------------------------------------------

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function inCapsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return inCircle(x, y, ax + dx * t, ay + dy * t, r);
}

// 「？」：上の弧＋斜めのつなぎ＋縦棒＋点
function inQuestionMark(x, y) {
  const cx = 0.5;
  const cy = 0.4;
  const radius = 0.115;
  const half = 0.036;
  const distance = Math.hypot(x - cx, y - cy);
  const angle = Math.atan2(y - cy, x - cx); // 右が0、下が正
  // 左やや下（約155°）から上を通って右下（約50°）までの弧
  const arcStart = 2.7;
  const arcEnd = 0.9;
  const onArc = Math.abs(distance - radius) <= half && (angle <= arcEnd || angle >= arcStart);
  const arcEndX = cx + radius * Math.cos(arcEnd);
  const arcEndY = cy + radius * Math.sin(arcEnd);
  const connector = inCapsule(x, y, arcEndX, arcEndY, 0.5, 0.56, half);
  const stem = inCapsule(x, y, 0.5, 0.56, 0.5, 0.6, half);
  const dot = inCircle(x, y, 0.5, 0.7, 0.045);
  // 弧の左端を丸くする
  const arcStartCap = inCircle(x, y, cx + radius * Math.cos(arcStart), cy + radius * Math.sin(arcStart), half);
  return onArc || connector || stem || dot || arcStartCap;
}

function colorAt(x, y) {
  if (inCircle(x, y, 0.5, 0.5, 0.36)) return inQuestionMark(x, y) ? colorRed : colorWhite;
  return colorRed;
}

// ---------------------------------------------------------------------------
// 描画（4x4 のスーパーサンプリングで縁をなめらかに）
// ---------------------------------------------------------------------------

function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const [cr, cg, cb] = colorAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const n = samples * samples;
      const offset = (py * size + px) * 3;
      pixels[offset] = Math.round(r / n);
      pixels[offset + 1] = Math.round(g / n);
      pixels[offset + 2] = Math.round(b / n);
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// PNG 書き出し（RGB 8bit）
// ---------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // ビット深度
  header[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * size * 3, (y + 1) * size * 3));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  await writeFile(path.join(outDir, name), encodePng(size, render(size)));
  console.log(`icons/${name}`);
}
