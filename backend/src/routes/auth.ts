import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

interface User {
  username: string;
  passwordHash: string;
  role: UserRole;
  status: 'active' | 'disabled';
  joinedAt: string;
}

export type UserRole = 'super_admin' | 'instructor' | 'teaching_assistant' | 'member';

const STAFF_ROLES: UserRole[] = ['super_admin', 'instructor', 'teaching_assistant'];

export const isStaffRole = (role?: string): role is Exclude<UserRole, 'member'> =>
  STAFF_ROLES.includes(role as Exclude<UserRole, 'member'>);

interface ResetCodeEntry {
  code: string;
  expiresAt: number;
}

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

// simple in-memory user store; replace with a real DB for production
export const users: Map<string, User> = new Map();
const passwordResetCodes: Map<string, ResetCodeEntry> = new Map();

const USERS_DATA_DIR = path.join(process.cwd(), 'data');
const USERS_DATA_FILE = path.join(USERS_DATA_DIR, 'users.json');

const smtpHost = (process.env.SMTP_HOST || '').trim();
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = (process.env.SMTP_USER || '').trim();
const smtpPass = process.env.SMTP_PASS || '';
const smtpFrom = (process.env.SMTP_FROM || smtpUser || 'no-reply@gtsc.local').trim();
const resetCodeDebug = String(process.env.RESET_CODE_DEBUG || 'false').toLowerCase() === 'true';

const emailTransporter =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })
    : null;

const normalizeAccount = (value?: string) => (value || '').trim().toLowerCase();

const getBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const verifyMemberToken = (authHeader?: string): AccessTokenPayload | null => {
  const token = getBearerToken(authHeader);
  if (!token) {
    return null;
  }

  try {
    const secret = process.env.JWT_SECRET || 'change_me';
    const payload = jwt.verify(token, secret) as AccessTokenPayload;
    if (payload.role !== 'member') {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

const sendResetCodeEmail = async (recipient: string, code: string) => {
  if (!emailTransporter) {
    throw new Error('Email service is not configured');
  }

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">Yeu cau dat lai mat khau</h2>
      <p>Ban vua yeu cau dat lai mat khau cho tai khoan hoc vien.</p>
      <p>Ma xac nhan cua ban la:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 10px 0;">${code}</p>
      <p>Ma co hieu luc trong 10 phut.</p>
      <p style="margin-top: 20px; color: #6b7280;">Neu khong phai ban thuc hien, vui long bo qua email nay.</p>
    </div>
  `;

  await emailTransporter.sendMail({
    from: smtpFrom,
    to: recipient,
    subject: 'Ma xac nhan dat lai mat khau',
    text: `Ma xac nhan dat lai mat khau cua ban la ${code}. Ma co hieu luc trong 10 phut.`,
    html,
  });
};

export const saveUsersToDisk = () => {
  try {
    if (!fs.existsSync(USERS_DATA_DIR)) {
      fs.mkdirSync(USERS_DATA_DIR, { recursive: true });
    }

    const payload = Array.from(users.entries()).map(([key, user]) => ({
      key,
      user,
    }));

    fs.writeFileSync(USERS_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save users data', error);
  }
};

const loadUsersFromDisk = () => {
  try {
    if (!fs.existsSync(USERS_DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(USERS_DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return;
    }

    parsed.forEach((item) => {
      if (!item?.key || !item?.user?.username || !item?.user?.passwordHash) {
        return;
      }

      users.set(item.key, {
        username: item.user.username,
        passwordHash: item.user.passwordHash,
        role:
          item.user.role === 'admin'
            ? 'super_admin'
            : item.user.role === 'super_admin' ||
                item.user.role === 'instructor' ||
                item.user.role === 'teaching_assistant' ||
                item.user.role === 'member'
              ? item.user.role
              : 'member',
        status: item.user.status === 'disabled' ? 'disabled' : 'active',
        joinedAt: item.user.joinedAt || new Date().toISOString(),
      });
    });
  } catch (error) {
    console.error('Failed to load users data', error);
  }
};

loadUsersFromDisk();

const router = Router();

router.get('/profile', (req, res) => {
  const member = verifyMemberToken(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const user = users.get(normalizeAccount(member.username));
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  return res.json({
    profile: {
      username: user.username,
      role: user.role,
      status: user.status,
      joinedAt: user.joinedAt,
    },
  });
});

router.post('/profile/change-password', async (req, res) => {
  const member = verifyMemberToken(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required' });
  }

  if (newPassword.trim().length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }

  const accountKey = normalizeAccount(member.username);
  const user = users.get(accountKey);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  try {
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    }

    const nextHash = await bcrypt.hash(newPassword.trim(), 10);
    users.set(accountKey, {
      ...user,
      passwordHash: nextHash,
    });
    saveUsersToDisk();

    return res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/forgot-password/request', async (req, res) => {
  const { email } = req.body as { email?: string };
  const accountKey = normalizeAccount(email);
  const recipient = (email || '').trim();

  if (!accountKey) {
    return res.status(400).json({ message: 'Email is required' });
  }

  const user = users.get(accountKey);
  const genericMessage = 'Nếu email hợp lệ, mã xác nhận đã được gửi. Mã có hiệu lực trong 10 phút.';

  if (!user) {
    return res.json({ message: genericMessage, expiresInMinutes: 10 });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  passwordResetCodes.set(accountKey, { code, expiresAt });

  try {
    await sendResetCodeEmail(recipient, code);

    const responseBody: { message: string; expiresInMinutes: number; resetCode?: string } = {
      message: genericMessage,
      expiresInMinutes: 10,
    };

    if (resetCodeDebug) {
      responseBody.resetCode = code;
    }

    return res.json(responseBody);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể gửi email xác nhận. Vui lòng thử lại sau.' });
  }
});

router.post('/forgot-password/confirm', async (req, res) => {
  const { email, code, newPassword } = req.body as {
    email?: string;
    code?: string;
    newPassword?: string;
  };
  const accountKey = normalizeAccount(email);

  if (!accountKey || !code || !newPassword) {
    return res.status(400).json({ message: 'Email, mã xác nhận và mật khẩu mới là bắt buộc' });
  }

  if (newPassword.trim().length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }

  const user = users.get(accountKey);
  if (!user) {
    return res.status(400).json({ message: 'Email chưa được đăng ký' });
  }

  const resetEntry = passwordResetCodes.get(accountKey);
  if (!resetEntry) {
    return res.status(400).json({ message: 'Bạn chưa yêu cầu mã xác nhận' });
  }

  if (Date.now() > resetEntry.expiresAt) {
    passwordResetCodes.delete(accountKey);
    return res.status(400).json({ message: 'Mã xác nhận đã hết hạn' });
  }

  if (resetEntry.code !== code.trim()) {
    return res.status(400).json({ message: 'Mã xác nhận không đúng' });
  }

  try {
    const nextHash = await bcrypt.hash(newPassword.trim(), 10);
    users.set(accountKey, {
      ...user,
      passwordHash: nextHash,
    });
    passwordResetCodes.delete(accountKey);
    saveUsersToDisk();

    return res.json({ message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập lại.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// register endpoint
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body as { username?: string; email?: string; password: string };
  const accountName = (username || email || '').trim();
  const accountKey = normalizeAccount(accountName);

  if (!accountName || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (users.has(accountKey)) {
    return res.status(400).json({ message: 'User already exists' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    users.set(accountKey, {
      username: accountName,
      passwordHash: hash,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    saveUsersToDisk();

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
  const normalizedAccount = normalizeAccount(accountName);
  const normalizedPassword = (password || '').trim();

  if (!accountName || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const adminUsername = (process.env.ADMIN_USERNAME || 'admin@gtsc.local').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const acceptedAdminUsernames = new Set([adminUsername, 'admin@gtsc.local', 'admin@gts.local']);

  if (acceptedAdminUsernames.has(normalizedAccount) && normalizedPassword === adminPassword) {
    const secret = process.env.JWT_SECRET || 'change_me';
    const token = jwt.sign({ username: adminUsername, role: 'super_admin' }, secret, { expiresIn: '1h' });
    return res.json({ token });
  }

  const user = users.get(normalizedAccount) || users.get((accountName || '').trim());
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
