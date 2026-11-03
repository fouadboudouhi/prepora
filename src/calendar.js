// The fixed times as a calendar file: each repeats every week and blocks the time in the phone's own calendar.
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const SHOP_MINUTES = 45;
const NOTICE_MINUTES = 15;

function nextDate(weekday, from) {
  const at = new Date(from);
  at.setDate(at.getDate() + ((weekday - at.getDay() + 7) % 7));
  return `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
}

function event({ uid, title, weekday, time, minutes }, from, stamp) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@prepora`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${title}`,
    // No time zone on purpose: the block stays at this time wherever the phone is.
    `DTSTART:${nextDate(weekday, from)}T${time.replace(':', '')}00`,
    `DURATION:PT${minutes}M`,
    `RRULE:FREQ=WEEKLY;BYDAY=${CODES[weekday]}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    `TRIGGER:-PT${NOTICE_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

export function calendarText(profile, from = new Date()) {
  const stamp = from.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const minutes = profile.cookMinutes ?? 90;
  const events = [
    {
      uid: 'cook-1',
      title: 'Kochen',
      weekday: profile.cookWeekday ?? 0,
      time: profile.cookTime ?? '10:00',
      minutes,
    },
    ...((profile.cookDays ?? 1) === 2
      ? [
          {
            uid: 'cook-2',
            title: 'Kochen',
            weekday: profile.cookWeekday2 ?? 3,
            time: profile.cookTime2 ?? '18:00',
            minutes,
          },
        ]
      : []),
    {
      uid: 'shop',
      title: 'Einkaufen',
      weekday: profile.shopWeekday ?? 6,
      time: profile.shopTime ?? '17:00',
      minutes: SHOP_MINUTES,
    },
  ];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prepora//DE',
    ...events.flatMap((entry) => event(entry, from, stamp)),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// Handed to the phone's share sheet where it can take files, otherwise downloaded. False when neither worked.
export async function shareCalendar(profile) {
  const file = new File([calendarText(profile)], 'prepora-zeiten.ics', { type: 'text/calendar' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Prepora-Zeiten' });
      return true;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    return true;
  } catch (err) {
    // Closing the share sheet is a decision, not a failure.
    return err?.name === 'AbortError';
  }
}
