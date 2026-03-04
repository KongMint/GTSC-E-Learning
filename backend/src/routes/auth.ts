import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

interface User {
  username: string;
  passwordHash: string;
}

// simple in-memory user store; replace with a real DB for production
const users: Map<string, User> = new Map();

const router = Router();

// register endpoint
router.post('/register', async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (users.has(username)) {
    return res.status(400).json({ message: 'User already exists' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    users.set(username, { username, passwordHash: hash });
    return res.json({ message: 'User registered successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// login endpoint
router.post('/login', async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const user = users.get(username);
  if (!user) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  try {
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET || 'change_me';
    const token = jwt.sign({ username: user.username }, secret, { expiresIn: '1h' });

    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
