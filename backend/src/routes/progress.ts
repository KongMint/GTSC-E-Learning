import { Router } from 'express';
import jwt from 'jsonwebtoken';

import { users } from './auth';
import { lessons } from './admin';

interface AccessTokenPayload {
  username: string;
  role: 'admin' | 'member';
}

const router = Router();

const completedLessonsByUser: Map<string, Set<string>> = new Map();

const getBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const verifyMember = (authHeader?: string): AccessTokenPayload | null => {
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

const buildProgressPayload = (username: string) => {
  const publishedLessons = lessons.filter((lesson) => lesson.status === 'published');
  const completedSet = completedLessonsByUser.get(username) || new Set<string>();
  const completedLessonIds = publishedLessons
    .filter((lesson) => completedSet.has(lesson.id))
    .map((lesson) => lesson.id);

  const totalLessons = publishedLessons.length;
  const completedCount = completedLessonIds.length;
  const completionPercent = totalLessons === 0 ? 0 : Math.round((completedCount / totalLessons) * 100);

  return {
    completedLessonIds,
    completedCount,
    totalLessons,
    completionPercent,
  };
};

router.get('/progress', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const user = users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  return res.json(buildProgressPayload(member.username));
});

router.post('/progress/complete', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const user = users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  const { lessonId } = req.body as { lessonId?: string };
  if (!lessonId) {
    return res.status(400).json({ message: 'lessonId is required' });
  }

  const lessonExists = lessons.some((lesson) => lesson.id === lessonId && lesson.status === 'published');
  if (!lessonExists) {
    return res.status(404).json({ message: 'Published lesson not found' });
  }

  const current = completedLessonsByUser.get(member.username) || new Set<string>();
  current.add(lessonId);
  completedLessonsByUser.set(member.username, current);

  return res.json(buildProgressPayload(member.username));
});

router.delete('/progress/complete/:lessonId', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const user = users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  const { lessonId } = req.params;
  const current = completedLessonsByUser.get(member.username) || new Set<string>();
  current.delete(lessonId);
  completedLessonsByUser.set(member.username, current);

  return res.json(buildProgressPayload(member.username));
});

export default router;
