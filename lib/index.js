import { commands } from "./packet.js";
import crc32 from "crc-32";
import { PNG } from "pngjs";
import { createCanvas } from "canvas";
import { getDeviceList, WebUSBDevice } from "usb";

const devices = getDeviceList();
const printer = devices.find(
  (device) =>
    device.deviceDescriptor.idVendor === 17224 &&
    device.deviceDescriptor.idProduct === 21892
);

if (!printer) {
  console.log(`No printer found in usb devices ${devices}`);
  process.exit(-1);
}

const device = await WebUSBDevice.createInstance(printer);

if (!device) {
  console.log(`Failed to create a WebUSBDevice for ${printer}`);
  process.exit(-1);
}

await device.open();
await device.selectConfiguration(1);
await device.claimInterface(0);

const wrapText = (
  /** @type {import("canvas").CanvasRenderingContext2D} */ ctx,
  /** @type {string} */ text,
  /** @type {number} */ maxWidth
) => {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

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
  return lines.join("\n");
}

// Convert text to image
const WIDTH = 576;
const canvas = createCanvas(WIDTH, 500);
const ctx = canvas.getContext("2d");
ctx.font = "30px";
const text = `A baby raccoon ventures from its nest.
this is another
line and
another
You may not see raccoons as often in the winter as you do during other seasons, but they are here. They do not hibernate; if the weather gets cold enough, they enter a state called torpor in which they slow down their heart rate, breathing and metabolism. During this time, raccoons hole up, often in an opening in a hollow tree, and rely on their fat reserves to survive. They can stay in a state of torpor for several weeks. If the weather warms up, the raccoons may search for easily accessible food, such as food in trash barrels or dumpsters. 
`;
const wrappedText = wrapText(ctx, text, WIDTH);
ctx.fillText(wrappedText, 0, 50);
const image = canvas.toBuffer()
const { width, height, data } = await new Promise((resolve, reject) => 
  new PNG({ filterType: 4 }).parse(image, (err, data) => {
    if (err) return reject(err);
    resolve(data);
  })
)

// Convert image to 1 bit per pixel
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

// Send image to printer
for (const buffer of buffers) {
  const data = Buffer.alloc(buffer.byteLength + 10);
  let offset = 0;
  data.writeUint8(0x02, offset); offset += 1; // Frame Begin
  data.writeUint8(0x00, offset); offset += 1; // Op code part 1
  data.writeUint8(0x01, offset); offset += 1; // Op code part 2
  data.writeUint16LE(buffer.byteLength, offset); offset += 2; // Data length
  for (let idx = 0; idx < buffer.byteLength; idx++) {
    data.writeUint8(buffer[idx], offset); offset += 1;
  }
  let crc = crc32.buf(buffer, 0x35769521 & 0xffffffff);
  data.writeInt32LE(crc, offset); offset += 4; // CRC
  data.writeUint8(0x03, offset); offset += 1; // Frame End

  await device.transferOut(2, data)
}

await device.transferOut(2, commands.printFeedLine(300));
device.close();