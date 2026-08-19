// Gutenberg API via Gutendex
const GUTENDEX = 'https://gutendex.com/books';

// Curated book IDs by era
const BOOK_LISTS = {
  victorian: [
    1342,  // Pride and Prejudice - Austen
    98,    // A Tale of Two Cities - Dickens
    174,   // The Picture of Dorian Gray - Wilde
    161,   // Sense and Sensibility - Austen
    768,   // Wuthering Heights - Brontë
    1400,  // Great Expectations - Dickens
  ],
  romantic: [
    84,    // Frankenstein - Shelley
    105,   // Persuasion - Austen
    1260,  // Jane Eyre - Brontë
    2160,  // The Scarlet Letter - Hawthorne
  ],
  american: [
    76,    // Adventures of Huckleberry Finn - Twain
    74,    // The Adventures of Tom Sawyer - Twain
    514,   // Little Women - Alcott
    2852,  // The Red Badge of Courage - Crane
    160,   // The Awakening - Chopin
  ],
  modern: [
    5200,  // Metamorphosis - Kafka
    2701,  // Moby Dick - Melville
    4300,  // Ulysses - Joyce
    215,   // The Call of the Wild - London
    1661,  // The Adventures of Sherlock Holmes - Doyle
  ]
};

// All books combined
BOOK_LISTS.all = Object.values(BOOK_LISTS).flat();

async function fetchBookText(bookId) {
  // Get book metadata
  const metaRes = await fetch(`${GUTENDEX}/books?ids=${bookId}`);
  const metaData = await metaRes.json();
  const book = metaData.results[0];
  if (!book) throw new Error('Book not found');

  // Find plain text format
  const formats = book.formats;
  const textUrl = formats['text/plain; charset=utf-8'] ||
                  formats['text/plain; charset=us-ascii'] ||
                  formats['text/plain'];

  if (!textUrl) throw new Error('No plain text available');

  // Fetch the text
  const textRes = await fetch(textUrl);
  const fullText = await textRes.text();

  return {
    id: book.id,
    title: book.title,
    author: book.authors[0]?.name || 'Unknown',
    text: fullText
  };
}

function extractPage(fullText, charOffset, charsPerPage = 1800) {
  // Strip Gutenberg header/footer
  const startMarkers = ['*** START OF', '***START OF', 'START OF THE PROJECT'];
  const endMarkers = ['*** END OF', '***END OF', 'END OF THE PROJECT'];

  let start = 0;
  let end = fullText.length;

  for (const marker of startMarkers) {
    const idx = fullText.indexOf(marker);
    if (idx !== -1) {
      start = fullText.indexOf('\n', idx) + 1;
      break;
    }
  }

  for (const marker of endMarkers) {
    const idx = fullText.indexOf(marker);
    if (idx !== -1) {
      end = idx;
      break;
    }
  }

  const content = fullText.slice(start, end).trim();

  // Find a clean paragraph break near our offset
  const targetOffset = Math.min(charOffset, content.length - charsPerPage);
  const cleanStart = content.lastIndexOf('\n\n', targetOffset) + 2 || targetOffset;
  const pageText = content.slice(cleanStart, cleanStart + charsPerPage);

  // Try to find nearest chapter heading
  const chapterMatch = content.slice(0, cleanStart).match(/CHAPTER\s+[IVXLCDM\d]+[^\n]*/gi);
  const chapter = chapterMatch ? chapterMatch[chapterMatch.length - 1] : null;

  // Estimate page number
  const pageNum = Math.floor(cleanStart / charsPerPage) + 1;

  return {
    text: pageText.trim(),
    chapter: chapter ? chapter.trim() : null,
    pageNum,
    charOffset: cleanStart,
    totalChars: content.length
  };
}

function getRandomBook(era = 'all') {
  const list = BOOK_LISTS[era] || BOOK_LISTS.all;
  return list[Math.floor(Math.random() * list.length)];
}

function getRandomOffset(totalChars, charsPerPage = 1800) {
  // Avoid first and last 10% (usually intro/outro material)
  const safeStart = Math.floor(totalChars * 0.1);
  const safeEnd = Math.floor(totalChars * 0.9);
  return safeStart + Math.floor(Math.random() * (safeEnd - safeStart));
}
