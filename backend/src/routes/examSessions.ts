import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';

import { isStaffRole, UserRole, users } from './auth';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

interface ExamSession {
  id: string;
  title: string;
  description: string;
  scheduledAt: string;
  durationMinutes: number;
  status: 'scheduled' | 'live' | 'ended';
  participantUsernames: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

interface SessionPresence {
  username: string;
  joinedAt: string;
  lastSeenAt: string;
}

interface PresencePayload {
  sessionId: string;
  joinedCount: number;
  activeCount: number;
  activeParticipants: SessionPresence[];
}

interface RealtimeHooks {
  onSessionChanged: () => void;
  onPresenceChanged: (payload: PresencePayload) => void;
}

const router = Router();
export const sessions: ExamSession[] = [];
const presenceBySession: Map<string, Map<string, SessionPresence>> = new Map();
const ACTIVE_WINDOW_MS = 45 * 1000;
let realtimeHooks: RealtimeHooks | null = null;

export const setExamSessionRealtimeHooks = (hooks: RealtimeHooks) => {
  realtimeHooks = hooks;
};

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

const verifyAdmin = (req: Request, res: Response): AccessTokenPayload | null => {
  const payload = parsePayload(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ message: 'Invalid or missing access token' });
    return null;
  }

  if (!isStaffRole(payload.role)) {
    res.status(403).json({ message: 'Admin privileges are required' });
    return null;
  }

  return payload;
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

const isMemberAllowedInSession = (session: ExamSession, username: string): boolean => {
  if (session.participantUsernames.length === 0) {
    return true;
  }

  return session.participantUsernames.includes(normalizeAccount(username));
};

const getPresenceStats = (sessionId: string) => {
  const now = Date.now();
  const presences = Array.from(presenceBySession.get(sessionId)?.values() || []);
  const activeParticipants = presences.filter(
    (presence) => now - new Date(presence.lastSeenAt).getTime() <= ACTIVE_WINDOW_MS
  );

  return {
    joinedCount: presences.length,
    activeCount: activeParticipants.length,
    activeParticipants,
  };
};

const emitSessionChanged = () => {
  realtimeHooks?.onSessionChanged();
};

const emitPresenceChanged = (sessionId: string) => {
  const stats = getPresenceStats(sessionId);
  realtimeHooks?.onPresenceChanged({
    sessionId,
    joinedCount: stats.joinedCount,
    activeCount: stats.activeCount,
    activeParticipants: stats.activeParticipants,
  });
};

router.get('/admin/exam-sessions', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const enriched = sessions.map((session) => {
    const stats = getPresenceStats(session.id);
    return {
      ...session,
      joinedCount: stats.joinedCount,
      activeCount: stats.activeCount,
    };
  });

  return res.json({ sessions: enriched });
});

router.post('/admin/exam-sessions', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { title, description, scheduledAt, durationMinutes, participantUsernames } = req.body as {
    title?: string;
    description?: string;
    scheduledAt?: string;
    durationMinutes?: number;
    participantUsernames?: string[];
  };

  if (!title || !scheduledAt || !Number.isFinite(durationMinutes)) {
    return res.status(400).json({ message: 'title, scheduledAt and durationMinutes are required' });
  }

  const parsedDate = new Date(scheduledAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({ message: 'scheduledAt is invalid' });
  }

  const normalizedDuration = Number(durationMinutes);
  if (!Number.isInteger(normalizedDuration) || normalizedDuration < 5 || normalizedDuration > 360) {
    return res.status(400).json({ message: 'durationMinutes must be an integer from 5 to 360' });
  }

  const normalizedParticipants = Array.isArray(participantUsernames)
    ? Array.from(new Set(participantUsernames.map((item) => normalizeAccount(item)).filter(Boolean)))
    : [];

  const session: ExamSession = {
    id: `session-${Date.now()}`,
    title: title.trim(),
    description: (description || '').trim(),
    scheduledAt: parsedDate.toISOString(),
    durationMinutes: normalizedDuration,
    status: 'scheduled',
    participantUsernames: normalizedParticipants,
    createdBy: admin.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  sessions.unshift(session);
  emitSessionChanged();
  return res.status(201).json({ session });
});

router.patch('/admin/exam-sessions/:sessionId/status', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { sessionId } = req.params;
  const { status } = req.body as { status?: 'scheduled' | 'live' | 'ended' };

  if (status !== 'scheduled' && status !== 'live' && status !== 'ended') {
    return res.status(400).json({ message: 'status must be scheduled, live or ended' });
  }

  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  session.status = status;
  session.updatedAt = new Date().toISOString();
  if (status === 'live') {
    session.startedAt = new Date().toISOString();
    session.endedAt = undefined;
  }

  if (status === 'ended') {
    session.endedAt = new Date().toISOString();
  }

  if (status === 'scheduled') {
    session.startedAt = undefined;
    session.endedAt = undefined;
  }

  emitSessionChanged();
  emitPresenceChanged(session.id);

  return res.json({ session });
});

router.get('/exam-sessions', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const normalizedUser = normalizeAccount(member.username);
  const visibleSessions = sessions
    .filter((session) => session.status !== 'ended')
    .filter((session) => isMemberAllowedInSession(session, normalizedUser))
    .map((session) => {
      const stats = getPresenceStats(session.id);
      const joined = Array.from(presenceBySession.get(session.id)?.keys() || []).includes(normalizedUser);
      return {
        ...session,
        joined,
        joinedCount: stats.joinedCount,
        activeCount: stats.activeCount,
      };
    });

  return res.json({ sessions: visibleSessions });
});

router.post('/exam-sessions/:sessionId/join', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { sessionId } = req.params;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  const normalizedUser = normalizeAccount(member.username);
  if (!isMemberAllowedInSession(session, normalizedUser)) {
    return res.status(403).json({ message: 'You are not assigned to this session' });
  }

  if (session.status !== 'live') {
    return res.status(400).json({ message: 'Session is not live yet' });
  }

  const map = presenceBySession.get(sessionId) || new Map<string, SessionPresence>();
  const now = new Date().toISOString();
  const existing = map.get(normalizedUser);
  map.set(normalizedUser, {
    username: normalizedUser,
    joinedAt: existing?.joinedAt || now,
    lastSeenAt: now,
  });
  presenceBySession.set(sessionId, map);
  emitPresenceChanged(sessionId);

  return res.json({ joined: true, presence: map.get(normalizedUser) });
});

router.post('/exam-sessions/:sessionId/ping', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { sessionId } = req.params;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  const normalizedUser = normalizeAccount(member.username);
  const map = presenceBySession.get(sessionId);
  if (!map || !map.has(normalizedUser)) {
    return res.status(400).json({ message: 'You have not joined this session' });
  }

  const current = map.get(normalizedUser)!;
  map.set(normalizedUser, {
    ...current,
    lastSeenAt: new Date().toISOString(),
  });
  emitPresenceChanged(sessionId);

  return res.json({ ok: true });
});

router.post('/exam-sessions/:sessionId/leave', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { sessionId } = req.params;
  const normalizedUser = normalizeAccount(member.username);
  const map = presenceBySession.get(sessionId);
  if (map) {
    map.delete(normalizedUser);
    presenceBySession.set(sessionId, map);
  }
  emitPresenceChanged(sessionId);

  return res.json({ left: true });
});

router.get('/exam-sessions/:sessionId/presence', (req, res) => {
  const payload = parsePayload(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid or missing access token' });
  }

  const { sessionId } = req.params;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  const normalizedUser = normalizeAccount(payload.username);
  if (payload.role === 'member' && !isMemberAllowedInSession(session, normalizedUser)) {
    return res.status(403).json({ message: 'You are not assigned to this session' });
  }

  const stats = getPresenceStats(sessionId);
  return res.json({
    activeCount: stats.activeCount,
    joinedCount: stats.joinedCount,
    activeParticipants: stats.activeParticipants,
  });
});

export default router;
