import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bookwise-recommendations")

app = FastAPI(title="BookWise AI Recommendation Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class Book(BaseModel):
    id: str
    title: str
    author: str = ""
    description: str = ""
    category: str = ""
    genres: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    rating: float = Field(default=0, ge=0, le=5)
    popularity: float = Field(default=0, ge=0)
    available: bool = True

    def document(self) -> str:
        parts = [self.title, self.title, self.author, self.description, self.category, *self.genres, *self.departments]
        return " ".join(str(part) for part in parts if part).strip()


class RecommendationRequest(BaseModel):
    books: list[Book] = Field(default_factory=list, max_length=2000)
    preferences: list[str] = Field(default_factory=list, max_length=30)
    history_ids: list[str] = Field(default_factory=list, max_length=500)
    liked_ids: list[str] = Field(default_factory=list, max_length=500)
    exclude_ids: list[str] = Field(default_factory=list, max_length=1000)
    limit: int = Field(default=8, ge=1, le=30)


class SimilarRequest(BaseModel):
    books: list[Book] = Field(default_factory=list, max_length=2000)
    book_id: str
    limit: int = Field(default=8, ge=1, le=30)


def _rank_for_profile(books: list[Book], preferences: list[str], history_ids: list[str], liked_ids: list[str], exclude_ids: list[str], limit: int) -> list[dict[str, Any]]:
    if not books:
        return []
    documents = [book.document() for book in books]
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=50000)
    try:
        matrix = vectorizer.fit_transform(documents)
    except ValueError:
        matrix = None

    by_id = {book.id: index for index, book in enumerate(books)}
    profile_texts: list[str] = [str(pref) for pref in preferences if str(pref).strip()]
    for book_id in [*history_ids, *liked_ids]:
        if book_id in by_id:
            profile_texts.append(documents[by_id[book_id]])

    profile_similarities = [0.0] * len(books)
    personalized = False
    if matrix is not None and profile_texts:
        profile_vector = vectorizer.transform([" ".join(profile_texts)])
        profile_similarities = cosine_similarity(matrix, profile_vector).ravel().tolist()
        personalized = any(value > 0 for value in profile_similarities)

    excluded = set(exclude_ids) | set(history_ids)
    max_popularity = max((book.popularity for book in books), default=0) or 1
    candidates: list[tuple[float, int]] = []
    for index, book in enumerate(books):
        if book.id in excluded:
            continue
        similarity = profile_similarities[index]
        rating_score = book.rating / 5
        popularity_score = book.popularity / max_popularity
        score = 0.72 * similarity + 0.18 * rating_score + 0.10 * popularity_score
        candidates.append((score, index))

    candidates.sort(key=lambda pair: (-pair[0], books[pair[1]].title.casefold()))
    result = []
    for score, index in candidates[:limit]:
        book = books[index]
        if personalized and profile_similarities[index] > 0.01 and (history_ids or liked_ids):
            common = next((genre for genre in book.genres if genre.casefold() in " ".join(preferences).casefold()), None)
            reason = f"Recommended because it is similar to books in your reading history{f' and includes {common}' if common else ''}."
        elif personalized and profile_similarities[index] > 0.01:
            matched = next((term for preference in preferences for term in preference.split() if term.casefold() in book.document().casefold()), None)
            reason = f"Recommended because you enjoy {matched}." if matched else "Recommended to match your reading interests."
        elif book.rating >= 4.5:
            reason = "A popular, highly rated pick from the library collection."
        else:
            reason = "A well-matched title to explore from the library collection."
        result.append({"id": book.id, "title": book.title, "author": book.author, "score": round(float(score), 4), "reason": reason})
    return result


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"ok": True, "service": "bookwise-recommendations", "algorithm": "tfidf-cosine-similarity"}


@app.post("/recommendations")
def recommendations(payload: RecommendationRequest) -> dict[str, Any]:
    try:
        result = _rank_for_profile(payload.books, payload.preferences, payload.history_ids, payload.liked_ids, payload.exclude_ids, payload.limit)
        return {"recommendations": result, "personalized": bool(payload.preferences or payload.history_ids or payload.liked_ids)}
    except Exception as exc:  # Return a safe service error; details stay in server logs.
        logger.exception("Recommendation ranking failed")
        raise HTTPException(status_code=500, detail="Recommendation ranking is temporarily unavailable.") from exc


@app.post("/similar-books")
def similar_books(payload: SimilarRequest) -> dict[str, Any]:
    by_id = {book.id: index for index, book in enumerate(payload.books)}
    if payload.book_id not in by_id:
        raise HTTPException(status_code=404, detail="The requested book is not in the catalogue payload.")
    try:
        vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=50000)
        matrix = vectorizer.fit_transform([book.document() for book in payload.books])
        target_index = by_id[payload.book_id]
        similarities = cosine_similarity(matrix[target_index], matrix).ravel()
        ranked = sorted(((float(score), idx) for idx, score in enumerate(similarities) if idx != target_index), key=lambda row: (-row[0], payload.books[row[1]].title.casefold()))
        recommendations = [
            {"id": payload.books[index].id, "title": payload.books[index].title, "author": payload.books[index].author, "score": round(score, 4), "reason": "Similar themes, author, or catalogue category."}
            for score, index in ranked[:payload.limit]
        ]
        return {"book_id": payload.book_id, "similar_books": recommendations}
    except ValueError:
        return {"book_id": payload.book_id, "similar_books": []}
    except Exception as exc:
        logger.exception("Similar-book ranking failed")
        raise HTTPException(status_code=500, detail="Similar-book search is temporarily unavailable.") from exc
