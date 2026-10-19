import 'dotenv/config';
import mongoose from 'mongoose';
import { Book } from '../src/models.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env first.');
const books = [
  { title: 'The Midnight Library', author: 'Matt Haig', isbn: '9780525559474', category: 'Fiction', genre: ['Fiction', 'Fantasy'], year: 2020, publisher: 'Viking', description: 'Between life and death there is a library, and within that library, every book offers a chance to try another life.', cover: 'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg', totalCopies: 5, availableCopies: 5, averageRating: 4.8, popularity: 98 },
  { title: 'The Creative Act', author: 'Rick Rubin', isbn: '9780593652886', category: 'Creativity', genre: ['Creativity', 'Art'], year: 2023, publisher: 'Canongate', description: 'A generous course of study that illuminates the path of the artist as a road we can all follow.', cover: 'https://covers.openlibrary.org/b/isbn/9780593652886-L.jpg', totalCopies: 3, availableCopies: 3, averageRating: 4.7, popularity: 81 },
  { title: 'Educated', author: 'Tara Westover', isbn: '9780399590504', category: 'Memoir', genre: ['Memoir', 'Education'], year: 2018, publisher: 'Random House', description: 'A memoir about the struggle for self-invention and the transformative power of education.', cover: 'https://covers.openlibrary.org/b/isbn/9780399590504-L.jpg', totalCopies: 4, availableCopies: 4, averageRating: 4.9, popularity: 93 },
  { title: 'Tomorrow, and Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', isbn: '9780593321201', category: 'Fiction', genre: ['Fiction', 'Technology'], year: 2022, publisher: 'Knopf', description: 'A novel about friendship, art, and the games we play across a lifetime.', cover: 'https://covers.openlibrary.org/b/isbn/9780593321201-L.jpg', totalCopies: 4, availableCopies: 4, averageRating: 4.6, popularity: 88 },
  { title: 'Atomic Habits', author: 'James Clear', isbn: '9780735211292', category: 'Personal growth', genre: ['Psychology', 'Personal growth'], year: 2018, publisher: 'Avery', description: 'A practical guide to building good habits, breaking bad ones, and getting 1% better every day.', cover: 'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg', totalCopies: 6, availableCopies: 6, averageRating: 4.8, popularity: 96 },
  { title: 'Braiding Sweetgrass', author: 'Robin Wall Kimmerer', isbn: '9781571313560', category: 'Nature', genre: ['Nature', 'Science'], year: 2013, publisher: 'Milkweed Editions', description: 'A weaving of indigenous wisdom, scientific knowledge, and the teachings of plants.', cover: 'https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg', totalCopies: 3, availableCopies: 3, averageRating: 4.9, popularity: 90 },
  { title: 'Project Hail Mary', author: 'Andy Weir', isbn: '9780593135204', category: 'Science fiction', genre: ['Science fiction', 'Space'], year: 2021, publisher: 'Ballantine Books', description: 'A lone astronaut must save the earth from disaster in this science-fiction adventure.', cover: 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg', totalCopies: 5, availableCopies: 5, averageRating: 4.7, popularity: 92 },
  { title: 'The Design of Everyday Things', author: 'Don Norman', isbn: '9780465050659', category: 'Design', genre: ['Design', 'Psychology'], year: 2013, publisher: 'Basic Books', description: 'An approachable guide to the principles of good design and the everyday objects that shape our lives.', cover: 'https://covers.openlibrary.org/b/isbn/9780465050659-L.jpg', totalCopies: 2, availableCopies: 2, averageRating: 4.5, popularity: 72 },
];

try {
  await mongoose.connect(process.env.MONGODB_URI);
  if (!await Book.exists({})) {
    await Book.insertMany(books);
    console.log(`Added ${books.length} demo books.`);
  } else console.log('Catalogue already contains books; no demo data was added.');
} finally { await mongoose.disconnect(); }

