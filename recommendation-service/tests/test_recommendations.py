import unittest

from main import Book, RecommendationRequest, SimilarRequest, _rank_for_profile, recommendations, similar_books


def sample_books():
    return [
        Book(id="space", title="Project Hail Mary", author="Andy Weir", description="A space astronaut uses science to save earth", category="Science fiction", genres=["space", "science"], rating=4.8, popularity=80),
        Book(id="habit", title="Atomic Habits", author="James Clear", description="Build habits and improve behavior", category="Personal growth", genres=["psychology"], rating=4.9, popularity=100),
        Book(id="mars", title="The Martian", author="Andy Weir", description="An astronaut survives alone on Mars", category="Science fiction", genres=["space", "science"], rating=4.6, popularity=50),
    ]


class RecommendationTests(unittest.TestCase):
    def test_personal_preferences_rank_related_titles(self):
        result = _rank_for_profile(sample_books(), ["space science fiction"], [], [], [], 3)
        self.assertIn(result[0]["id"], {"space", "mars"})
        self.assertTrue(any(book["id"] == "space" for book in result[:2]))
        self.assertIn("you enjoy", result[0]["reason"])

    def test_borrowed_books_are_excluded_but_inform_personalization(self):
        result = _rank_for_profile(sample_books(), [], ["space"], [], [], 3)
        self.assertNotIn("space", [book["id"] for book in result])
        self.assertEqual(result[0]["id"], "mars")

    def test_cold_start_falls_back_to_popular_books(self):
        result = _rank_for_profile(sample_books(), [], [], [], [], 3)
        self.assertEqual(result[0]["id"], "habit")
        self.assertIn("popular", result[0]["reason"])

    def test_similar_books_excludes_the_selected_book(self):
        result = similar_books(SimilarRequest(books=sample_books(), book_id="space", limit=2))
        self.assertEqual(result["similar_books"][0]["id"], "mars")
        self.assertNotIn("space", [book["id"] for book in result["similar_books"]])

    def test_empty_catalogue_returns_empty_recommendations(self):
        result = recommendations(RecommendationRequest(books=[], limit=3))
        self.assertEqual(result["recommendations"], [])


if __name__ == "__main__":
    unittest.main()
