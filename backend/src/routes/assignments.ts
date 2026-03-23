import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';

import { isStaffRole, UserRole, users } from './auth';
import { lessons } from './admin';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

interface Assignment {
  id: string;
  lessonId: string;
  title: string;
  instructions: string;
  dueAt: string;
  maxScore: number;
  status: 'draft' | 'published';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  username: string;
  answerText: string;
  submissionUrl: string;
  submittedAt: string;
  score?: number;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
}

const router = Router();
export const assignments: Assignment[] = [];
export const submissions: AssignmentSubmission[] = [];

const normalizeValue = (value?: string) => (value || '').trim().toLowerCase();

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

  const user = users.get(normalizeValue(payload.username)) || users.get(payload.username);
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

router.get('/admin/assignments', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const data = assignments.map((assignment) => {
    const assignmentSubmissions = submissions.filter((item) => item.assignmentId === assignment.id);
    return {
      ...assignment,
      submissionCount: assignmentSubmissions.length,
      gradedCount: assignmentSubmissions.filter((item) => typeof item.score === 'number').length,
    };
  });

  return res.json({ assignments: data });
});

router.post('/admin/assignments', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { lessonId, title, instructions, dueAt, maxScore, status } = req.body as {
    lessonId?: string;
    title?: string;
    instructions?: string;
    dueAt?: string;
    maxScore?: number;
    status?: 'draft' | 'published';
  };

  if (!lessonId || !title || !instructions || !dueAt || !Number.isFinite(maxScore)) {
    return res.status(400).json({ message: 'lessonId, title, instructions, dueAt and maxScore are required' });
  }

  const lessonExists = lessons.some((lesson) => lesson.id === lessonId);
  if (!lessonExists) {
    return res.status(404).json({ message: 'Lesson not found' });
  }

  const parsedDueAt = new Date(dueAt);
  if (Number.isNaN(parsedDueAt.getTime())) {
    return res.status(400).json({ message: 'dueAt is invalid' });
  }

  const normalizedMaxScore = Number(maxScore);
  if (!Number.isInteger(normalizedMaxScore) || normalizedMaxScore < 10 || normalizedMaxScore > 1000) {
    return res.status(400).json({ message: 'maxScore must be an integer from 10 to 1000' });
  }

  const assignment: Assignment = {
    id: `assignment-${Date.now()}`,
    lessonId,
    title: title.trim(),
    instructions: instructions.trim(),
    dueAt: parsedDueAt.toISOString(),
    maxScore: normalizedMaxScore,
    status: status === 'draft' ? 'draft' : 'published',
    createdBy: admin.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assignments.unshift(assignment);
  return res.status(201).json({ assignment });
});

router.patch('/admin/assignments/:assignmentId/status', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { assignmentId } = req.params;
  const { status } = req.body as { status?: 'draft' | 'published' };

  if (status !== 'draft' && status !== 'published') {
    return res.status(400).json({ message: 'status must be draft or published' });
  }

  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  assignment.status = status;
  assignment.updatedAt = new Date().toISOString();
  return res.json({ assignment });
});

router.get('/admin/assignments/:assignmentId/submissions', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { assignmentId } = req.params;
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  const data = submissions
    .filter((item) => item.assignmentId === assignmentId)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  return res.json({ submissions: data });
});

router.patch('/admin/assignments/:assignmentId/submissions/:submissionId/grade', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { assignmentId, submissionId } = req.params;
  const { score, feedback } = req.body as { score?: number; feedback?: string };

  if (!Number.isFinite(score)) {
    return res.status(400).json({ message: 'score is required' });
  }

  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  const submission = submissions.find((item) => item.id === submissionId && item.assignmentId === assignmentId);
  if (!submission) {
    return res.status(404).json({ message: 'Submission not found' });
  }

  const normalizedScore = Number(score);
  if (normalizedScore < 0 || normalizedScore > assignment.maxScore) {
    return res.status(400).json({ message: `score must be between 0 and ${assignment.maxScore}` });
  }

  submission.score = normalizedScore;
  submission.feedback = (feedback || '').trim();
  submission.gradedAt = new Date().toISOString();
  submission.gradedBy = admin.username;

  return res.json({ submission });
});

router.get('/assignments', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const normalizedUser = normalizeValue(member.username);
  const data = assignments
    .filter((assignment) => assignment.status === 'published')
    .map((assignment) => {
      const lesson = lessons.find((item) => item.id === assignment.lessonId);
      const submission = submissions.find(
        (item) => item.assignmentId === assignment.id && normalizeValue(item.username) === normalizedUser
      );

      return {
        ...assignment,
        lessonTitle: lesson?.title || 'Bài học',
        submission: submission || null,
      };
    });

  return res.json({ assignments: data });
});

router.post('/assignments/:assignmentId/submit', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { assignmentId } = req.params;
  const { answerText, submissionUrl } = req.body as {
    answerText?: string;
    submissionUrl?: string;
  };

  if (!answerText && !submissionUrl) {
    return res.status(400).json({ message: 'answerText or submissionUrl is required' });
  }

  const assignment = assignments.find((item) => item.id === assignmentId && item.status === 'published');
  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  const normalizedUser = normalizeValue(member.username);
  const existing = submissions.find(
    (item) => item.assignmentId === assignmentId && normalizeValue(item.username) === normalizedUser
  );

  if (existing) {
    existing.answerText = (answerText || '').trim();
    existing.submissionUrl = (submissionUrl || '').trim();
    existing.submittedAt = new Date().toISOString();
    existing.score = undefined;
    existing.feedback = undefined;
    existing.gradedAt = undefined;
    existing.gradedBy = undefined;
    return res.json({ submission: existing, updated: true });
  }

  const submission: AssignmentSubmission = {
    id: `submission-${Date.now()}`,
    assignmentId,
    username: member.username,
    answerText: (answerText || '').trim(),
    submissionUrl: (submissionUrl || '').trim(),
    submittedAt: new Date().toISOString(),
  };

  submissions.unshift(submission);
  return res.status(201).json({ submission, updated: false });
});

router.get('/assignments/history', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const normalizedUser = normalizeValue(member.username);
  const history = submissions
    .filter((item) => normalizeValue(item.username) === normalizedUser)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .map((item) => {
      const assignment = assignments.find((a) => a.id === item.assignmentId);
      return {
        ...item,
        assignmentTitle: assignment?.title || 'Bài tập',
        maxScore: assignment?.maxScore || 100,
      };
    });

  return res.json({ history });
});

export default router;
