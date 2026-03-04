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

## Docker & CI/CD

You can add Dockerfiles and compose configuration to containerize services.

---

Ensure Git is initialized and commit changes as needed.