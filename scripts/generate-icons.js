// Generate extension icons: rounded square background with refresh arrows + play triangle in white
// Run: node scripts/generate-icons.js

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

function generateIcon(size, bgColor) {
  const s = size;
  const canvas = createCanvas(s, s);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, s, s);

  const cx = s / 2;
  const cy = s / 2;

  // ── Rounded square background ──
  const radius = s * 0.22;
  const inset = s * 0.02;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(inset + radius, inset);
  ctx.lineTo(s - inset - radius, inset);
  ctx.quadraticCurveTo(s - inset, inset, s - inset, inset + radius);
  ctx.lineTo(s - inset, s - inset - radius);
  ctx.quadraticCurveTo(s - inset, s - inset, s - inset - radius, s - inset);
  ctx.lineTo(inset + radius, s - inset);
  ctx.quadraticCurveTo(inset, s - inset, inset, s - inset - radius);
  ctx.lineTo(inset, inset + radius);
  ctx.quadraticCurveTo(inset, inset, inset + radius, inset);
  ctx.closePath();
  ctx.fill();

  // ── White icon elements ──
  const color = '#ffffff';
  const r = s * 0.32; // radius of circular arrow path
  const lineW = Math.max(1.5, s * 0.08);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';

  // ── Two circular arc segments (refresh arrows) ──
  ctx.beginPath();
  ctx.arc(cx, cy, r, -150 * Math.PI / 180, -10 * Math.PI / 180, false);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 30 * Math.PI / 180, 170 * Math.PI / 180, false);
  ctx.stroke();

  // ── Arrowheads ──
  const arrowSize = Math.max(2.5, s * 0.12);

  const a1Angle = -10 * Math.PI / 180;
  const a1x = cx + r * Math.cos(a1Angle);
  const a1y = cy + r * Math.sin(a1Angle);
  const a1dir = a1Angle + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(a1x + arrowSize * Math.cos(a1dir), a1y + arrowSize * Math.sin(a1dir));
  ctx.lineTo(a1x + arrowSize * Math.cos(a1dir - 2.4), a1y + arrowSize * Math.sin(a1dir - 2.4));
  ctx.lineTo(a1x + arrowSize * Math.cos(a1dir + 2.4), a1y + arrowSize * Math.sin(a1dir + 2.4));
  ctx.closePath();
  ctx.fill();

  const a2Angle = 170 * Math.PI / 180;
  const a2x = cx + r * Math.cos(a2Angle);
  const a2y = cy + r * Math.sin(a2Angle);
  const a2dir = a2Angle + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(a2x + arrowSize * Math.cos(a2dir), a2y + arrowSize * Math.sin(a2dir));
  ctx.lineTo(a2x + arrowSize * Math.cos(a2dir - 2.4), a2y + arrowSize * Math.sin(a2dir - 2.4));
  ctx.lineTo(a2x + arrowSize * Math.cos(a2dir + 2.4), a2y + arrowSize * Math.sin(a2dir + 2.4));
  ctx.closePath();
  ctx.fill();

  // ── Play triangle in center (larger) ──
  const playW = s * 0.34;
  const playH = s * 0.38;
  const playOffsetX = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - playW * 0.38 + playOffsetX, cy - playH / 2);
  ctx.lineTo(cx + playW * 0.62 + playOffsetX, cy);
  ctx.lineTo(cx - playW * 0.38 + playOffsetX, cy + playH / 2);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer('image/png');
}

try {
  const sizes = [16, 48, 128];

  // Default (dark gray background)
  for (const size of sizes) {
    const buf = generateIcon(size, '#555555');
    writeFileSync(`icons/icon${size}.png`, buf);
    console.log(`Generated icons/icon${size}.png (mono)`);
  }

  // Active (YouTube red background)
  if (!existsSync('icons/active')) mkdirSync('icons/active', { recursive: true });
  for (const size of sizes) {
    const buf = generateIcon(size, '#FF0033');
    writeFileSync(`icons/active/icon${size}.png`, buf);
    console.log(`Generated icons/active/icon${size}.png (active)`);
  }
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message.includes('canvas')) {
    console.error('The "canvas" npm package is required: npm install canvas');
    process.exit(1);
  }
  throw err;
}
