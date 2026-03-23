import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

import { isStaffRole, saveUsersToDisk, UserRole, users } from './auth';

interface AdminTokenPayload {
  username: string;
  role: UserRole;
}

interface Lesson {
  id: string;
  courseTitle: string;
  moduleTitle: string;
  orderInModule: number;
  title: string;
  description: string;
  contentType: 'link' | 'pdf';
  contentUrl: string;
  status: 'draft' | 'published';
  createdBy: string;
  updatedAt: string;
  publishedAt: string;
}

const router = Router();
export const lessons: Lesson[] = [];
const uploadsDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${sanitizedName}`);
  },
});

const uploadPdf = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }

    cb(null, true);
  },
});

const getBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const verifyAdmin = (req: Request, res: Response): AdminTokenPayload | null => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ message: 'Missing access token' });
    return null;
  }

  try {
    const secret = process.env.JWT_SECRET || 'change_me';
    const payload = jwt.verify(token, secret) as AdminTokenPayload;

    if (!isStaffRole(payload.role)) {
      res.status(403).json({ message: 'Admin privileges are required' });
      return null;
    }

    return payload;
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return null;
  }
};

router.post('/login', (req, res) => {
  const { username, email, password } = req.body as { username?: string; email?: string; password?: string };
  const loginName = (username || email || '').trim().toLowerCase();
  const normalizedPassword = (password || '').trim();

  const adminUsername = (process.env.ADMIN_USERNAME || 'admin@gtsc.local').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const acceptedAdminUsernames = new Set([adminUsername, 'admin@gtsc.local', 'admin@gts.local']);

  if (!loginName || !normalizedPassword) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (!acceptedAdminUsernames.has(loginName) || normalizedPassword !== adminPassword) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }

  if (!users.has(adminUsername)) {
    users.set(adminUsername, {
      username: adminUsername,
      passwordHash: '',
      role: 'super_admin',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    saveUsersToDisk();
  }

  const secret = process.env.JWT_SECRET || 'change_me';
  const token = jwt.sign({ username: adminUsername, role: 'super_admin' }, secret, { expiresIn: '4h' });

  return res.json({
    token,
    admin: {
      username: adminUsername,
      displayName: 'System Admin',
    },
  });
});

router.post('/refresh-token', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const secret = process.env.JWT_SECRET || 'change_me';
  const token = jwt.sign({ username: admin.username, role: admin.role }, secret, { expiresIn: '4h' });

  return res.json({
    token,
    admin: {
      username: admin.username,
      displayName: admin.username,
      role: admin.role,
    },
  });
});

router.get('/members', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const members = Array.from(users.values())
    .filter((user) => user.role === 'member')
    .map((user) => ({
      username: user.username,
      role: user.role,
      status: user.status,
      joinedAt: user.joinedAt,
    }));

  return res.json({ members });
});

router.patch('/members/:username/status', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { username } = req.params;
  const { status } = req.body as { status?: 'active' | 'disabled' };

  if (status !== 'active' && status !== 'disabled') {
    return res.status(400).json({ message: 'Status must be active or disabled' });
  }

  const member = users.get(username);
  if (!member || member.role !== 'member') {
    return res.status(404).json({ message: 'Member not found' });
  }

  member.status = status;
  users.set(username, member);
  saveUsersToDisk();

  return res.json({ message: 'Member status updated successfully' });
});

router.get('/users', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const allUsers = Array.from(users.values()).map((user) => ({
    username: user.username,
    role: user.role,
    status: user.status,
    joinedAt: user.joinedAt,
  }));

  return res.json({ users: allUsers });
});

router.patch('/users/:username/role', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  if (admin.role !== 'super_admin') {
    return res.status(403).json({ message: 'Only super admin can change roles' });
  }

  const { username } = req.params;
  const { role } = req.body as { role?: UserRole };

  const allowedRoles: UserRole[] = ['super_admin', 'instructor', 'teaching_assistant', 'member'];
  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  const targetKey = (username || '').trim().toLowerCase();
  const targetUser = users.get(targetKey) || users.get(username);
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (targetUser.username.toLowerCase() === admin.username.toLowerCase() && role === 'member') {
    return res.status(400).json({ message: 'Super admin cannot downgrade own account to member' });
  }

  targetUser.role = role;
  users.set(targetKey, targetUser);
  saveUsersToDisk();

  return res.json({
    message: 'User role updated successfully',
    user: {
      username: targetUser.username,
      role: targetUser.role,
      status: targetUser.status,
      joinedAt: targetUser.joinedAt,
    },
  });
});

router.get('/lessons', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  return res.json({ lessons });
});

router.post('/lessons', uploadPdf.single('pdfFile'), (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { courseTitle, moduleTitle, orderInModule, title, description, contentType, contentUrl, status } = req.body as {
    courseTitle?: string;
    moduleTitle?: string;
    orderInModule?: string | number;
    title?: string;
    description?: string;
    contentType?: 'link' | 'pdf';
    contentUrl?: string;
    status?: 'draft' | 'published';
  };

  if (!courseTitle || !moduleTitle || !title || !description || !contentType) {
    return res.status(400).json({ message: 'courseTitle, moduleTitle, title, description and contentType are required' });
  }

  if (contentType !== 'link' && contentType !== 'pdf') {
    return res.status(400).json({ message: 'contentType must be link or pdf' });
  }

  const normalizedStatus = status === 'draft' ? 'draft' : 'published';
  const normalizedOrder = Number(orderInModule);
  if (!Number.isFinite(normalizedOrder) || normalizedOrder < 1) {
    return res.status(400).json({ message: 'orderInModule must be a number greater than 0' });
  }

  let finalContentUrl = contentUrl;

  if (contentType === 'link') {
    if (!contentUrl) {
      return res.status(400).json({ message: 'contentUrl is required for link content' });
    }
  }

  if (contentType === 'pdf') {
    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required for pdf content type' });
    }

    const backendBaseUrl = process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
    finalContentUrl = `${backendBaseUrl}/uploads/${req.file.filename}`;
  }

  const newLesson: Lesson = {
    id: `lesson-${Date.now()}`,
    courseTitle,
    moduleTitle,
    orderInModule: Math.floor(normalizedOrder),
    title,
    description,
    contentType,
    contentUrl: finalContentUrl as string,
    status: normalizedStatus,
    createdBy: admin.username,
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  };

  lessons.unshift(newLesson);
  return res.status(201).json({ lesson: newLesson });
});

router.patch('/lessons/:lessonId/status', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { lessonId } = req.params;
  const { status } = req.body as { status?: 'draft' | 'published' };

  if (status !== 'draft' && status !== 'published') {
    return res.status(400).json({ message: 'status must be draft or published' });
  }

  const lesson = lessons.find((item) => item.id === lessonId);
  if (!lesson) {
    return res.status(404).json({ message: 'Lesson not found' });
  }

  lesson.status = status;
  lesson.updatedAt = new Date().toISOString();
  if (status === 'published') {
    lesson.publishedAt = new Date().toISOString();
  }

  return res.json({ lesson });
});

router.get('/public-lessons', (_req, res) => {
  const publishedLessons = lessons.filter((lesson) => lesson.status === 'published');
  return res.json({ lessons: publishedLessons });
});

export default router;
