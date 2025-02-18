class ImageDataLine {
  /** @param {{width: number}} options */
  constructor({ width }) {
    /** @type {number} */
    this.width = width;
    /**  @type {Buffer<ArrayBuffer>} */
    this.buffer = Buffer.alloc(width / 8);
  }

  /** @param {number} i */
  _pos(i) {
    const byte = Math.floor(i / 8);
    const bit = 7 - (i % 8);
    return { byte, bit };
  }

  /**
   * @param {number} i
   * @param {boolean} on
   */
  set(i, on) {
    const pos = this._pos(i);
    const { buffer } = this;
    let byte = buffer.readUInt8(pos.byte);
    if (on) {
      byte = byte | (1 << pos.bit);
    } else {
      byte = byte & ~(1 << pos.bit);
    }
    buffer.writeUInt8(byte, pos.byte);
  }

  /** @param {number} i */
  get(i) {
    const pos = this._pos(i);
    const { buffer } = this;
    const byte = buffer.readUInt8(pos.byte);
    return (byte >> pos.bit) % 2 !== 0;
  }
}

export default class ImageData {
  /**  @type {ImageDataLine[]} */
  lines = [];

  constructor(
    /** @type {{width: number, height?: number}} */
    { width, height }
  ) {
    this.width = width;
    if (height) {
      this.lines = [...Array(height).keys()].map(
        () => new ImageDataLine({ width })
      );
    }
  }

  addLine() {
    const { width } = this;
    const line = new ImageDataLine({ width });
    this.lines.push(line);
    return line;
  }

  /** @param {number} chunk */
  pack(chunk) {
    const { lines } = this;

    while (lines.length % chunk !== 0) {
      this.addLine();
    }

    const chunks = [];
    let i = 0;
    const len = lines.length;

    while (i < len) {
      const slice = lines.slice(i, (i += chunk));
      const buffers = slice.map((line) => line.buffer);
      const buffer = Buffer.concat(buffers);
      chunks.push(buffer);
    }

    return chunks;
  }
}
