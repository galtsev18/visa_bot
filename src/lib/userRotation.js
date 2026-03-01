import { log } from './utils.js';

/**
 * Get the next user to check based on rotation priority
 * @param {Array<User>} users - Array of active users
 * @param {number} cooldown - Cooldown period in seconds
 * @returns {User|null}
 */
export function getNextUser(users, cooldown = 30) {
  if (!users || users.length === 0) {
    return null;
  }

  // Filter users who need appointments
  const activeUsers = users.filter((user) => user.active && user.needsAppointment());

  if (activeUsers.length === 0) {
    return null;
  }

  const now = new Date();
  const cooldownMs = cooldown * 1000;

  // Calculate priority for each user
  const usersWithPriority = activeUsers.map((user) => {
    let priority = 0;

    if (user.lastChecked) {
      const timeSinceLastCheck = now - user.lastChecked;
      priority = timeSinceLastCheck / 1000; // Priority in seconds

      // Bonus priority if user hasn't been checked in cooldown period
      if (timeSinceLastCheck > cooldownMs) {
        priority += 1000; // Large bonus
      }
    } else {
      // User never checked, give high priority
      priority = 10000;
    }

    // Lower priority if user recently got appointment
    if (user.lastBooked) {
      const timeSinceLastBooked = now - new Date(user.lastBooked);
      if (timeSinceLastBooked < 24 * 60 * 60 * 1000) {
        // Within 24 hours
        priority *= 0.1; // Reduce priority significantly
      }
    }

    // Add user's stored priority
    priority += user.priority;

    return { user, priority };
  });

  // Sort by priority (descending)
  usersWithPriority.sort((a, b) => b.priority - a.priority);

  const selected = usersWithPriority[0];
  log(`Selected user ${selected.user.email} with priority ${selected.priority.toFixed(2)}`);

  return selected.user;
}

/**
 * Update user priority after check
 * @param {User} user - User object
 * @param {Date} checkedAt - When user was checked
 */
export function updateUserPriority(user, checkedAt) {
  // Reset priority to 0 after check
  user.priority = 0;
  user.lastChecked = checkedAt;
}

/**
 * Get rotation statistics
 * @param {Array<User>} users - Array of users
 * @returns {Object}
 */
export function getRotationStats(users) {
  const activeUsers = users.filter((user) => user.active && user.needsAppointment());
  const now = new Date();

  const stats = {
    total: users.length,
    active: activeUsers.length,
    checkedRecently: 0,
    needsCheck: 0,
  };

  for (const user of activeUsers) {
    if (user.lastChecked) {
      const timeSinceCheck = (now - user.lastChecked) / 1000; // seconds
      if (timeSinceCheck < 60) {
        stats.checkedRecently++;
      } else {
        stats.needsCheck++;
      }
    } else {
      stats.needsCheck++;
    }
  }

  return stats;
}
