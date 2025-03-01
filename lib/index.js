import { getDevice } from "./device.js";
import { commands } from "./packet.js";
import crc32 from "crc-32";
import { PNG } from "pngjs";
import { createCanvas } from "canvas";

const { device, transfer } = await getDevice();

if (!device || !transfer) {
  console.log("no device");
  process.exit(-1);
}

/** @param {Uint8Array} imageBuffer */
const writeChunk = async (imageBuffer) => {
  const data = Buffer.alloc(imageBuffer.byteLength + 10);
  let offset = 0;
  data.writeUint8(0x02, offset); offset += 1; // Frame Begin
  data.writeUint8(0x00, offset); offset += 1; // Op code part 1
  data.writeUint8(0x01, offset); offset += 1; // Op code part 2
  data.writeUint16LE(imageBuffer.byteLength, offset); offset += 2; // Data length
  for (let idx = 0; idx < imageBuffer.byteLength; idx++) {
    data.writeUint8(imageBuffer[idx], offset); offset += 1;
  }
  let crc = crc32.buf(imageBuffer, 0x35769521 & 0xffffffff);
  data.writeInt32LE(crc, offset); offset += 4; // CRC
  data.writeUint8(0x03, offset); offset += 1; // Frame End

  await transfer(data);
}

const splitText = (
  /** @type {import("canvas").CanvasRenderingContext2D} */ ctx,
  /** @type {string} */ text,
  /** @type {number} */ maxWidth
) => {
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0];

  for (const word of words) {
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

const WIDTH = 576;
const canvas = createCanvas(WIDTH, 200);
const ctx = canvas.getContext("2d");
ctx.font = "30px";
const text = "this is the text I want to write to my canvas. let's see if it wraps around or if it just goes off the page and has an issue";
const lines = splitText(ctx, text, WIDTH);

for (let i = 0; i < lines.length; i++) {
  ctx.fillText(lines[i], 0, 50*(i + 1));
}
const image = canvas.toBuffer()

const { width, height, data } = await new Promise((resolve, reject) => 
  new PNG({ filterType: 4 }).parse(image, (err, data) => {
    if (err) return reject(err);
    resolve(data);
  })
)


const imageWidthBytes = (width / 8) | 0;
const buffers = []
for (let y = 0; y < height; y++) {
  const buffer = new Uint8Array(imageWidthBytes);
  buffers[y] = buffer;
  for (let x = 0; x < width; x++) {
    var idx = (width * y + x) << 2;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    const inked = ((r + g + b) / 3) <= 100 && a > 100;
    const byteIdx = (x / 8) | 0;
    const bitIdx = 7 - (x % 8);
    let byte = buffer[byteIdx];

    if (inked) {
      byte = byte | (1 << bitIdx);
    } else {
      byte = byte & ~(1 << bitIdx);
    }
    buffer[byteIdx] = byte;
  }
}

for (const buffer of buffers) {
  await writeChunk(buffer)
}

await transfer(commands.printFeedLine(300));
device.close();