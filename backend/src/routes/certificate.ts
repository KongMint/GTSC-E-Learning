import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

import { UserRole, users } from './auth';
import { buildProgressPayload } from './progress';
import { getBestQuizScoreForMember, getPublishedQuizCount } from './quiz';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

interface Certificate {
  id: string;
  certificateCode: string;
  username: string;
  completionPercent: number;
  bestQuizScore: number;
  minRequiredQuizScore: number;
  issuedAt: string;
}

const router = Router();
const CERT_DATA_DIR = path.join(process.cwd(), 'data');
const CERT_DATA_FILE = path.join(CERT_DATA_DIR, 'certificates.json');
const certificatesByUser = new Map<string, Certificate>();

const normalizeAccount = (value?: string) => (value || '').trim().toLowerCase();

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

const saveCertificates = () => {
  try {
    if (!fs.existsSync(CERT_DATA_DIR)) {
      fs.mkdirSync(CERT_DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(CERT_DATA_FILE, JSON.stringify(Array.from(certificatesByUser.values()), null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save certificates', error);
  }
};

const loadCertificates = () => {
  try {
    if (!fs.existsSync(CERT_DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(CERT_DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return;
    }

    parsed.forEach((item) => {
      if (!item?.username || !item?.id) {
        return;
      }

      certificatesByUser.set(normalizeAccount(item.username), item as Certificate);
    });
  } catch (error) {
    console.error('Failed to load certificates', error);
  }
};

loadCertificates();

const getEligibility = (username: string) => {
  const normalized = normalizeAccount(username);
  const progress = buildProgressPayload(normalized);
  const publishedQuizCount = getPublishedQuizCount();
  const minRequiredQuizScore = Number(process.env.CERT_MIN_QUIZ_SCORE || 70);
  const bestQuizScore = getBestQuizScoreForMember(normalized);
  const meetsProgress = progress.completionPercent >= 100;
  const meetsQuiz = publishedQuizCount === 0 ? true : bestQuizScore >= minRequiredQuizScore;
  const eligible = meetsProgress && meetsQuiz;

  return {
    eligible,
    completionPercent: progress.completionPercent,
    completedLessons: progress.completedCount,
    totalLessons: progress.totalLessons,
    bestQuizScore,
    minRequiredQuizScore,
    publishedQuizCount,
  };
};

router.get('/certificates/eligibility', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUsername = normalizeAccount(member.username);
  const user = users.get(normalizedUsername) || users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  const eligibility = getEligibility(member.username);
  const existingCertificate = certificatesByUser.get(normalizeAccount(member.username)) || null;

  return res.json({
    ...eligibility,
    hasCertificate: Boolean(existingCertificate),
    certificate: existingCertificate,
  });
});

router.post('/certificates/issue', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUsername = normalizeAccount(member.username);
  const user = users.get(normalizedUsername) || users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  const existing = certificatesByUser.get(normalizedUsername);
  if (existing) {
    return res.json({ certificate: existing, reused: true });
  }

  const eligibility = getEligibility(member.username);
  if (!eligibility.eligible) {
    return res.status(400).json({
      message: 'Bạn chưa đủ điều kiện nhận chứng chỉ',
      eligibility,
    });
  }

  const certificate: Certificate = {
    id: `cert-${Date.now()}`,
    certificateCode: `GTSC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
    username: user.username,
    completionPercent: eligibility.completionPercent,
    bestQuizScore: eligibility.bestQuizScore,
    minRequiredQuizScore: eligibility.minRequiredQuizScore,
    issuedAt: new Date().toISOString(),
  };

  certificatesByUser.set(normalizedUsername, certificate);
  saveCertificates();

  return res.status(201).json({ certificate, reused: false });
});

router.get('/certificates/me', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const certificate = certificatesByUser.get(normalizeAccount(member.username));
  if (!certificate) {
    return res.status(404).json({ message: 'Certificate not found' });
  }

  return res.json({ certificate });
});

export default router;
