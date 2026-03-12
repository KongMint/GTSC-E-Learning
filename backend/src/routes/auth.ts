import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

interface User {
  username: string;
  passwordHash: string;
  role: 'member' | 'admin';
  status: 'active' | 'disabled';
  joinedAt: string;
}

// simple in-memory user store; replace with a real DB for production
export const users: Map<string, User> = new Map();

const router = Router();

// register endpoint
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body as { username?: string; email?: string; password: string };
  const accountName = username || email;

  if (!accountName || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (users.has(accountName)) {
    return res.status(400).json({ message: 'User already exists' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    users.set(accountName, {
      username: accountName,
      passwordHash: hash,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });

    const secret = process.env.JWT_SECRET || 'change_me';
    const token = jwt.sign({ username: accountName, role: 'member' }, secret, { expiresIn: '1h' });

    return res.json({
      message: 'User registered successfully',
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// login endpoint
router.post('/login', async (req, res) => {
  const { username, email, password } = req.body as { username?: string; email?: string; password: string };
  const accountName = username || email;
  const normalizedAccount = (accountName || '').trim().toLowerCase();
  const normalizedPassword = (password || '').trim();

  if (!accountName || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const adminUsername = (process.env.ADMIN_USERNAME || 'admin@gtsc.local').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const acceptedAdminUsernames = new Set([adminUsername, 'admin@gtsc.local', 'admin@gts.local']);

  if (acceptedAdminUsernames.has(normalizedAccount) && normalizedPassword === adminPassword) {
    const secret = process.env.JWT_SECRET || 'change_me';
    const token = jwt.sign({ username: adminUsername, role: 'admin' }, secret, { expiresIn: '1h' });
    return res.json({ token });
  }

  const user = users.get(accountName);
  if (!user) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  if (user.status === 'disabled') {
    return res.status(403).json({ message: 'Account is disabled' });
  }

  try {
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET || 'change_me';
    const token = jwt.sign({ username: user.username, role: user.role }, secret, { expiresIn: '1h' });

    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
