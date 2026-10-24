import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Book } from '../src/models.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env first.');

const here = path.dirname(fileURLToPath(import.meta.url));
const cataloguePath = path.resolve(here, '../data/catalogue.json');
const books = JSON.parse(await readFile(cataloguePath, 'utf8'));
if (books.length !== 1000) throw new Error(`Expected 1,000 catalogue records, found ${books.length}. Run npm run catalogue:download first.`);
const mongoTextLanguages = new Set(['danish', 'dutch', 'english', 'finnish', 'french', 'german', 'hungarian', 'italian', 'norwegian', 'portuguese', 'romanian', 'russian', 'spanish', 'swedish', 'turkish']);
const textIndexLanguage = (value) => {
  const language = String(value || '').trim().toLowerCase();
  const aliases = { en: 'english', da: 'danish', nl: 'dutch', fi: 'finnish', fr: 'french', de: 'german', hu: 'hungarian', it: 'italian', nb: 'norwegian', pt: 'portuguese', ro: 'romanian', ru: 'russian', es: 'spanish', sv: 'swedish', tr: 'turkish' };
  const normalized = aliases[language] || language;
  return mongoTextLanguages.has(normalized) ? normalized : 'english';
};

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const operations = books.map((book) => {
    const identity = book.openLibraryId ? { openLibraryId: book.openLibraryId } : { isbn: book.isbn };
    const filter = book.isbn ? { $or: [identity, { isbn: book.isbn }] } : identity;
    const metadata = { ...book };
    const publicationLanguage = book.publicationLanguage || book.language || 'English';
    metadata.publicationLanguage = publicationLanguage;
    metadata.language = textIndexLanguage(book.language || publicationLanguage);
    delete metadata.totalCopies;
    delete metadata.availableCopies;
    delete metadata.averageRating;
    delete metadata.ratingsCount;
    delete metadata.popularity;
    return {
      updateOne: {
        filter,
        update: {
          $set: metadata,
          $setOnInsert: {
            totalCopies: book.totalCopies,
            availableCopies: book.availableCopies,
            averageRating: book.averageRating,
            ratingsCount: book.ratingsCount || 0,
            popularity: book.popularity || 0,
            branch: 'Main Library',
            active: true,
          },
        },
        upsert: true,
      },
    };
  });
  const result = await Book.bulkWrite(operations, { ordered: false });
  const activeCount = await Book.countDocuments({ active: true });
  console.log(`Catalogue import complete: ${result.upsertedCount} added, ${result.matchedCount} matched and enriched.`);
  console.log(`${books.length} source records processed; ${activeCount} active titles are now in this database.`);
} finally {
  await mongoose.disconnect();
}
