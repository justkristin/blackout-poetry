// ── LOCAL MANIFEST + TEXT LOADER ─────────────────────────────────────
// Replaces the Gutendex API approach with local manifest.json + txt files.
// Texts live in /texts/ alongside manifest.json.

const TEXTS_PATH = 'texts/';

let _manifest = null;

// Load and cache the manifest
async function loadManifest() {
  if (_manifest) return _manifest;
  const res = await fetch(TEXTS_PATH + 'manifest.json');
  if (!res.ok) throw new Error('Could not load manifest');
  _manifest = await res.json();
  return _manifest;
}

// Return all books, optionally filtered by genres and/or centuries
function filterBooks(manifest, selectedGenres = [], selectedCenturies = []) {
  return manifest.filter(b => {
    if (selectedGenres.length > 0 && !b.genres.some(g => selectedGenres.includes(g))) return false;
    if (selectedCenturies.length > 0 && !selectedCenturies.includes(b.century)) return false;
    return true;
  });
}

// Pick a random book from a filtered pool
function getRandomBook(manifest, selectedGenres = [], selectedCenturies = []) {
  const pool = filterBooks(manifest, selectedGenres, selectedCenturies);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Fetch and return the full text of a book
async function fetchBookText(book) {
  const res = await fetch(TEXTS_PATH + book.file);
  if (!res.ok) throw new Error(`Could not load ${book.file}`);
  const fullText = await res.text();

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    year: book.year,
    gutenberg_url: book.gutenberg_url,
    wikipedia: book.wikipedia || null,
    text: fullText
  };
}

// Strip Project Gutenberg header and footer from text
function stripGutenberg(text) {
  const startMarkers = ['*** START OF', '***START OF', 'START OF THE PROJECT'];
  const endMarkers   = ['*** END OF',   '***END OF',   'END OF THE PROJECT'];

  let start = 0;
  let end   = text.length;

  for (const marker of startMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      start = text.indexOf('\n', idx) + 1;
      break;
    }
  }
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) { end = idx; break; }
  }

  return text.slice(start, end).trim();
}

// Extract a passage of ~charsPerPage chars from the cleaned text
// starting near charOffset, aligned to a paragraph break
function extractPage(fullText, charOffset, charsPerPage = 1800) {
  const content = stripGutenberg(fullText);

  const targetOffset = Math.min(charOffset, Math.max(0, content.length - charsPerPage));
  
  // Snap START to nearest paragraph break, or word boundary
  const paraBreak = content.lastIndexOf('\n\n', targetOffset);
  const cleanStart = paraBreak > 0 
    ? paraBreak + 2 
    : (content.indexOf(' ', targetOffset) + 1 || targetOffset);

  // Snap END to nearest word boundary
  let pageEnd = cleanStart + charsPerPage;
  if (pageEnd < content.length) {
    const lastSpace = content.lastIndexOf(' ', pageEnd);
    if (lastSpace > cleanStart) pageEnd = lastSpace;
  }

  const pageText = content.slice(cleanStart, pageEnd);

  // Try to find the nearest chapter heading before this point
  const chapterMatch = content.slice(0, cleanStart).match(/CHAPTER\s+[IVXLCDM\d]+[^\n]*/gi);
  const chapter = chapterMatch ? chapterMatch[chapterMatch.length - 1] : null;

  const pageNum = Math.floor(cleanStart / charsPerPage) + 1;

  return {
    text: pageText.trim(),
    chapter: chapter ? chapter.trim() : null,
    pageNum,
    charOffset: cleanStart,
    totalChars: content.length
  };
}

// Pick a random offset within the "safe" middle 80% of the text
function getRandomOffset(totalChars) {
  const safeStart = Math.floor(totalChars * 0.1);
  const safeEnd   = Math.floor(totalChars * 0.9);
  return safeStart + Math.floor(Math.random() * (safeEnd - safeStart));
}

// Return all unique genres from the manifest, sorted
function allGenres(manifest) {
  return [...new Set(manifest.flatMap(b => b.genres))].sort();
}

// Return all unique centuries from the manifest, in chronological order
function allCenturies(manifest) {
  const order = ['Ancient', '16th', '17th', '18th', '19th', '20th', '21st'];
  return [...new Set(manifest.map(b => b.century))]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
