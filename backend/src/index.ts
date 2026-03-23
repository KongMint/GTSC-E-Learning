import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import http from 'http';
import { Server } from 'socket.io';

import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import progressRouter from './routes/progress';
import quizRouter from './routes/quiz';
import certificateRouter from './routes/certificate';
import examSessionsRouter from './routes/examSessions';
import { setExamSessionRealtimeHooks } from './routes/examSessions';
import coursesRouter from './routes/courses';
import assignmentsRouter from './routes/assignments';
import notificationsRouter from './routes/notifications';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  socket.on('exam:watch', (sessionId: string) => {
    if (!sessionId) {
      return;
    }

    socket.join(`exam-session:${sessionId}`);
  });

  socket.on('exam:unwatch', (sessionId: string) => {
    if (!sessionId) {
      return;
    }

    socket.leave(`exam-session:${sessionId}`);
  });
});

setExamSessionRealtimeHooks({
  onSessionChanged: () => {
    io.emit('exam:session-changed');
  },
  onPresenceChanged: (payload) => {
    io.emit('exam:presence-stats', {
      sessionId: payload.sessionId,
      joinedCount: payload.joinedCount,
      activeCount: payload.activeCount,
    });
    io.to(`exam-session:${payload.sessionId}`).emit('exam:presence-updated', payload);
  },
});

// mount authentication routes under /api
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', progressRouter);
app.use('/api', quizRouter);
app.use('/api', certificateRouter);
app.use('/api', examSessionsRouter);
app.use('/api', coursesRouter);
app.use('/api', assignmentsRouter);
app.use('/api', notificationsRouter);

app.get('/', (req, res) => {
  res.send('E-learning backend running');
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }

  if (err instanceof Error) {
    return res.status(400).json({ message: err.message });
  }

  return res.status(500).json({ message: 'Internal server error' });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
