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

const WIDTH = 576;
const FONT_SIZE = 30;

const text = `A baby raccoon ventures from its nest.
this is another
line and
another
You may not see raccoons as often in the winter as you do during other seasons, but they are here. They do not hibernate; if the weather gets cold enough, they enter a state called torpor in which they slow down their heart rate, breathing and metabolism. During this time, raccoons hole up, often in an opening in a hollow tree, and rely on their fat reserves to survive. They can stay in a state of torpor for several weeks. If the weather warms up, the raccoons may search for easily accessible food, such as food in trash barrels or dumpsters. 
`;

// Split text into lines no greater than WIDTH, preserving existing newlines
const tempContext = createCanvas(WIDTH, 100).getContext("2d");
tempContext.font = `${FONT_SIZE}px`;
const paragraphs = text.split("\n");
const lines = [];

// Process each paragraph separately for width constraints
for (const paragraph of paragraphs) {
  // If paragraph is empty, preserve the blank line
  if (paragraph.trim() === "") {
    lines.push("");
    continue;
  }
  
  // Handle width wrapping within this paragraph
  const words = paragraph.split(/\s+/);
  let currentLine = "";
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = tempContext.measureText(testLine);    
    if (metrics.width > WIDTH) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  
  // Add the last line of this paragraph
  if (currentLine) {
    lines.push(currentLine);
  }
}

// Calculate canvas height based on line count
const canvas = createCanvas(WIDTH, (lines.length + 1) * FONT_SIZE);
const context = canvas.getContext("2d");
context.font = `${FONT_SIZE}px`;

// Render each line
for (let i = 0; i < lines.length; i++) {
  context.fillText(lines[i], 0, (i + 1) * FONT_SIZE);
}

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