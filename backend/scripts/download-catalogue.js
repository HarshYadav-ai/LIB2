import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(here, '../data/catalogue.json');
const fields = 'key,title,author_name,first_publish_year,publisher,subject,cover_i,isbn,number_of_pages_median,language,ratings_average,ratings_count';
const targetCount = 1000;
const perCategoryTarget = 45;

const subjects = [
  { subject: 'Computer science', category: 'Computer Science', departments: ['Computer Science', 'Information Technology', 'Data Science'] },
  { subject: 'Information technology', category: 'Information Technology', departments: ['Information Technology', 'Computer Science'] },
  { subject: 'Engineering', category: 'Engineering', departments: ['Engineering', 'Civil Engineering'] },
  { subject: 'Mathematics', category: 'Mathematics', departments: ['Mathematics', 'Computer Science', 'Engineering'] },
  { subject: 'Physics', category: 'Physics', departments: ['Physics', 'Engineering'] },
  { subject: 'Chemistry', category: 'Chemistry', departments: ['Chemistry', 'Chemical Engineering', 'Pharmacy'] },
  { subject: 'Biology', category: 'Biology', departments: ['Biology', 'Biotechnology', 'Medicine'] },
  { subject: 'Medicine', category: 'Medicine', departments: ['Medicine', 'Nursing', 'Pharmacy'] },
  { subject: 'Business', category: 'Business', departments: ['Business Administration', 'Commerce', 'Economics'] },
  { subject: 'Economics', category: 'Economics', departments: ['Economics', 'Business Administration', 'Commerce'] },
  { subject: 'Psychology', category: 'Psychology', departments: ['Psychology', 'Education', 'Social Work'] },
  { subject: 'Education', category: 'Education', departments: ['Education', 'Psychology'] },
  { subject: 'History', category: 'History', departments: ['History', 'Political Science', 'English Literature'] },
  { subject: 'Literature', category: 'Literature', departments: ['English Literature', 'Languages', 'Journalism'] },
  { subject: 'Law', category: 'Law', departments: ['Law', 'Political Science'] },
  { subject: 'Political science', category: 'Political Science', departments: ['Political Science', 'History', 'Law'] },
  { subject: 'Environmental science', category: 'Environmental Science', departments: ['Environmental Science', 'Geography', 'Civil Engineering'] },
  { subject: 'Design', category: 'Design', departments: ['Design', 'Architecture', 'Fine Arts'] },
  { subject: 'Architecture', category: 'Architecture', departments: ['Architecture', 'Design', 'Civil Engineering'] },
  { subject: 'Agriculture', category: 'Agriculture', departments: ['Agriculture', 'Biology', 'Environmental Science'] },
  { subject: 'Sociology', category: 'Sociology', departments: ['Sociology', 'Social Work', 'Political Science'] },
  { subject: 'Statistics', category: 'Statistics', departments: ['Mathematics', 'Data Science', 'Economics'] },
];

const starterBooks = [
  { title: 'The Midnight Library', author: 'Matt Haig', isbn: '9780525559474', category: 'Fiction', genre: ['Fiction', 'Fantasy'], departments: ['English Literature', 'Psychology'], year: 2020, publisher: 'Viking', description: 'Between life and death there is a library, and within that library, every book offers a chance to try another life.', cover: 'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg', totalCopies: 5, availableCopies: 5, averageRating: 4.8, popularity: 98 },
  { title: 'The Creative Act', author: 'Rick Rubin', isbn: '9780593652886', category: 'Creativity', genre: ['Creativity', 'Art'], departments: ['Design', 'Fine Arts'], year: 2023, publisher: 'Canongate', description: 'A generous course of study that illuminates the path of the artist as a road we can all follow.', cover: 'https://covers.openlibrary.org/b/isbn/9780593652886-L.jpg', totalCopies: 3, availableCopies: 3, averageRating: 4.7, popularity: 81 },
  { title: 'Educated', author: 'Tara Westover', isbn: '9780399590504', category: 'Memoir', genre: ['Memoir', 'Education'], departments: ['Education', 'History'], year: 2018, publisher: 'Random House', description: 'A memoir about the struggle for self-invention and the transformative power of education.', cover: 'https://covers.openlibrary.org/b/isbn/9780399590504-L.jpg', totalCopies: 4, availableCopies: 4, averageRating: 4.9, popularity: 93 },
  { title: 'Tomorrow, and Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', isbn: '9780593321201', category: 'Fiction', genre: ['Fiction', 'Technology'], departments: ['Computer Science', 'English Literature'], year: 2022, publisher: 'Knopf', description: 'A novel about friendship, art, and the games we play across a lifetime.', cover: 'https://covers.openlibrary.org/b/isbn/9780593321201-L.jpg', totalCopies: 4, availableCopies: 4, averageRating: 4.6, popularity: 88 },
  { title: 'Atomic Habits', author: 'James Clear', isbn: '9780735211292', category: 'Personal growth', genre: ['Psychology', 'Personal growth'], departments: ['Psychology', 'Business Administration'], year: 2018, publisher: 'Avery', description: 'A practical guide to building good habits, breaking bad ones, and getting 1% better every day.', cover: 'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg', totalCopies: 6, availableCopies: 6, averageRating: 4.8, popularity: 96 },
  { title: 'Braiding Sweetgrass', author: 'Robin Wall Kimmerer', isbn: '9781571313560', category: 'Nature', genre: ['Nature', 'Science'], departments: ['Biology', 'Environmental Science'], year: 2013, publisher: 'Milkweed Editions', description: 'A weaving of indigenous wisdom, scientific knowledge, and the teachings of plants.', cover: 'https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg', totalCopies: 3, availableCopies: 3, averageRating: 4.9, popularity: 90 },
  { title: 'Project Hail Mary', author: 'Andy Weir', isbn: '9780593135204', category: 'Science fiction', genre: ['Science fiction', 'Space'], departments: ['Physics', 'Engineering'], year: 2021, publisher: 'Ballantine Books', description: 'A lone astronaut must save the earth from disaster in this science-fiction adventure.', cover: 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg', totalCopies: 5, availableCopies: 5, averageRating: 4.7, popularity: 92 },
  { title: 'The Design of Everyday Things', author: 'Don Norman', isbn: '9780465050659', category: 'Design', genre: ['Design', 'Psychology'], departments: ['Design', 'Architecture'], year: 2013, publisher: 'Basic Books', description: 'An approachable guide to the principles of good design and the everyday objects that shape our lives.', cover: 'https://covers.openlibrary.org/b/isbn/9780465050659-L.jpg', totalCopies: 2, availableCopies: 2, averageRating: 4.5, popularity: 72 },
];

const cleanIsbn = (value) => String(value || '').replace(/[^\dX]/gi, '').toUpperCase();
const normalize = (value) => String(value || '').trim().toLocaleLowerCase();
const languages = { eng: 'English', hin: 'Hindi', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu', mar: 'Marathi', fra: 'French', spa: 'Spanish', deu: 'German', ita: 'Italian', jpn: 'Japanese', chi: 'Chinese', ara: 'Arabic', rus: 'Russian', por: 'Portuguese' };
const mongoTextLanguages = new Set(['danish', 'dutch', 'english', 'finnish', 'french', 'german', 'hungarian', 'italian', 'norwegian', 'portuguese', 'romanian', 'russian', 'spanish', 'swedish', 'turkish']);
const textIndexLanguage = (value) => { const language = String(value || '').trim().toLowerCase(); return mongoTextLanguages.has(language) ? language : 'english'; };
const keyHash = (value) => [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7);
const records = [...starterBooks];
const seenWorks = new Set();
const seenTitles = new Set(starterBooks.map((book) => `${normalize(book.title)}|${normalize(book.author)}`));
const seenIsbns = new Set(starterBooks.map((book) => cleanIsbn(book.isbn)));

async function search(target, offset) {
  const params = new URLSearchParams({ q: `subject:"${target.subject}"`, fields, limit: '100', offset: String(offset) });
  const url = `https://openlibrary.org/search.json?${params}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': 'BookWiseAI/1.0 (library catalogue metadata import)' } });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new Error(`Open Library returned HTTP ${response.status} for ${target.subject}.`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`Open Library did not respond for ${target.subject}. Try the download again later.`);
}

const categoryCounts = new Map(subjects.map((target) => [target.category, 0]));
for (const target of subjects) {
  let addedForCategory = 0;
  for (let offset = 0; offset < 1500 && addedForCategory < perCategoryTarget; offset += 100) {
    const { docs = [] } = await search(target, offset);
    for (const doc of docs) {
      const title = String(doc.title || '').trim().slice(0, 200);
      const authors = Array.isArray(doc.author_name) ? doc.author_name.filter(Boolean) : [];
      const author = authors.join(', ').slice(0, 150);
      const workId = String(doc.key || '').replace(/^\/works\//, '');
      const titleKey = `${normalize(title)}|${normalize(author)}`;
      if (!title || !author || !workId || seenWorks.has(workId) || seenTitles.has(titleKey)) continue;
      const candidateIsbns = Array.isArray(doc.isbn) ? doc.isbn.map(cleanIsbn).filter((isbn) => /^(?:\d{13}|\d{9}[\dX])$/.test(isbn)) : [];
      let isbn = candidateIsbns.find((value) => !seenIsbns.has(value));
      const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false` : candidateIsbns[0] ? `https://covers.openlibrary.org/b/isbn/${candidateIsbns[0]}-L.jpg?default=false` : '';
      if (!cover) continue;
      if (isbn) seenIsbns.add(isbn); else isbn = undefined;
      seenWorks.add(workId);
      seenTitles.add(titleKey);
      const subjectsFound = Array.isArray(doc.subject) ? doc.subject : [];
      const genre = [...new Set(subjectsFound.filter((item) => typeof item === 'string' && item.length > 1 && item.length <= 60))].slice(0, 5);
      const ratingsCount = Math.max(0, Number(doc.ratings_count) || 0);
      const rating = Math.max(0, Math.min(5, Number(doc.ratings_average) || 0));
      const stock = 1 + (keyHash(workId) % 5);
      const languageCode = Array.isArray(doc.language) ? doc.language[0] : '';
      const publicationLanguage = languages[languageCode] || languageCode || 'English';
      records.push({
        openLibraryId: workId,
        title,
        author,
        ...(isbn ? { isbn } : {}),
        category: target.category,
        departments: target.departments,
        genre,
        publisher: (Array.isArray(doc.publisher) ? doc.publisher.find((value) => value && !/^imprint unknown$/i.test(value)) : '')?.slice(0, 150) || '',
        year: Number.isInteger(doc.first_publish_year) && doc.first_publish_year >= 0 ? doc.first_publish_year : undefined,
        numberOfPages: Number.isInteger(doc.number_of_pages_median) && doc.number_of_pages_median > 0 ? doc.number_of_pages_median : undefined,
        language: textIndexLanguage(publicationLanguage),
        publicationLanguage,
        cover,
        description: '',
        totalCopies: stock,
        availableCopies: stock,
        averageRating: rating,
        ratingsCount,
        popularity: ratingsCount,
      });
      addedForCategory += 1;
      if (addedForCategory >= perCategoryTarget) break;
    }
    if (docs.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 1050));
  }
  categoryCounts.set(target.category, addedForCategory);
  console.log(`${target.category}: ${addedForCategory}/${perCategoryTarget} records collected`);
  await new Promise((resolve) => setTimeout(resolve, 1050));
}

if (records.length < targetCount) {
  for (const target of subjects) {
    for (let offset = 0; offset < 2000 && records.length < targetCount; offset += 100) {
      const { docs = [] } = await search(target, offset);
      for (const doc of docs) {
        const title = String(doc.title || '').trim().slice(0, 200);
        const author = (Array.isArray(doc.author_name) ? doc.author_name.filter(Boolean).join(', ') : '').slice(0, 150);
        const workId = String(doc.key || '').replace(/^\/works\//, '');
        const titleKey = `${normalize(title)}|${normalize(author)}`;
        if (!title || !author || !workId || seenWorks.has(workId) || seenTitles.has(titleKey)) continue;
        const candidates = Array.isArray(doc.isbn) ? doc.isbn.map(cleanIsbn).filter((isbn) => /^(?:\d{13}|\d{9}[\dX])$/.test(isbn)) : [];
        let isbn = candidates.find((value) => !seenIsbns.has(value));
        const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false` : candidates[0] ? `https://covers.openlibrary.org/b/isbn/${candidates[0]}-L.jpg?default=false` : '';
        if (!cover) continue;
        if (isbn) seenIsbns.add(isbn); else isbn = undefined;
        seenWorks.add(workId); seenTitles.add(titleKey);
        const genre = [...new Set((Array.isArray(doc.subject) ? doc.subject : []).filter((item) => typeof item === 'string' && item.length > 1 && item.length <= 60))].slice(0, 5);
        const ratingsCount = Math.max(0, Number(doc.ratings_count) || 0);
        const stock = 1 + (keyHash(workId) % 5);
        const languageCode = Array.isArray(doc.language) ? doc.language[0] : '';
        const publicationLanguage = languages[languageCode] || languageCode || 'English';
        records.push({ openLibraryId: workId, title, author, ...(isbn ? { isbn } : {}), category: target.category, departments: target.departments, genre, publisher: (Array.isArray(doc.publisher) ? doc.publisher.find((value) => value && !/^imprint unknown$/i.test(value)) : '')?.slice(0, 150) || '', year: Number.isInteger(doc.first_publish_year) && doc.first_publish_year >= 0 ? doc.first_publish_year : undefined, numberOfPages: Number.isInteger(doc.number_of_pages_median) && doc.number_of_pages_median > 0 ? doc.number_of_pages_median : undefined, language: textIndexLanguage(publicationLanguage), publicationLanguage, cover, description: '', totalCopies: stock, availableCopies: stock, averageRating: Math.max(0, Math.min(5, Number(doc.ratings_average) || 0)), ratingsCount, popularity: ratingsCount });
        if (records.length >= targetCount) break;
      }
      if (docs.length < 100 || records.length >= targetCount) break;
      await new Promise((resolve) => setTimeout(resolve, 1050));
    }
    if (records.length >= targetCount) break;
    await new Promise((resolve) => setTimeout(resolve, 1050));
  }
}

if (records.length < targetCount) throw new Error(`Only collected ${records.length} unique books with cover images; catalogue file was not written.`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(records.slice(0, targetCount), null, 2)}\n`, 'utf8');
console.log(`Wrote ${targetCount} catalogue books to ${outputPath}`);
