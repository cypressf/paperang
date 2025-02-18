// @ts-check
import { getDevice } from "./device.js";
import { commands } from "./packet.js";
import crc32 from "crc-32";
import {load } from "./png.js";
import { PNG } from "pngjs";

const { device, transfer } = await getDevice();

if (!device || !transfer) {
  console.log("no device");
  process.exit(-1);
}

/** @param {Uint8Array} imageBuffer */
const writeChunk = async (imageBuffer ) => {
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

const file = await load("film-0446-035.png");
const { width, height, data } = await new Promise((resolve, reject) => 
  new PNG({ filterType: 4 }).parse(file, (err, data) => {
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
    const inked = ((r + g + b) / 3) <= 100;
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