# BookWise AI — Library Management & Book Recommendation

BookWise AI combines library circulation tools with personalized book discovery. Public registration creates student accounts only. An administrator creates librarian accounts and assigns their branch and permissions. Administrator access starts through a one-time local bootstrap command.

## Stack

- **Frontend:** React 18, Vite, Redux Toolkit, React Router, Axios
- **API:** Node.js, Express, Mongoose, MongoDB
- **Authentication:** JWT in an HTTP-only cookie, bcrypt password hashing, role and permission checks
- **Recommendations:** Python FastAPI, scikit-learn TF-IDF and cosine similarity
- **API prefix:** `/api/v1`

## Requirements

Install Node.js 20+, Python 3.10+, and MongoDB Community Server, or create a MongoDB Atlas cluster. Postman is optional and is only used to send API requests; it does not run or connect the services by itself.

## First-time setup on Windows

Run these commands in **PowerShell** from the project root (`D:\New folder\LIB2`). If you use Command Prompt, use the alternative copy command below.

1. Install the Node packages:

   ```powershell
   npm install
   ```

2. Create the backend environment file once:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

   In **Command Prompt**, use `copy backend\.env.example backend\.env` instead. If `backend/.env` already exists, do not overwrite it. Open it in Notepad and check `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_ORIGIN`. Use a private random `JWT_SECRET` with at least 32 characters. For local MongoDB, the example URI uses `mongodb://127.0.0.1:27017/bookwise`. For Atlas, paste the Node.js driver URI from Atlas and replace its password; allow your IP address in Atlas Network Access.

3. Install the Python recommendation dependencies (one time):

   ```powershell
   npm run setup:recommendation
   ```

   This creates `recommendation-service/.venv` and installs FastAPI, Uvicorn, and scikit-learn.

4. Make sure MongoDB is running, then start the frontend, Express API, and FastAPI recommendation service together:

   ```powershell
   npm run dev
   ```

   Open **http://localhost:5173**. The Express API is at **http://localhost:5000/api/v1** and FastAPI is at **http://localhost:8000** (interactive API docs: **http://localhost:8000/docs**). Keep that terminal open while using the app; press `Ctrl+C` to stop the services.

5. Add the sample catalogue and create the first administrator (once each):

   ```powershell
   npm run seed:books
   npm run seed:admin
   ```

   `seed:books` imports the included 1,000-title catalogue. Each entry includes a cover URL, author, category, academic department tags, and available publication metadata. To refresh the source data from Open Library, run `npm run catalogue:download` before seeding. The catalogue can be filtered by category and department; a student's department is also included in personalized recommendation matching. Open Library provides the bibliographic metadata and cover images through its [Search API](https://openlibrary.org/dev/docs/api/search) and [Covers API](https://openlibrary.org/developers/api).

   The admin seeder prints a generated one-time password if you have not configured `BOOTSTRAP_ADMIN_PASSWORD`. Save it securely. Sign in at **http://localhost:5173/login** using `admin@bookwise.local` and the printed password. The app routes that user to `/admin/dashboard`. From there, use **Librarians** to invite staff; copy the generated temporary password and give it to the librarian. Their first sign-in requires a password change. Students register at `/register`; the API always assigns the student role.

## Connecting MongoDB

For a local database, install/start MongoDB Community Server and keep the URI in `backend/.env`, for example:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/bookwise
```

For Atlas, create a database user, allow your current IP under Network Access, copy the Node.js connection string, and paste it as `MONGODB_URI`. Restart `npm run dev` after changing environment values. Confirm the connection at **http://localhost:5000/api/v1/health**; the response reports MongoDB and recommendation-service status.

## How the services connect

```text
React + Redux + Router → Axios → Vite proxy → Express API → Mongoose → MongoDB
                                                    Express API → Axios → FastAPI → scikit-learn
```

`npm run dev` starts Node/Express, Vite, and Python/FastAPI. The API reads `MONGODB_URI` and `RECOMMENDATION_URL` from `backend/.env`; the recommendation service defaults to port 8000. MongoDB still needs to be running locally or reachable in Atlas. These programs cannot install or start MongoDB automatically for you.

## Postman

Import `docs/BookWise.postman_collection.json`, or create requests with base URL `http://localhost:5000/api/v1`. Start with `GET /health`, then send `POST /auth/login` with JSON such as `{"email":"admin@bookwise.local","password":"<your generated password>"}`. Login sets the `bookwise_session` HTTP-only cookie. Postman’s cookie manager should store it for `localhost` and send it on the next request; no JWT needs to be copied into a Bearer field. If it does not, open **Cookies** in Postman and check the `localhost` cookie jar. The browser uses the same cookie automatically through Axios with credentials enabled.

Useful requests include:

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/health` | Public service status |
| `POST` | `/auth/register` | Public student signup |
| `POST` | `/auth/login` | All active accounts; sets cookie |
| `GET` | `/auth/me` | Signed-in account |
| `GET` | `/books` | Public catalogue |
| `POST` | `/books` | Admin or librarian with `books.create` |
| `POST` | `/loans` | Student loan request (staff approval required) |
| `GET` | `/loans/mine` | Student's loans |
| `POST` | `/students/reservations` | Request a copy or join its queue |
| `PATCH` | `/librarian/reservations/:id/approve` | Staff approve pickup; starts a 24-hour collection window |
| `PATCH` | `/librarian/reservations/:id/issue` | Staff verify student in person and issue the book |
| `GET` | `/admin/dashboard` | Admin only |
| `GET` | `/librarian/dashboard` | Librarian with `reports.view` |

FastAPI can be checked at `GET http://localhost:8000/health` or explored at `http://localhost:8000/docs`. The Express API calls FastAPI for recommendations and uses a popular-books fallback if the Python service is unavailable.

Loan requests hold an available copy while waiting for staff approval. After approval, the student has 24 hours to collect it in person; staff verify their identity and issue the loan at the desk. A missed pickup expires automatically, releases the copy to the next reader, and records the configurable no-show fee (`reservationNoShowFee`, default $5) in the student account notices and reservation history. Configure the fee in Admin → Library settings.

## Tests and production notes

Run `npm test` for the backend permission and Python recommendation tests. To run backend integration tests against a separate local test database in PowerShell:

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/bookwise_test'
npm run test:integration --workspace server
Remove-Item Env:\TEST_MONGODB_URI
```

Use MongoDB Atlas or a managed MongoDB service, HTTPS, a production secret manager, and configured SMTP before deployment. Password recovery sends email only when SMTP is configured in `backend/.env`. Keep `.env` files and bootstrap credentials private; never commit them.
