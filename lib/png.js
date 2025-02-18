import { PNG } from "pngjs";
import fs from "fs/promises";
import path from "path";
import ImageData from "./image.js";
import assert from "assert";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const root = path.join(__dirname, "../images");

export const load = async (/** @type {string} */ filename) =>
  fs.readFile(path.join(root, filename));



export const createImageData = async () => {
  const buffer = await load("film-0446-035.png");
  const { width, height, data } = await new Promise((resolve, reject) => 
    new PNG({ filterType: 4 }).parse(buffer, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    })
  );

  assert(width === 576, "width must be 576");

  // https://beyondloom.com/blog/dither.html

  const img = new ImageData({ width });

  for (let y = 0; y < height; y++) {
    const line = img.addLine();
    for (let x = 0; x < width; x++) {
      var idx = (width * y + x) << 2;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const value = (r + g + b) / 3;
      line.set(x, value <= 128);
    }
  }

  const buffers = img.pack(16);

  return buffers;
};
