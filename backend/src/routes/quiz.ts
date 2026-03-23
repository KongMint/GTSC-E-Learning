import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';

import { lessons } from './admin';
import { isStaffRole, UserRole, users } from './auth';
import { completedLessonsByUser } from './progress';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctOptionIndex: number;
}

interface Quiz {
  id: string;
  lessonId: string;
  title: string;
  status: 'draft' | 'published';
  attemptLimit: number;
  questions: QuizQuestion[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface QuizAttempt {
  id: string;
  quizId: string;
  username: string;
  answers: number[];
  correctCount: number;
  totalQuestions: number;
  scorePercent: number;
  attemptedAt: string;
}

const router = Router();
export const quizzes: Quiz[] = [];
export const attempts: QuizAttempt[] = [];

export const getBestQuizScoreForMember = (username: string): number => {
  const memberAttempts = attempts.filter((attempt) => attempt.username === username);
  return memberAttempts.length === 0 ? 0 : Math.max(...memberAttempts.map((attempt) => attempt.scorePercent));
};

export const getPublishedQuizCount = (): number => quizzes.filter((quiz) => quiz.status === 'published').length;

const getBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const parseTokenPayload = (authHeader?: string): AccessTokenPayload | null => {
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
  const payload = parseTokenPayload(req.headers.authorization);
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
  const payload = parseTokenPayload(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ message: 'Invalid or missing access token' });
    return null;
  }

  if (payload.role !== 'member') {
    res.status(403).json({ message: 'Member privileges are required' });
    return null;
  }

  const user = users.get(payload.username);
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

router.get('/admin/quizzes', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  return res.json({ quizzes });
});

router.post('/admin/quizzes', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { lessonId, title, status, questions, attemptLimit } = req.body as {
    lessonId?: string;
    title?: string;
    status?: 'draft' | 'published';
    questions?: Array<{ text: string; options: string[]; correctOptionIndex: number }>;
    attemptLimit?: number;
  };

  if (!lessonId || !title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: 'lessonId, title and questions are required' });
  }

  const lessonExists = lessons.some((lesson) => lesson.id === lessonId);
  if (!lessonExists) {
    return res.status(404).json({ message: 'Lesson not found' });
  }

  const normalizedAttemptLimit = Number.isFinite(attemptLimit) ? Number(attemptLimit) : 3;
  if (!Number.isInteger(normalizedAttemptLimit) || normalizedAttemptLimit < 1 || normalizedAttemptLimit > 20) {
    return res.status(400).json({ message: 'attemptLimit must be an integer from 1 to 20' });
  }

  const normalizedQuestions: QuizQuestion[] = [];
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    if (!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) {
      return res.status(400).json({ message: `Question ${i + 1} is invalid` });
    }

    if (!Number.isInteger(q.correctOptionIndex) || q.correctOptionIndex < 0 || q.correctOptionIndex >= q.options.length) {
      return res.status(400).json({ message: `Question ${i + 1} has invalid correctOptionIndex` });
    }

    normalizedQuestions.push({
      id: `q-${Date.now()}-${i}`,
      text: q.text,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
    });
  }

  const newQuiz: Quiz = {
    id: `quiz-${Date.now()}`,
    lessonId,
    title,
    status: status === 'draft' ? 'draft' : 'published',
    attemptLimit: normalizedAttemptLimit,
    questions: normalizedQuestions,
    createdBy: admin.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  quizzes.unshift(newQuiz);
  return res.status(201).json({ quiz: newQuiz });
});

router.patch('/admin/quizzes/:quizId/status', (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) {
    return;
  }

  const { quizId } = req.params;
  const { status } = req.body as { status?: 'draft' | 'published' };

  if (status !== 'draft' && status !== 'published') {
    return res.status(400).json({ message: 'status must be draft or published' });
  }

  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) {
    return res.status(404).json({ message: 'Quiz not found' });
  }

  quiz.status = status;
  quiz.updatedAt = new Date().toISOString();

  return res.json({ quiz });
});

router.get('/quizzes', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const visibleQuizzes = quizzes
    .filter((quiz) => quiz.status === 'published')
    .map((quiz) => ({
      id: quiz.id,
      lessonId: quiz.lessonId,
      title: quiz.title,
      questionCount: quiz.questions.length,
      attemptLimit: quiz.attemptLimit,
      attemptsUsed: attempts.filter((attempt) => attempt.username === member.username && attempt.quizId === quiz.id).length,
      bestScorePercent: Math.max(
        0,
        ...attempts
          .filter((attempt) => attempt.username === member.username && attempt.quizId === quiz.id)
          .map((attempt) => attempt.scorePercent)
      ),
      questions: quiz.questions.map((question) => ({
        id: question.id,
        text: question.text,
        options: question.options,
      })),
      lessonCompleted: (completedLessonsByUser.get(member.username) || new Set<string>()).has(quiz.lessonId),
    }))
    .map((quiz) => ({
      id: quiz.id,
      lessonId: quiz.lessonId,
      title: quiz.title,
      questionCount: quiz.questions.length,
      attemptLimit: quiz.attemptLimit,
      attemptsUsed: quiz.attemptsUsed,
      attemptsRemaining: Math.max(quiz.attemptLimit - quiz.attemptsUsed, 0),
      bestScorePercent: quiz.bestScorePercent,
      lessonCompleted: quiz.lessonCompleted,
      lockedReason: quiz.lessonCompleted ? null : 'Bạn cần hoàn thành bài học tương ứng trước khi làm quiz này',
      questions: quiz.questions.map((question) => ({
        id: question.id,
        text: question.text,
        options: question.options,
      })),
    }));

  return res.json({ quizzes: visibleQuizzes });
});

router.post('/quizzes/:quizId/submit', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const { quizId } = req.params;
  const { answers } = req.body as { answers?: number[] };

  if (!Array.isArray(answers)) {
    return res.status(400).json({ message: 'answers must be an array' });
  }

  const quiz = quizzes.find((item) => item.id === quizId && item.status === 'published');
  if (!quiz) {
    return res.status(404).json({ message: 'Quiz not found' });
  }

  const completedSet = completedLessonsByUser.get(member.username) || new Set<string>();
  if (!completedSet.has(quiz.lessonId)) {
    return res.status(403).json({ message: 'You must complete the linked lesson before taking this quiz' });
  }

  const attemptsUsed = attempts.filter(
    (attempt) => attempt.username === member.username && attempt.quizId === quiz.id
  ).length;
  if (attemptsUsed >= quiz.attemptLimit) {
    return res.status(403).json({ message: 'You have reached the attempt limit for this quiz' });
  }

  if (answers.length !== quiz.questions.length) {
    return res.status(400).json({ message: 'answers length must match quiz questions length' });
  }

  let correctCount = 0;
  quiz.questions.forEach((question, idx) => {
    if (answers[idx] === question.correctOptionIndex) {
      correctCount += 1;
    }
  });

  const totalQuestions = quiz.questions.length;
  const scorePercent = totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100);

  const attempt: QuizAttempt = {
    id: `attempt-${Date.now()}`,
    quizId: quiz.id,
    username: member.username,
    answers,
    correctCount,
    totalQuestions,
    scorePercent,
    attemptedAt: new Date().toISOString(),
  };

  attempts.unshift(attempt);

  return res.json({
    result: {
      quizId: quiz.id,
      quizTitle: quiz.title,
      correctCount,
      totalQuestions,
      scorePercent,
      attemptedAt: attempt.attemptedAt,
    },
  });
});

router.get('/quizzes/history', (req, res) => {
  const member = verifyMember(req, res);
  if (!member) {
    return;
  }

  const memberAttempts = attempts.filter((attempt) => attempt.username === member.username);
  const bestScoreByQuiz = new Map<string, number>();
  memberAttempts.forEach((attempt) => {
    const currentBest = bestScoreByQuiz.get(attempt.quizId) || 0;
    if (attempt.scorePercent > currentBest) {
      bestScoreByQuiz.set(attempt.quizId, attempt.scorePercent);
    }
  });

  const history = memberAttempts
    .filter((attempt) => attempt.username === member.username)
    .map((attempt) => {
      const quiz = quizzes.find((item) => item.id === attempt.quizId);
      const bestScorePercent = bestScoreByQuiz.get(attempt.quizId) || attempt.scorePercent;
      return {
        id: attempt.id,
        quizId: attempt.quizId,
        quizTitle: quiz?.title || 'Quiz',
        correctCount: attempt.correctCount,
        totalQuestions: attempt.totalQuestions,
        scorePercent: attempt.scorePercent,
        bestScorePercent,
        isBestAttempt: attempt.scorePercent === bestScorePercent,
        attemptedAt: attempt.attemptedAt,
      };
    });

  return res.json({ history });
});

export default router;
