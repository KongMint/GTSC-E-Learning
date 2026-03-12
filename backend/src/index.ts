import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';

import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import progressRouter from './routes/progress';
import quizRouter from './routes/quiz';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// mount authentication routes under /api
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', progressRouter);
app.use('/api', quizRouter);

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
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
