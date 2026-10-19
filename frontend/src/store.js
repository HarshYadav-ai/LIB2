import { configureStore, createSlice } from '@reduxjs/toolkit';

const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, loading: true },
  reducers: {
    sessionLoaded(state, action) { state.user = action.payload || null; state.loading = false; },
    signedIn(state, action) { state.user = action.payload; state.loading = false; },
    signedOut(state) { state.user = null; state.loading = false; },
    profileUpdated(state, action) { state.user = action.payload; },
  },
});

const catalogSlice = createSlice({
  name: 'catalog', initialState: { query: '', category: 'All books', sort: 'popular', availableOnly: false, minRating: 0 },
  reducers: {
    setQuery(state, action) { state.query = action.payload; },
    setCategory(state, action) { state.category = action.payload; },
    setSort(state, action) { state.sort = action.payload; },
    setAvailableOnly(state, action) { state.availableOnly = action.payload; },
    setMinRating(state, action) { state.minRating = action.payload; },
    resetFilters(state) { state.query = ''; state.category = 'All books'; state.sort = 'popular'; state.availableOnly = false; state.minRating = 0; },
  },
});

const librarySlice = createSlice({
  name: 'library', initialState: { loans: [], reservations: [], recommendations: [] },
  reducers: {
    setLoans(state, action) { state.loans = action.payload; },
    setReservations(state, action) { state.reservations = action.payload; },
    setRecommendations(state, action) { state.recommendations = action.payload; },
    clearLibrary(state) { state.loans = []; state.reservations = []; state.recommendations = []; },
  },
});

export const { sessionLoaded, signedIn, signedOut, profileUpdated } = authSlice.actions;
export const { setQuery, setCategory, setSort, setAvailableOnly, setMinRating, resetFilters } = catalogSlice.actions;
export const { setLoans, setReservations, setRecommendations, clearLibrary } = librarySlice.actions;
export const store = configureStore({ reducer: { auth: authSlice.reducer, catalog: catalogSlice.reducer, library: librarySlice.reducer } });
