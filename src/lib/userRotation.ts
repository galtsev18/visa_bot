import type { User } from '../ports/User';
import { logger } from './logger';

export function getNextUser(users: User[], cooldown = 30): User | null {
  if (!users || users.length === 0) return null;

  const activeUsers = users.filter((user) => user.active && user.needsAppointment());
  if (activeUsers.length === 0) return null;

  const now = new Date();
  const cooldownMs = cooldown * 1000;

  const usersWithPriority = activeUsers.map((user) => {
    let priority = 0;

    if (user.lastChecked) {
      const timeSinceLastCheck = now.getTime() - user.lastChecked.getTime();
      priority = timeSinceLastCheck / 1000;
      if (timeSinceLastCheck > cooldownMs) priority += 1000;
    } else {
      priority = 10000;
    }

    if (user.lastBooked) {
      const timeSinceLastBooked = now.getTime() - new Date(user.lastBooked).getTime();
      if (timeSinceLastBooked < 24 * 60 * 60 * 1000) priority *= 0.1;
    }

    priority += user.priority;
    return { user, priority };
  });

  usersWithPriority.sort((a, b) => b.priority - a.priority);
  const selected = usersWithPriority[0];
  logger.info(`Selected user ${selected.user.email} with priority ${selected.priority.toFixed(2)}`);

  return selected.user;
}

export function updateUserPriority(user: User, checkedAt: Date): void {
  (user as { priority: number; lastChecked: Date | null }).priority = 0;
  (user as { lastChecked: Date | null }).lastChecked = checkedAt;
}

export interface RotationStats {
  total: number;
  active: number;
  checkedRecently: number;
  needsCheck: number;
}

export function getRotationStats(users: User[]): RotationStats {
  const activeUsers = users.filter((user) => user.active && user.needsAppointment());
  const now = new Date();

  const stats: RotationStats = {
    total: users.length,
    active: activeUsers.length,
    checkedRecently: 0,
    needsCheck: 0,
  };

  for (const user of activeUsers) {
    if (user.lastChecked) {
      const timeSinceCheck = (now.getTime() - user.lastChecked.getTime()) / 1000;
      if (timeSinceCheck < 60) stats.checkedRecently++;
      else stats.needsCheck++;
    } else {
      stats.needsCheck++;
    }
  }

  return stats;
}
