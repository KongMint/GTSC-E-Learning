import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';

import { UserRole, users } from './auth';
import { assignments, submissions } from './assignments';
import { sessions } from './examSessions';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

type NotificationType = 'assignment_due' | 'assignment_overdue' | 'assignment_graded' | 'exam_upcoming' | 'exam_live';

interface MemberNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actionLabel?: string;
}

const router = Router();
const readByUser: Map<string, Set<string>> = new Map();

const normalizeAccount = (value?: string) => (value || '').trim().toLowerCase();

const getBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const parsePayload = (authHeader?: string): AccessTokenPayload | null => {
  const token = getBearerToken(authHeader);
  if (!token) {
    return null;
  }

  try {
    const secret = process.env.JWT_SECRET || 'change_me';
    return jwt.verify(token, secret) as AccessTokenPayload;
  } catch {
    return null;
  }
};

const verifyMember = (req: Request, res: Response): AccessTokenPayload | null => {
  const payload = parsePayload(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ message: 'Invalid or missing access token' });
    return null;
  }

  if (payload.role !== 'member') {
    res.status(403).json({ message: 'Member privileges are required' });
    return null;
  }

  const normalized = normalizeAccount(payload.username);
  const user = users.get(normalized) || users.get(payload.username);
  if (!user || user.role !== 'member') {
    res.status(404).json({ message: 'Member account not found' });
    return null;
  }

  if (user.status === 'disabled') {
    res.status(403).json({ message: 'Account is disabled' });
    return null;
  }

  return payload;
};

const getReadSet = (username: string) => {
  const normalized = normalizeAccount(username);
  if (!readByUser.has(normalized)) {
    readByUser.set(normalized, new Set<string>());
  }

  return readByUser.get(normalized)!;
};

const buildNotificationsForMember = (username: string): MemberNotification[] => {
  const normalized = normalizeAccount(username);
  const now = Date.now();
  const readSet = getReadSet(username);
  const notifications: MemberNotification[] = [];

  assignments
    .filter((assignment) => assignment.status === 'published')
    .forEach((assignment) => {
      const dueAt = new Date(assignment.dueAt);
      if (Number.isNaN(dueAt.getTime())) {
        return;
      }

      const memberSubmission = submissions.find(
        (item) => item.assignmentId === assignment.id && normalizeAccount(item.username) === normalized
      );

      if (!memberSubmission) {
        const msUntilDue = dueAt.getTime() - now;
        if (msUntilDue > 0 && msUntilDue <= 48 * 60 * 60 * 1000) {
          const id = `assignment-due-${assignment.id}`;
          notifications.push({
            id,
            type: 'assignment_due',
            title: `Sắp đến hạn: ${assignment.title}`,
            message: `Bài tập đến hạn vào ${dueAt.toLocaleString('vi-VN')}.`,
            createdAt: assignment.updatedAt,
            read: readSet.has(id),
            actionLabel: 'Mở bài tập',
          });
        }

        if (msUntilDue <= 0) {
          const id = `assignment-overdue-${assignment.id}`;
          notifications.push({
            id,
            type: 'assignment_overdue',
            title: `Đã quá hạn: ${assignment.title}`,
            message: `Bài tập đã quá hạn từ ${dueAt.toLocaleString('vi-VN')}.`,
            createdAt: assignment.updatedAt,
            read: readSet.has(id),
            actionLabel: 'Xem lại bài tập',
          });
        }
      }

      if (memberSubmission && typeof memberSubmission.score === 'number' && memberSubmission.gradedAt) {
        const gradedAt = new Date(memberSubmission.gradedAt);
        const id = `assignment-graded-${memberSubmission.id}-${memberSubmission.gradedAt}`;
        notifications.push({
          id,
          type: 'assignment_graded',
          title: `Đã chấm điểm: ${assignment.title}`,
          message: `Bạn được ${memberSubmission.score}/${assignment.maxScore}.`,
          createdAt: gradedAt.toISOString(),
          read: readSet.has(id),
          actionLabel: 'Xem phản hồi',
        });
      }
    });

  sessions.forEach((session) => {
    const startAt = new Date(session.scheduledAt);
    if (Number.isNaN(startAt.getTime())) {
      return;
    }

    const msUntilStart = startAt.getTime() - now;

    if (session.status === 'scheduled' && msUntilStart > 0 && msUntilStart <= 12 * 60 * 60 * 1000) {
      const id = `exam-upcoming-${session.id}`;
      notifications.push({
        id,
        type: 'exam_upcoming',
        title: `Buổi thi sắp diễn ra: ${session.title}`,
        message: `Bắt đầu lúc ${startAt.toLocaleString('vi-VN')}.`,
        createdAt: session.updatedAt,
        read: readSet.has(id),
        actionLabel: 'Mở buổi thi',
      });
    }

    if (session.status === 'live') {
      const id = `exam-live-${session.id}`;
      notifications.push({
        id,
        type: 'exam_live',
        title: `Buổi thi đang LIVE: ${session.title}`,
        message: 'Bạn có thể vào phòng thi ngay bây giờ.',
        createdAt: session.updatedAt,
        read: readSet.has(id),
        actionLabel: 'Vào phòng thi',
      });
    }
  });

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return notifications;
};

router.get('/notifications', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const items = buildNotificationsForMember(member.username);
  const unreadCount = items.filter((item) => !item.read).length;

  return res.json({ notifications: items, unreadCount });
});

router.post('/notifications/read-all', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const items = buildNotificationsForMember(member.username);
  const readSet = getReadSet(member.username);
  items.forEach((item) => readSet.add(item.id));

  return res.json({ success: true, readCount: items.length });
});

router.patch('/notifications/:notificationId/read', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { notificationId } = req.params;
  if (!notificationId) {
    return res.status(400).json({ message: 'notificationId is required' });
  }

  const readSet = getReadSet(member.username);
  readSet.add(notificationId);
  return res.json({ success: true, notificationId });
});

export default router;
