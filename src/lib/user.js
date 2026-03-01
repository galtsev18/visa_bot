import { parseDateRanges, isDateInRanges, formatDate } from './dateParser.js';

export class User {
  constructor(data) {
    this.email = data.email;
    this.password = data.password;
    this.countryCode = data.country_code;
    this.scheduleId = data.schedule_id;
    // Sheet may store "YYYY-MM-DD HH:mm"; we keep date only for logic
    this.currentDate = (data.current_date || '').toString().trim().slice(0, 10) || null;
    this.reactionTime = Number(data.reaction_time) || 0; // days
    this.active = data.active === true || data.active === 'true' || data.active === 'TRUE';
    this.lastChecked = data.last_checked ? new Date(data.last_checked) : null;
    this.lastBooked = (data.last_booked || '').toString().trim().slice(0, 10) || null;
    this.priority = Number(data.priority) || 0;
    this.provider = (data.provider || 'ais').toLowerCase();
    /** 1-based row index in Users sheet (set by readUsers to avoid extra API reads) */
    this.rowIndex = data.rowIndex != null ? Number(data.rowIndex) : null;

    // Parse date ranges from JSON string
    let dateRanges = [];
    if (data.date_ranges) {
      try {
        const rangesJson = typeof data.date_ranges === 'string' 
          ? JSON.parse(data.date_ranges) 
          : data.date_ranges;
        dateRanges = parseDateRanges(rangesJson);
      } catch (e) {
        console.error(`Failed to parse date ranges for user ${this.email}:`, e);
      }
    }
    this.dateRanges = dateRanges;
  }

  /**
   * Check if a date is after the reaction time (today + reaction_time days)
   * @param {Date|string} date - Date to check
   * @returns {boolean}
   */
  isDateAfterReactionTime(date) {
    if (this.reactionTime <= 0) {
      return true; // No reaction time constraint
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minDate = new Date(today);
    minDate.setDate(today.getDate() + this.reactionTime);

    let dateObj = date;
    if (typeof date === 'string') {
      dateObj = new Date(date + 'T00:00:00');
    }

    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
      return false;
    }

    dateObj.setHours(0, 0, 0, 0);
    return dateObj >= minDate;
  }

  /**
   * Check if a date falls within any of the user's acceptable date ranges
   * @param {Date|string} date - Date to check
   * @returns {boolean}
   */
  isDateInRange(date) {
    return isDateInRanges(date, this.dateRanges);
  }

  /**
   * Check if a date is earlier than the current booked date
   * @param {Date|string} date - Date to check
   * @returns {boolean}
   */
  isDateEarlierThanCurrent(date) {
    if (!this.currentDate) {
      return true; // No current date, any date is acceptable
    }

    let dateObj = date;
    if (typeof date === 'string') {
      dateObj = new Date(date + 'T00:00:00');
    }

    const currentDateObj = new Date(this.currentDate + 'T00:00:00');

    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
      return false;
    }

    dateObj.setHours(0, 0, 0, 0);
    currentDateObj.setHours(0, 0, 0, 0);

    return dateObj < currentDateObj;
  }

  /**
   * Combined validation: check if date is valid for this user
   * @param {Date|string} date - Date to validate
   * @returns {boolean}
   */
  isDateValid(date) {
    return (
      this.isDateEarlierThanCurrent(date) &&
      this.isDateInRange(date) &&
      this.isDateAfterReactionTime(date)
    );
  }

  /**
   * Check if user still needs an appointment
   * User needs appointment if current date is not in any acceptable range
   * @returns {boolean}
   */
  needsAppointment() {
    if (!this.currentDate) {
      return true; // No current date, needs appointment
    }

    // Check if current date is in any acceptable range
    return !this.isDateInRange(this.currentDate);
  }

  /**
   * Get the minimum date that can be booked (today + reaction_time)
   * @returns {Date}
   */
  getMinBookingDate() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + this.reactionTime);
    return minDate;
  }

  /**
   * Convert user to plain object for storage
   * @returns {Object}
   */
  toObject() {
    return {
      email: this.email,
      password: this.password,
      country_code: this.countryCode,
      schedule_id: this.scheduleId,
      current_date: this.currentDate,
      reaction_time: this.reactionTime,
      date_ranges: this.dateRanges.length > 0 
        ? JSON.stringify(this.dateRanges.map(r => ({
            from: formatDate(r.from),
            to: formatDate(r.to)
          })))
        : null,
      active: this.active,
      last_checked: this.lastChecked ? this.lastChecked.toISOString() : null,
      last_booked: this.lastBooked,
      priority: this.priority
    };
  }
}
