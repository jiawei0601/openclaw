import fs from 'fs';

const SCHEDULES_FILE = process.env.SCHEDULES_FILE || '/tmp/schedules.json';

// Accepted formats:
//   daily at HH:MM
//   weekday at HH:MM   (Mon–Fri)
//   every N hours      (1–24)
export function validate(expr) {
    const daily   = expr.match(/^daily at (\d{2}):(\d{2})$/);
    const weekday = expr.match(/^weekday at (\d{2}):(\d{2})$/);
    const every   = expr.match(/^every (\d+) hours?$/);
    if (!daily && !weekday && !every) return false;
    if (daily || weekday) {
        const [, h, m] = daily || weekday;
        if (+h > 23 || +m > 59) return false;
    }
    if (every && (+every[1] < 1 || +every[1] > 24)) return false;
    return true;
}

export function load() {
    try {
        if (fs.existsSync(SCHEDULES_FILE)) {
            return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
        }
    } catch {}
    return {};
}

// Atomic write: temp file + rename prevents partial-write corruption
export function save(schedules) {
    const tmp = SCHEDULES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(schedules, null, 2), 'utf8');
    fs.renameSync(tmp, SCHEDULES_FILE);
}

function getTaiwanTime() {
    const tw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    return { hour: tw.getHours(), minute: tw.getMinutes(), day: tw.getDay() };
}

export function shouldFire(expr, lastFired) {
    const { hour, minute, day } = getTaiwanTime();
    const now    = Date.now();
    const lastMs = lastFired ? new Date(lastFired).getTime() : 0;
    const fiveMin = 5 * 60 * 1000;

    const daily = expr.match(/^daily at (\d{2}):(\d{2})$/);
    if (daily) return hour === +daily[1] && minute === +daily[2] && now - lastMs > fiveMin;

    const weekday = expr.match(/^weekday at (\d{2}):(\d{2})$/);
    if (weekday) return day >= 1 && day <= 5 && hour === +weekday[1] && minute === +weekday[2] && now - lastMs > fiveMin;

    const every = expr.match(/^every (\d+) hours?$/);
    if (every) return now - lastMs >= +every[1] * 60 * 60 * 1000;

    return false;
}
