# E-Learning Platform

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