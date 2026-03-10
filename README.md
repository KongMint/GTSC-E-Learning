# E-Learning Platform

This workspace contains a full-stack e-learning platform scaffolded with React (frontend) and Node.js/Express (backend) using TypeScript.

## Authentication

The project now includes basic login and registration functionality:

- **Backend**: `POST /api/register` and `POST /api/login`. Users are stored in an in-memory map with hashed passwords; JSON Web Tokens (JWT) are returned on successful login. The JWT secret can be configured via `backend/.env`.
- **Frontend**: modal components allow users to sign up or sign in. The navigation bar shows "Đăng nhập" and "Đăng ký" buttons which open forms that call the backend APIs.

To start the project, run the frontend and backend servers separately (see their respective `package.json` scripts).


This workspace contains a full-stack e-learning platform scaffolded with React (frontend) and Node.js/Express (backend) using TypeScript.

## Directories

- `frontend/` - React app
- `backend/` - Express API server

## Setup

### Frontend

```bash
cd frontend
npm install
npm start
```

### Backend

```bash
cd backend
npm install
npm run dev          # for development with hot reload
npm run build         # compile TypeScript
npm start             # run production build
```

Use `.env` based on `.env.example` in backend to configure environment.

## Environment Variables

### Backend (`backend/.env`)

```bash
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/elearning
JWT_SECRET=replace_with_a_strong_secret
ADMIN_USERNAME=admin@gtsc.local
ADMIN_PASSWORD=admin123
BACKEND_BASE_URL=https://your-backend-domain.com
```

### Frontend (`frontend/.env`)

```bash
REACT_APP_API_URL=https://your-backend-domain.com
```

For local development, you can leave `REACT_APP_API_URL` empty and continue using the CRA proxy.

## Deploy Guide (Vercel + Render)

### 1. Push code to GitHub

Commit and push both frontend and backend code to a GitHub repository.

### 2. Deploy backend to Render

1. Create a new **Web Service** from your GitHub repo.
2. Set **Root Directory** to `backend`.
3. Set **Build Command** to:

```bash
npm install
npm run build
```

4. Set **Start Command** to:

```bash
npm start
```

5. Add backend environment variables from `backend/.env`.
6. Deploy and copy the backend URL (for example: `https://api-your-app.onrender.com`).

### 3. Deploy frontend to Vercel

1. Import the same GitHub repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Framework preset: `Create React App`.
4. Add env variable:

```bash
REACT_APP_API_URL=https://api-your-app.onrender.com
```

5. Deploy and get your frontend URL.

### 4. Verify production flow

After both services are live, verify:

1. Register/login member account.
2. Login admin account.
3. Upload lesson link/PDF in admin page.
4. Member dashboard can open uploaded PDFs.

## Docker & CI/CD

You can add Dockerfiles and compose configuration to containerize services.

---

Ensure Git is initialized and commit changes as needed.