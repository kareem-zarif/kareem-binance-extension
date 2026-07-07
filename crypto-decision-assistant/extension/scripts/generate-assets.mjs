import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await mkdir(new URL('../public/assets/', import.meta.url), { recursive: true });

const sampleRate = 8000;
const seconds = 0.18;
const samples = Math.floor(sampleRate * seconds);
const dataSize = samples * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
for (let i = 0; i < samples; i++) {
  const envelope = 1 - i / samples;
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * i / sampleRate) * 9000 * envelope), 44 + i * 2);
}
await writeFile(new URL('../public/assets/alert.wav', import.meta.url), wav);

const width = 128, height = 128;
const pixels = Buffer.alloc((width * 4 + 1) * height);
const diamonds = [[64, 64, 16], [64, 32, 10], [64, 96, 10], [32, 64, 10], [96, 64, 10], [48, 48, 7], [80, 48, 7], [48, 80, 7], [80, 80, 7]];
for (let y = 0; y < height; y++) {
  const row = y * (width * 4 + 1); pixels[row] = 0;
  for (let x = 0; x < width; x++) {
    const black = diamonds.some(([cx, cy, radius]) => Math.abs(x - cx) + Math.abs(y - cy) <= radius);
    const offset = row + 1 + x * 4;
    pixels[offset] = black ? 24 : 240; pixels[offset + 1] = black ? 26 : 185; pixels[offset + 2] = black ? 32 : 11; pixels[offset + 3] = 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const chunk = (name, data) => {
  const type = Buffer.from(name); const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); type.copy(output, 4); data.copy(output, 8);
  let crc = 0xffffffff; for (const byte of Buffer.concat([type, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4); return output;
};
const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
const icon = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
await writeFile(new URL('../public/assets/icon.png', import.meta.url), icon);
