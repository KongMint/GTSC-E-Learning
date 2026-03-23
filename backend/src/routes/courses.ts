import { Router } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { UserRole, users } from './auth';
import { lessons } from './admin';
import { completedLessonsByUser } from './progress';

interface AccessTokenPayload {
  username: string;
  role: UserRole;
}

interface StoredEnrollment {
  username: string;
  courses: string[];
}

interface StoredCart {
  username: string;
  courseKeys: string[];
}

type CoursePaymentMethod = 'bank_transfer' | 'card' | 'ewallet';
type PaymentStatus = 'pending' | 'success';

interface StoredPaymentTransaction {
  id: string;
  username: string;
  courseKey: string;
  courseTitle: string;
  amountVnd: number;
  currency: 'VND';
  status: PaymentStatus;
  method?: CoursePaymentMethod;
  payerName?: string;
  payerEmail?: string;
  createdAt: string;
  confirmedAt?: string;
}

interface StoredPaymentData {
  pendingTransactions: StoredPaymentTransaction[];
  paymentHistory: Array<{ username: string; transactions: StoredPaymentTransaction[] }>;
}

const router = Router();
const enrollmentsByUser: Map<string, Set<string>> = new Map();
const cartByUser: Map<string, Set<string>> = new Map();
const pendingTransactionsById: Map<string, StoredPaymentTransaction> = new Map();
const paymentHistoryByUser: Map<string, StoredPaymentTransaction[]> = new Map();
const ENROLL_DATA_DIR = path.join(process.cwd(), 'data');
const ENROLL_DATA_FILE = path.join(ENROLL_DATA_DIR, 'course-enrollments.json');
const PAYMENT_DATA_FILE = path.join(ENROLL_DATA_DIR, 'course-payments.json');
const CART_DATA_FILE = path.join(ENROLL_DATA_DIR, 'course-carts.json');

const normalizeValue = (value?: string) => (value || '').trim().toLowerCase();

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

const saveEnrollments = () => {
  try {
    if (!fs.existsSync(ENROLL_DATA_DIR)) {
      fs.mkdirSync(ENROLL_DATA_DIR, { recursive: true });
    }

    const payload: StoredEnrollment[] = Array.from(enrollmentsByUser.entries()).map(([username, courses]) => ({
      username,
      courses: Array.from(courses.values()),
    }));

    fs.writeFileSync(ENROLL_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save course enrollments', error);
  }
};

const loadEnrollments = () => {
  try {
    if (!fs.existsSync(ENROLL_DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(ENROLL_DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return;
    }

    parsed.forEach((item) => {
      if (!item?.username || !Array.isArray(item?.courses)) {
        return;
      }

      enrollmentsByUser.set(
        normalizeValue(item.username),
        new Set<string>(item.courses.map((course: string) => normalizeValue(course)).filter(Boolean))
      );
    });
  } catch (error) {
    console.error('Failed to load course enrollments', error);
  }
};

loadEnrollments();

const saveCarts = () => {
  try {
    if (!fs.existsSync(ENROLL_DATA_DIR)) {
      fs.mkdirSync(ENROLL_DATA_DIR, { recursive: true });
    }

    const payload: StoredCart[] = Array.from(cartByUser.entries()).map(([username, courseKeys]) => ({
      username,
      courseKeys: Array.from(courseKeys.values()),
    }));

    fs.writeFileSync(CART_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save course carts', error);
  }
};

const loadCarts = () => {
  try {
    if (!fs.existsSync(CART_DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(CART_DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return;
    }

    parsed.forEach((item) => {
      if (!item?.username || !Array.isArray(item?.courseKeys)) {
        return;
      }

      cartByUser.set(
        normalizeValue(item.username),
        new Set<string>(item.courseKeys.map((courseKey: string) => normalizeValue(courseKey)).filter(Boolean))
      );
    });
  } catch (error) {
    console.error('Failed to load course carts', error);
  }
};

loadCarts();

const savePayments = () => {
  try {
    if (!fs.existsSync(ENROLL_DATA_DIR)) {
      fs.mkdirSync(ENROLL_DATA_DIR, { recursive: true });
    }

    const payload: StoredPaymentData = {
      pendingTransactions: Array.from(pendingTransactionsById.values()),
      paymentHistory: Array.from(paymentHistoryByUser.entries()).map(([username, transactions]) => ({
        username,
        transactions,
      })),
    };

    fs.writeFileSync(PAYMENT_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save course payments', error);
  }
};

const loadPayments = () => {
  try {
    if (!fs.existsSync(PAYMENT_DATA_FILE)) {
      return;
    }

    const raw = fs.readFileSync(PAYMENT_DATA_FILE, 'utf8');
    const parsed = (raw ? JSON.parse(raw) : {}) as StoredPaymentData;

    if (Array.isArray(parsed.pendingTransactions)) {
      parsed.pendingTransactions.forEach((item) => {
        if (!item?.id || !item?.username || !item?.courseKey) {
          return;
        }

        pendingTransactionsById.set(item.id, {
          ...item,
          username: normalizeValue(item.username),
          courseKey: normalizeValue(item.courseKey),
          status: 'pending',
        });
      });
    }

    if (Array.isArray(parsed.paymentHistory)) {
      parsed.paymentHistory.forEach((item) => {
        if (!item?.username || !Array.isArray(item.transactions)) {
          return;
        }

        const normalizedUser = normalizeValue(item.username);
        const normalizedTransactions = item.transactions
          .filter((tx) => tx?.id && tx?.courseKey)
          .map((tx) => ({
            ...tx,
            username: normalizedUser,
            courseKey: normalizeValue(tx.courseKey),
            status: 'success' as PaymentStatus,
          }));

        paymentHistoryByUser.set(normalizedUser, normalizedTransactions);
      });
    }
  } catch (error) {
    console.error('Failed to load course payments', error);
  }
};

loadPayments();

const computeCoursePriceVnd = (lessonCount: number, moduleCount: number) => {
  const dynamic = lessonCount * 50000 + moduleCount * 30000;
  const price = 199000 + dynamic;
  return Math.min(Math.max(price, 229000), 2999000);
};

const buildCourseCatalog = () => {
  const publishedLessons = lessons.filter((lesson) => lesson.status === 'published');
  const courseMap = new Map<
    string,
    {
      key: string;
      title: string;
      modules: Map<string, { title: string; lessonCount: number }>;
      lessonCount: number;
    }
  >();

  publishedLessons.forEach((lesson) => {
    const key = normalizeValue(lesson.courseTitle);
    const current = courseMap.get(key) || {
      key,
      title: lesson.courseTitle,
      modules: new Map<string, { title: string; lessonCount: number }>(),
      lessonCount: 0,
    };

    const moduleKey = normalizeValue(lesson.moduleTitle);
    const moduleState = current.modules.get(moduleKey) || {
      title: lesson.moduleTitle,
      lessonCount: 0,
    };
    moduleState.lessonCount += 1;
    current.modules.set(moduleKey, moduleState);
    current.lessonCount += 1;
    courseMap.set(key, current);
  });

  return Array.from(courseMap.values()).map((item) => ({
    key: item.key,
    title: item.title,
    moduleCount: item.modules.size,
    lessonCount: item.lessonCount,
    priceVnd: computeCoursePriceVnd(item.lessonCount, item.modules.size),
    modules: Array.from(item.modules.values()).sort((a, b) => a.title.localeCompare(b.title, 'vi')),
  }));
};

const buildMemberCoursesPayload = (username: string) => {
  const normalizedUser = normalizeValue(username);
  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  const completedSet = completedLessonsByUser.get(normalizedUser) || new Set<string>();
  const catalog = buildCourseCatalog();
  const paymentHistory = paymentHistoryByUser.get(normalizedUser) || [];
  const paidAtByCourse = new Map<string, string>();
  paymentHistory.forEach((tx) => {
    if (tx.status !== 'success') {
      return;
    }

    const existingPaidAt = paidAtByCourse.get(tx.courseKey);
    if (!existingPaidAt || new Date(existingPaidAt).getTime() < new Date(tx.confirmedAt || tx.createdAt).getTime()) {
      paidAtByCourse.set(tx.courseKey, tx.confirmedAt || tx.createdAt);
    }
  });

  const enrolledCourses = catalog
    .filter((course) => enrolledSet.has(course.key))
    .map((course) => {
      const courseLessons = lessons.filter(
        (lesson) => lesson.status === 'published' && normalizeValue(lesson.courseTitle) === course.key
      );
      const completedInCourse = courseLessons.filter((lesson) => completedSet.has(lesson.id)).length;
      const completionPercent =
        courseLessons.length === 0 ? 0 : Math.round((completedInCourse / courseLessons.length) * 100);

      const moduleProgressMap = new Map<string, { title: string; lessonCount: number; completedLessons: number }>();
      courseLessons.forEach((lesson) => {
        const moduleKey = normalizeValue(lesson.moduleTitle);
        const current = moduleProgressMap.get(moduleKey) || {
          title: lesson.moduleTitle,
          lessonCount: 0,
          completedLessons: 0,
        };

        current.lessonCount += 1;
        if (completedSet.has(lesson.id)) {
          current.completedLessons += 1;
        }

        moduleProgressMap.set(moduleKey, current);
      });

      return {
        key: course.key,
        title: course.title,
        moduleCount: course.moduleCount,
        lessonCount: course.lessonCount,
        priceVnd: course.priceVnd,
        paidAt: paidAtByCourse.get(course.key) || null,
        completedLessons: completedInCourse,
        completionPercent,
        modules: Array.from(moduleProgressMap.values()).sort((a, b) => a.title.localeCompare(b.title, 'vi')),
      };
    });

  return {
    enrolledCourses,
  };
};

const getCourseByKey = (courseKey: string) =>
  buildCourseCatalog().find((course) => course.key === normalizeValue(courseKey)) || null;

const isPaymentMethod = (method?: string): method is CoursePaymentMethod =>
  method === 'bank_transfer' || method === 'card' || method === 'ewallet';

const formatPaymentReceipt = (tx: StoredPaymentTransaction) => ({
  id: tx.id,
  courseKey: tx.courseKey,
  courseTitle: tx.courseTitle,
  amountVnd: tx.amountVnd,
  currency: tx.currency,
  method: tx.method,
  payerName: tx.payerName,
  payerEmail: tx.payerEmail,
  createdAt: tx.createdAt,
  confirmedAt: tx.confirmedAt,
});

const buildMemberCartPayload = (username: string) => {
  const normalizedUser = normalizeValue(username);
  const catalog = buildCourseCatalog();
  const courseMap = new Map(catalog.map((course) => [course.key, course]));
  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  const cartSet = cartByUser.get(normalizedUser) || new Set<string>();

  const cartItems = Array.from(cartSet.values())
    .filter((courseKey) => !enrolledSet.has(courseKey))
    .map((courseKey) => courseMap.get(courseKey))
    .filter((course): course is NonNullable<typeof course> => Boolean(course))
    .map((course) => ({
      key: course.key,
      title: course.title,
      moduleCount: course.moduleCount,
      lessonCount: course.lessonCount,
      priceVnd: course.priceVnd,
    }));

  const totalAmountVnd = cartItems.reduce((sum, item) => sum + item.priceVnd, 0);

  return {
    cartItems,
    itemCount: cartItems.length,
    totalAmountVnd,
  };
};

router.get('/courses', (_req, res) => {
  const courses = buildCourseCatalog();
  return res.json({ courses });
});

router.get('/my-courses', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUser = normalizeValue(member.username);
  const user = users.get(normalizedUser) || users.get(member.username);
  if (!user || user.role !== 'member') {
    return res.status(404).json({ message: 'Member account not found' });
  }

  return res.json(buildMemberCoursesPayload(normalizedUser));
});

router.get('/my-courses/payments', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUser = normalizeValue(member.username);
  const history = (paymentHistoryByUser.get(normalizedUser) || [])
    .filter((tx) => tx.status === 'success')
    .sort((a, b) => new Date(b.confirmedAt || b.createdAt).getTime() - new Date(a.confirmedAt || a.createdAt).getTime())
    .map(formatPaymentReceipt);

  return res.json({ payments: history });
});

router.get('/my-courses/cart', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  return res.json(buildMemberCartPayload(member.username));
});

router.post('/my-courses/cart/items', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { courseKey } = req.body as { courseKey?: string };
  const normalizedUser = normalizeValue(member.username);
  const normalizedCourse = normalizeValue(courseKey);
  if (!normalizedCourse) {
    return res.status(400).json({ message: 'courseKey is required' });
  }

  const course = getCourseByKey(normalizedCourse);
  if (!course) {
    return res.status(404).json({ message: 'Course not found' });
  }

  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  if (enrolledSet.has(normalizedCourse)) {
    return res.status(409).json({ message: 'Course already enrolled' });
  }

  const cartSet = cartByUser.get(normalizedUser) || new Set<string>();
  cartSet.add(normalizedCourse);
  cartByUser.set(normalizedUser, cartSet);
  saveCarts();

  return res.json(buildMemberCartPayload(normalizedUser));
});

router.delete('/my-courses/cart/items/:courseKey', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUser = normalizeValue(member.username);
  const normalizedCourse = normalizeValue(req.params.courseKey);
  const cartSet = cartByUser.get(normalizedUser) || new Set<string>();
  cartSet.delete(normalizedCourse);
  cartByUser.set(normalizedUser, cartSet);
  saveCarts();

  return res.json(buildMemberCartPayload(normalizedUser));
});

router.delete('/my-courses/cart', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUser = normalizeValue(member.username);
  cartByUser.set(normalizedUser, new Set<string>());
  saveCarts();

  return res.json(buildMemberCartPayload(normalizedUser));
});

router.post('/my-courses/cart/checkout', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { method, payerName, payerEmail } = req.body as {
    method?: string;
    payerName?: string;
    payerEmail?: string;
  };

  if (!isPaymentMethod(method)) {
    return res.status(400).json({ message: 'Payment method is invalid' });
  }

  const normalizedUser = normalizeValue(member.username);
  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  const cartSet = cartByUser.get(normalizedUser) || new Set<string>();
  const catalog = buildCourseCatalog();
  const courseMap = new Map(catalog.map((course) => [course.key, course]));

  const payableCourses = Array.from(cartSet.values())
    .filter((courseKey) => !enrolledSet.has(courseKey))
    .map((courseKey) => courseMap.get(courseKey))
    .filter((course): course is NonNullable<typeof course> => Boolean(course));

  if (payableCourses.length === 0) {
    return res.status(400).json({ message: 'Cart is empty or all courses are already enrolled' });
  }

  const nowIso = new Date().toISOString();
  const history = paymentHistoryByUser.get(normalizedUser) || [];
  const receipts = payableCourses.map((course) => {
    const tx: StoredPaymentTransaction = {
      id: crypto.randomUUID(),
      username: normalizedUser,
      courseKey: course.key,
      courseTitle: course.title,
      amountVnd: course.priceVnd,
      currency: 'VND',
      status: 'success',
      method,
      payerName: (payerName || '').trim() || member.username,
      payerEmail: (payerEmail || '').trim() || undefined,
      createdAt: nowIso,
      confirmedAt: nowIso,
    };

    history.push(tx);
    enrolledSet.add(course.key);
    cartSet.delete(course.key);
    return formatPaymentReceipt(tx);
  });

  paymentHistoryByUser.set(normalizedUser, history);
  enrollmentsByUser.set(normalizedUser, enrolledSet);
  cartByUser.set(normalizedUser, cartSet);
  savePayments();
  saveEnrollments();
  saveCarts();

  const totalAmountVnd = receipts.reduce((sum, item) => sum + item.amountVnd, 0);
  return res.json({
    message: 'Thanh toán giỏ hàng thành công',
    receipts,
    ...buildMemberCoursesPayload(normalizedUser),
    ...buildMemberCartPayload(normalizedUser),
  });
});

router.post('/my-courses/purchase-intent', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { courseKey } = req.body as { courseKey?: string };
  const normalizedUser = normalizeValue(member.username);
  const normalizedCourse = normalizeValue(courseKey);

  if (!normalizedCourse) {
    return res.status(400).json({ message: 'courseKey is required' });
  }

  const course = getCourseByKey(normalizedCourse);
  if (!course) {
    return res.status(404).json({ message: 'Course not found' });
  }

  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  if (enrolledSet.has(normalizedCourse)) {
    return res.status(409).json({ message: 'Course already purchased and enrolled' });
  }

  const nowIso = new Date().toISOString();
  const paymentIntentId = crypto.randomUUID();
  const transaction: StoredPaymentTransaction = {
    id: paymentIntentId,
    username: normalizedUser,
    courseKey: normalizedCourse,
    courseTitle: course.title,
    amountVnd: course.priceVnd,
    currency: 'VND',
    status: 'pending',
    createdAt: nowIso,
  };

  pendingTransactionsById.set(paymentIntentId, transaction);
  savePayments();

  return res.json({
    paymentIntent: {
      id: paymentIntentId,
      amountVnd: transaction.amountVnd,
      currency: transaction.currency,
      courseKey: transaction.courseKey,
      courseTitle: transaction.courseTitle,
      createdAt: transaction.createdAt,
      expiresInMinutes: 30,
    },
  });
});

router.post('/my-courses/purchase/confirm', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { paymentIntentId, method, payerName, payerEmail } = req.body as {
    paymentIntentId?: string;
    method?: string;
    payerName?: string;
    payerEmail?: string;
  };

  if (!paymentIntentId) {
    return res.status(400).json({ message: 'paymentIntentId is required' });
  }

  if (!isPaymentMethod(method)) {
    return res.status(400).json({ message: 'Payment method is invalid' });
  }

  const normalizedUser = normalizeValue(member.username);
  const transaction = pendingTransactionsById.get(paymentIntentId);
  if (!transaction || transaction.status !== 'pending') {
    return res.status(404).json({ message: 'Payment intent not found or expired' });
  }

  if (transaction.username !== normalizedUser) {
    return res.status(403).json({ message: 'Forbidden payment intent access' });
  }

  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  if (enrolledSet.has(transaction.courseKey)) {
    pendingTransactionsById.delete(paymentIntentId);
    savePayments();
    return res.status(409).json({ message: 'Course already purchased and enrolled' });
  }

  const finalizedTx: StoredPaymentTransaction = {
    ...transaction,
    status: 'success',
    method,
    payerName: (payerName || '').trim() || member.username,
    payerEmail: (payerEmail || '').trim() || undefined,
    confirmedAt: new Date().toISOString(),
  };

  pendingTransactionsById.delete(paymentIntentId);
  const history = paymentHistoryByUser.get(normalizedUser) || [];
  history.push(finalizedTx);
  paymentHistoryByUser.set(normalizedUser, history);

  enrolledSet.add(transaction.courseKey);
  enrollmentsByUser.set(normalizedUser, enrolledSet);

  const cartSet = cartByUser.get(normalizedUser) || new Set<string>();
  if (cartSet.has(transaction.courseKey)) {
    cartSet.delete(transaction.courseKey);
    cartByUser.set(normalizedUser, cartSet);
    saveCarts();
  }

  savePayments();
  saveEnrollments();

  return res.json({
    message: 'Thanh toán thành công và đã ghi danh khóa học',
    receipt: formatPaymentReceipt(finalizedTx),
    ...buildMemberCoursesPayload(normalizedUser),
  });
});

router.post('/my-courses/enroll', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const { courseKey } = req.body as { courseKey?: string };
  const normalizedUser = normalizeValue(member.username);
  const normalizedCourse = normalizeValue(courseKey);

  if (!normalizedCourse) {
    return res.status(400).json({ message: 'courseKey is required' });
  }

  const courseExists = buildCourseCatalog().some((course) => course.key === normalizedCourse);
  if (!courseExists) {
    return res.status(404).json({ message: 'Course not found' });
  }

  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  enrolledSet.add(normalizedCourse);
  enrollmentsByUser.set(normalizedUser, enrolledSet);
  saveEnrollments();

  return res.json(buildMemberCoursesPayload(normalizedUser));
});

router.delete('/my-courses/enroll/:courseKey', (req, res) => {
  const member = verifyMember(req.headers.authorization);
  if (!member) {
    return res.status(401).json({ message: 'Invalid or missing member token' });
  }

  const normalizedUser = normalizeValue(member.username);
  const normalizedCourse = normalizeValue(req.params.courseKey);
  const enrolledSet = enrollmentsByUser.get(normalizedUser) || new Set<string>();
  enrolledSet.delete(normalizedCourse);
  enrollmentsByUser.set(normalizedUser, enrolledSet);
  saveEnrollments();

  return res.json(buildMemberCoursesPayload(normalizedUser));
});

export default router;
