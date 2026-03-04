import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRouter from './routes/auth';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// mount authentication routes under /api
app.use('/api', authRouter);

app.get('/', (req, res) => {
  res.send('E-learning backend running');
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
