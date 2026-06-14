import crypto from 'crypto';
import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { loadConfig } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';

type Role = 'ADMIN' | 'OPERATOR';
type UnitStatus = 'IDLE' | 'ACTIVE' | 'OFFLINE';
type CustomerType = 'GUEST' | 'MEMBER';
type SessionState = 'ACTIVE' | 'ENDED_EARLY' | 'ENDED_AUTO';
type AgentCommand = 'power_on' | 'power_off' | 'restart' | 'lock' | 'unlock';

interface User {
  id: string;
  username: string;
  password: string;
  role: Role;
}

interface RentalUnit {
  id: string;
  name: string;
  ipAddress: string;
  status: UnitStatus;
  lastHeartbeat: number | null;
  createdAt: number;
}

interface SessionCharge {
  type: 'INITIAL' | 'EXTENSION';
  minutes: number;
  amount: number;
  createdAt: number;
}

interface RentalSession {
  id: string;
  unitId: string;
  customerType: CustomerType;
  customerName: string | null;
  startTime: number;
  endTime: number;
  actualEndTime: number | null;
  totalCost: number;
  state: SessionState;
  charges: SessionCharge[];
}

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  target: string;
  timestamp: number;
  detail: Record<string, unknown>;
}

interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

interface DailyReport {
  date: string;
  totalRevenue: number;
  sessionCount: number;
  busiestUnit: RentalUnit | null;
}

interface LanCommandResult {
  success: boolean;
  command: AgentCommand;
  message: string;
  raw?: unknown;
}

interface SignedTokenPayload extends AuthUser {
  exp: number;
}

const users: User[] = [
  { id: 'user-admin', username: 'admin', password: 'admin123', role: 'ADMIN' },
  { id: 'user-operator', username: 'operator', password: 'operator123', role: 'OPERATOR' },
];

const units = new Map<string, RentalUnit>();
const sessions = new Map<string, RentalSession>();
const auditLogs: AuditLog[] = [];
const sessionTimers = new Map<string, NodeJS.Timeout>();

let pricing: Record<CustomerType, number> = {
  GUEST: 300,
  MEMBER: 250,
};

seedUnits();

export const mvpRouter = Router();

function seedUnits(): void {
  if (units.size > 0) return;

  const now = Date.now();
  [
    { name: 'PS 01', ipAddress: '192.168.1.101' },
    { name: 'PS 02', ipAddress: '192.168.1.102' },
    { name: 'PS 03', ipAddress: '192.168.1.103' },
    { name: 'VIP Room', ipAddress: '192.168.1.110' },
  ].forEach((unit) => {
    const id = crypto.randomUUID();
    units.set(id, {
      id,
      name: unit.name,
      ipAddress: unit.ipAddress,
      status: 'IDLE',
      lastHeartbeat: now,
      createdAt: now,
    });
  });
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

function writeAudit(user: AuthUser, action: string, target: string, detail: Record<string, unknown>): void {
  auditLogs.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    action,
    target,
    timestamp: Date.now(),
    detail,
  });
}

function parseDurationMs(value: string): number {
  const trimmed = value.trim();
  const amount = Number.parseInt(trimmed, 10);
  if (Number.isNaN(amount) || amount <= 0) return 8 * 60 * 60 * 1000;
  if (trimmed.endsWith('m')) return amount * 60 * 1000;
  if (trimmed.endsWith('d')) return amount * 24 * 60 * 60 * 1000;
  return amount * 60 * 60 * 1000;
}

function signToken(user: User): { accessToken: string; expiresAt: number } {
  const config = loadConfig();
  const expiresAt = Date.now() + parseDurationMs(config.jwt.expiresIn);
  const payload: SignedTokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: expiresAt,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', config.jwt.secret).update(body).digest('base64url');
  return { accessToken: `${body}.${signature}`, expiresAt };
}

function verifyToken(token: string): AuthUser {
  const config = loadConfig();
  const [body, signature] = token.split('.');
  if (!body || !signature) {
    throw new AppError(401, 'Token tidak valid.');
  }

  const expected = crypto.createHmac('sha256', config.jwt.secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new AppError(401, 'Signature token tidak valid.');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedTokenPayload;
  if (payload.exp <= Date.now()) {
    throw new AppError(401, 'Sesi login sudah kedaluwarsa.');
  }

  return { id: payload.id, username: payload.username, role: payload.role };
}

function getAuthUser(req: Request): AuthUser {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) {
    throw new AppError(401, 'Authorization Bearer token wajib dikirim.');
  }
  return verifyToken(token);
}

function requireAuth(req: Request): AuthUser {
  return getAuthUser(req);
}

function requireAdmin(req: Request): AuthUser {
  const user = getAuthUser(req);
  if (user.role !== 'ADMIN') {
    throw new AppError(403, 'Aksi ini hanya dapat dilakukan Admin.');
  }
  return user;
}

function assertCustomerType(value: unknown): CustomerType {
  if (value === 'MEMBER') return 'MEMBER';
  return 'GUEST';
}

function assertAgentCommand(value: unknown): AgentCommand {
  const command = String(value ?? '').trim().toLowerCase();
  if (
    command === 'power_on' ||
    command === 'power_off' ||
    command === 'restart' ||
    command === 'lock' ||
    command === 'unlock'
  ) {
    return command;
  }
  throw new AppError(400, `Perintah tidak dikenal: ${String(value)}`);
}

function readPositiveMinutes(value: unknown, fallback?: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(400, 'Durasi menit harus berupa angka positif.');
  }
  return Math.floor(parsed);
}

function calculateCost(customerType: CustomerType, minutes: number): number {
  return pricing[customerType] * minutes;
}

function findUnit(id: string): RentalUnit {
  const unit = units.get(id);
  if (!unit) {
    throw new AppError(404, 'Unit tidak ditemukan.');
  }
  return unit;
}

function findSession(id: string): RentalSession {
  const session = sessions.get(id);
  if (!session) {
    throw new AppError(404, 'Sesi sewa tidak ditemukan.');
  }
  return session;
}

function findActiveSessionByUnit(unitId: string): RentalSession | undefined {
  return Array.from(sessions.values()).find(
    (session) => session.unitId === unitId && session.state === 'ACTIVE',
  );
}

function toUnitDto(unit: RentalUnit): Record<string, unknown> {
  const activeSession = findActiveSessionByUnit(unit.id);
  const remainingSeconds = activeSession
    ? Math.max(0, Math.ceil((activeSession.endTime - Date.now()) / 1000))
    : 0;
  return {
    ...unit,
    activeSession: activeSession ? toSessionDto(activeSession) : null,
    remainingSeconds,
  };
}

function toSessionDto(session: RentalSession): Record<string, unknown> {
  return {
    ...session,
    remainingSeconds: session.state === 'ACTIVE'
      ? Math.max(0, Math.ceil((session.endTime - Date.now()) / 1000))
      : 0,
  };
}

function scheduleAutoShutdown(session: RentalSession): void {
  const existing = sessionTimers.get(session.id);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, Math.min(session.endTime - Date.now(), 2_147_483_647));
  const timer = setTimeout(() => {
    void endSessionAutomatically(session.id).catch((err) => {
      logger.error('Auto-shutdown gagal', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, delay);
  sessionTimers.set(session.id, timer);
}

function clearSessionTimer(sessionId: string): void {
  const timer = sessionTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  sessionTimers.delete(sessionId);
}

async function endSessionAutomatically(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session || session.state !== 'ACTIVE') return;

  const unit = findUnit(session.unitId);
  session.state = 'ENDED_AUTO';
  session.actualEndTime = Date.now();
  unit.status = 'IDLE';
  clearSessionTimer(session.id);
  await sendLanCommand(unit, 'power_off');
}

function buildDailyReport(date: string): DailyReport {
  const finishedSessions = Array.from(sessions.values()).filter((session) => {
    if (!session.actualEndTime) return false;
    return new Date(session.actualEndTime).toISOString().slice(0, 10) === date;
  });

  const totalRevenue = finishedSessions.reduce((sum, session) => sum + session.totalCost, 0);
  const usage = new Map<string, number>();
  finishedSessions.forEach((session) => {
    usage.set(session.unitId, (usage.get(session.unitId) ?? 0) + 1);
  });

  const busiestUnitId = Array.from(usage.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    date,
    totalRevenue,
    sessionCount: finishedSessions.length,
    busiestUnit: busiestUnitId ? units.get(busiestUnitId) ?? null : null,
  };
}

async function sendLanCommand(unit: RentalUnit, command: AgentCommand): Promise<LanCommandResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://${unit.ipAddress}:8080/command/${command}`, {
      method: 'POST',
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => undefined) as unknown;
    return {
      success: response.ok,
      command,
      message: response.ok ? 'Perintah berhasil dikirim ke TV Agent.' : 'TV Agent menolak perintah.',
      raw,
    };
  } catch (err) {
    return {
      success: false,
      command,
      message: `Gagal menghubungi TV Agent ${unit.ipAddress}: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

mvpRouter.post('/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '');
  const password = String(req.body?.password ?? '');
  const user = users.find((candidate) => candidate.username === username && candidate.password === password);
  if (!user) {
    throw new AppError(401, 'Nama pengguna atau kata sandi salah.');
  }

  const token = signToken(user);
  res.json({
    accessToken: token.accessToken,
    role: user.role,
    expiresAt: token.expiresAt,
  });
});

mvpRouter.get('/status', (req, res) => {
  requireAuth(req);
  res.json({
    status: 'operational',
    units: units.size,
    activeSessions: Array.from(sessions.values()).filter((session) => session.state === 'ACTIVE').length,
    finishedSessions: Array.from(sessions.values()).filter((session) => session.state !== 'ACTIVE').length,
  });
});

mvpRouter.get('/pricing', (req, res) => {
  requireAuth(req);
  res.json({ pricing });
});

mvpRouter.put('/pricing', (req, res) => {
  const user = requireAdmin(req);
  const guest = readPositiveMinutes(req.body?.guestRatePerMinute ?? req.body?.GUEST, pricing.GUEST);
  const member = readPositiveMinutes(req.body?.memberRatePerMinute ?? req.body?.MEMBER, pricing.MEMBER);
  pricing = { GUEST: guest, MEMBER: member };
  writeAudit(user, 'UPDATE_PRICING', 'pricing', pricing);
  res.json({ pricing });
});

mvpRouter.get('/units', (req, res) => {
  requireAuth(req);
  res.json(Array.from(units.values()).map(toUnitDto));
});

mvpRouter.post('/units', (req, res) => {
  const user = requireAdmin(req);
  const name = String(req.body?.name ?? '').trim();
  const ipAddress = String(req.body?.ipAddress ?? req.body?.ip_address ?? '').trim();
  if (!name || !ipAddress) {
    throw new AppError(400, 'Nama unit dan IP address wajib diisi.');
  }
  if (Array.from(units.values()).some((unit) => unit.ipAddress === ipAddress)) {
    throw new AppError(409, 'IP address unit sudah terdaftar.');
  }

  const unit: RentalUnit = {
    id: crypto.randomUUID(),
    name,
    ipAddress,
    status: 'IDLE',
    lastHeartbeat: null,
    createdAt: Date.now(),
  };
  units.set(unit.id, unit);
  writeAudit(user, 'CREATE_UNIT', unit.id, { name, ipAddress });
  res.status(201).json(toUnitDto(unit));
});

mvpRouter.get('/units/:id', (req, res) => {
  requireAuth(req);
  res.json(toUnitDto(findUnit(req.params.id)));
});

mvpRouter.put('/units/:id', (req, res) => {
  const user = requireAdmin(req);
  const unit = findUnit(req.params.id);
  const name = String(req.body?.name ?? unit.name).trim();
  const ipAddress = String(req.body?.ipAddress ?? req.body?.ip_address ?? unit.ipAddress).trim();
  const status = String(req.body?.status ?? unit.status).toUpperCase() as UnitStatus;
  if (!['IDLE', 'ACTIVE', 'OFFLINE'].includes(status)) {
    throw new AppError(400, 'Status unit tidak valid.');
  }
  if (Array.from(units.values()).some((candidate) => candidate.id !== unit.id && candidate.ipAddress === ipAddress)) {
    throw new AppError(409, 'IP address unit sudah terdaftar.');
  }

  unit.name = name;
  unit.ipAddress = ipAddress;
  unit.status = status;
  unit.lastHeartbeat = Date.now();
  writeAudit(user, 'UPDATE_UNIT', unit.id, { name, ipAddress, status });
  res.json(toUnitDto(unit));
});

mvpRouter.delete('/units/:id', (req, res) => {
  const user = requireAdmin(req);
  const unit = findUnit(req.params.id);
  if (findActiveSessionByUnit(unit.id)) {
    throw new AppError(409, 'Unit dengan sesi aktif tidak dapat dihapus.');
  }
  units.delete(unit.id);
  writeAudit(user, 'DELETE_UNIT', unit.id, { name: unit.name });
  res.status(204).send();
});

mvpRouter.get('/sessions', (req, res) => {
  requireAuth(req);
  res.json(Array.from(sessions.values()).map(toSessionDto));
});

mvpRouter.get('/sessions/active', (req, res) => {
  requireAuth(req);
  res.json(Array.from(sessions.values()).filter((session) => session.state === 'ACTIVE').map(toSessionDto));
});

mvpRouter.post('/units/:id/sessions', asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const unit = findUnit(req.params.id);
  if (unit.status !== 'IDLE' || findActiveSessionByUnit(unit.id)) {
    throw new AppError(409, 'Sesi hanya dapat dimulai pada unit Idle.');
  }

  const durationMinutes = readPositiveMinutes(req.body?.durationMinutes ?? req.body?.duration_minutes, 60);
  const customerType = assertCustomerType(req.body?.customerType ?? req.body?.customer_type);
  const customerName = req.body?.customerName ? String(req.body.customerName) : null;
  const now = Date.now();
  const initialCharge: SessionCharge = {
    type: 'INITIAL',
    minutes: durationMinutes,
    amount: calculateCost(customerType, durationMinutes),
    createdAt: now,
  };
  const session: RentalSession = {
    id: crypto.randomUUID(),
    unitId: unit.id,
    customerType,
    customerName,
    startTime: now,
    endTime: now + durationMinutes * 60 * 1000,
    actualEndTime: null,
    totalCost: initialCharge.amount,
    state: 'ACTIVE',
    charges: [initialCharge],
  };

  unit.status = 'ACTIVE';
  unit.lastHeartbeat = now;
  sessions.set(session.id, session);
  scheduleAutoShutdown(session);
  const commandResults = [await sendLanCommand(unit, 'power_on'), await sendLanCommand(unit, 'unlock')];
  writeAudit(user, 'START_SESSION', session.id, { unitId: unit.id, durationMinutes, customerType });
  res.status(201).json({ session: toSessionDto(session), unit: toUnitDto(unit), commandResults });
}));

mvpRouter.post('/sessions/:id/extend', (req, res) => {
  const user = requireAuth(req);
  const session = findSession(req.params.id);
  if (session.state !== 'ACTIVE') {
    throw new AppError(409, 'Sesi yang sudah selesai tidak dapat diperpanjang.');
  }
  const additionalMinutes = readPositiveMinutes(req.body?.additionalMinutes ?? req.body?.additional_minutes, 30);
  const charge: SessionCharge = {
    type: 'EXTENSION',
    minutes: additionalMinutes,
    amount: calculateCost(session.customerType, additionalMinutes),
    createdAt: Date.now(),
  };
  session.endTime += additionalMinutes * 60 * 1000;
  session.totalCost += charge.amount;
  session.charges.push(charge);
  scheduleAutoShutdown(session);
  writeAudit(user, 'EXTEND_SESSION', session.id, { additionalMinutes });
  res.json(toSessionDto(session));
});

mvpRouter.post('/sessions/:id/end', asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const session = findSession(req.params.id);
  const confirmed = Boolean(req.body?.confirmed ?? req.body?.confirm);
  if (!confirmed) {
    throw new AppError(400, 'Konfirmasi wajib dikirim untuk mengakhiri sesi.');
  }
  if (session.state !== 'ACTIVE') {
    throw new AppError(409, 'Sesi sudah selesai.');
  }

  const unit = findUnit(session.unitId);
  session.state = 'ENDED_EARLY';
  session.actualEndTime = Date.now();
  unit.status = 'IDLE';
  unit.lastHeartbeat = Date.now();
  clearSessionTimer(session.id);
  const commandResult = await sendLanCommand(unit, 'power_off');
  writeAudit(user, 'END_SESSION', session.id, { unitId: unit.id });
  res.json({ session: toSessionDto(session), unit: toUnitDto(unit), commandResult });
}));

mvpRouter.post('/units/:id/commands', asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const unit = findUnit(req.params.id);
  const command = assertAgentCommand(req.body?.command);
  const result = await sendLanCommand(unit, command);
  if (command === 'lock' || command === 'power_off') unit.status = 'IDLE';
  if (command === 'unlock' || command === 'power_on') unit.status = findActiveSessionByUnit(unit.id) ? 'ACTIVE' : 'IDLE';
  unit.lastHeartbeat = Date.now();
  writeAudit(user, 'SEND_COMMAND', unit.id, { command, result });
  res.json({ unit: toUnitDto(unit), result });
}));

mvpRouter.get('/reports/daily', (req, res) => {
  requireAuth(req);
  const today = new Date().toISOString().slice(0, 10);
  const date = String(req.query.date ?? today);
  res.json(buildDailyReport(date));
});

mvpRouter.get('/audit-logs', (req, res) => {
  requireAdmin(req);
  res.json(auditLogs.slice(0, 200));
});
