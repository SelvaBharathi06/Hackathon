/**
 * fileExtractor.js — Extracts plain text from uploaded files.
 * Supports: .txt, .pdf, .docx
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const SUPPORTED_EXTENSIONS = ['.txt', '.pdf', '.docx'];

/**
 * Extract text content from a file on disk.
 * @param {string} filePath  – absolute path to the uploaded file
 * @param {string} originalName – original filename (used for extension detection)
 * @returns {Promise<string>} extracted text
 */
async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Accepted: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  if (ext === '.txt') {
    const text = fs.readFileSync(filePath, 'utf-8');
    if (!text.trim()) throw new Error('Uploaded .txt file is empty.');
    return text;
  }

  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await pdfParse(dataBuffer);
    const text = (result.text || '').trim();
    if (!text) throw new Error('Could not extract text from PDF (file may be image-based or empty).');
    return text;
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    const text = (result.value || '').trim();
    if (!text) throw new Error('Uploaded .docx file is empty or unreadable.');
    return text;
  }

  throw new Error('Unsupported file type.');
}

/**
 * Safely remove a temporary file.
 */
function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore cleanup errors */ }
}

module.exports = { extractTextFromFile, cleanupFile, SUPPORTED_EXTENSIONS };
