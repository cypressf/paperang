import { commands } from "./packet.js";
import crc32 from "crc-32";
import { PNG } from "pngjs";
import { createCanvas } from "canvas";
import { getDeviceList, WebUSBDevice } from "usb";
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import fs from 'fs';


/**
 * Fetches articles published in the last 24 hours
 * @param {URL | string} rssUrl
 */
async function fetchRecentArticles(rssUrl) {
  try {
    const response = await fetch(rssUrl);
    const xmlData = await response.text();
    const result = await parseStringPromise(xmlData);
    const items = result.rss.channel[0].item;
    
    // Set cutoff time to 24 hours ago
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24);
    
    // Find articles published in the last 24 hours
    const recentArticles = [];
    
    for (const item of items) {
      const pubDate = new Date(item.pubDate[0]);
      
      if (pubDate >= cutoffTime) {
        recentArticles.push({
          url: item.link[0],
          title: item.title[0],
          date: pubDate
        });
      }
    }
    
    console.log(`Found ${recentArticles.length} articles published in the last 24 hours`);
    return recentArticles;
  } catch (error) {
    console.error('Error fetching recent articles:', error);
    return [];
  }
}

/**
 * Fetches the full text of an article by URL
 * @param {string} url
 */
async function fetchFullArticle(url) {
  console.log('Fetching article from URL:', url);
  const response = await fetch(url);
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    console.error('Failed to extract article from URL:', url);
    return null;
  }
  
  return article;
}

/**
 * Main daily print function - prints all articles from the last 24 hours
 */
async function printDailyArticles() {
  const rssUrl = 'https://www.cambridgeday.com/feed/';
  console.log(`Running daily article print job at ${new Date().toLocaleString()}...`);
  
  const recentArticles = await fetchRecentArticles(rssUrl);
  
  if (!recentArticles.length) {
    console.log('No recent articles found to print');
    return;
  };

  console.log(`Found ${recentArticles.length} recent articles to print`);

  // Print each article
  for (const article of recentArticles) {
    const articleText = await fetchFullArticle(article.url);
    
    if (articleText) {
      await print(articleText);

      // Add a delay between articles to let the printer rest
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log(`Printed ${recentArticles.length} articles successfully!`);
}

const WIDTH = 576;
const MEASURE_CONTEXT = createCanvas(1, 1).getContext("2d");

/**
 * @param {string} text
 * @param {number} fontSize
 */
function wrapLines(text, fontSize) {
  MEASURE_CONTEXT.font = `${fontSize}px`;
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const measuredWidth = MEASURE_CONTEXT.measureText(testLine).width;
    if (measuredWidth > WIDTH) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  // Add the last line
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/** Print an article
 * @param {{ title: string, textContent: string }} article
 */
async function print(article) {
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
  
  const BODY_FONT_SIZE = 30;
  const TITLE_FONT_SIZE = 60;

  // Wrap title into lines no greater than WIDTH
  const measureContext = createCanvas(1, 1).getContext("2d");
  measureContext.font = `${TITLE_FONT_SIZE}px`;
  const titleLines = wrapLines(article.title, TITLE_FONT_SIZE);
 
  // Wrap text into lines no greater than WIDTH, preserving existing paragraphs
  // Paragraphs are separated by any number of newlines with whitespace interspersed
  const paragraphs = article.textContent.split(/\s*\n\s*/);
  const bodyLines = [];
  
  for (const paragraph of paragraphs) {
    const lines = wrapLines(paragraph, BODY_FONT_SIZE);
    bodyLines.push("", ...lines); // Add a blank line between paragraphs
  }

  // Calculate canvas height based on line count
  const titleHeight = (titleLines.length + 1) * TITLE_FONT_SIZE;
  const bodyHeight = (bodyLines.length + 1) * BODY_FONT_SIZE;
  const canvasHeight = titleHeight + bodyHeight;
  const canvas = createCanvas(WIDTH, canvasHeight);
  const context = canvas.getContext("2d");
  
  // Render title
  context.font = `${TITLE_FONT_SIZE}px`;
  for (let i = 0; i < titleLines.length; i++) {
    context.fillText(titleLines[i], 0, (i + 1) * TITLE_FONT_SIZE);
  }
  
  // Render body
  context.font = `${BODY_FONT_SIZE}px`;
  for (let i = 0; i < bodyLines.length; i++) {
    context.fillText(bodyLines[i], 0, titleHeight + (i + 1) * BODY_FONT_SIZE);
  }
  
  const image = canvas.toBuffer()

  // Save image to disk for debugging
  // fs.writeFileSync('output.png', image);

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
}


// For testing purposes, you can uncomment this to run immediately
printDailyArticles();
