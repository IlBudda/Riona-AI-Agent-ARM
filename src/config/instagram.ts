// ===================== CONFIGURAZIONI INSTAGRAM BOT =====================
export const INSTAGRAM_CONFIG = {
  // Orari di lavoro con range randomici (formato 24h)
  WORKING_HOURS: {
    START: {
      MIN: { hour: 7, minute: 30 },  // 7:30
      MAX: { hour: 8, minute: 30 }   // 8:30
    },
    END: {
      MIN: { hour: 19, minute: 30 }, // 19:30
      MAX: { hour: 20, minute: 30 }  // 20:30
    }
  },
  
  // Pause e timing (in millisecondi)
  DELAYS: {
    BETWEEN_POSTS: {
      MIN: 600000,   // 10 minuti (minimo)
      MAX: 1200000   // 20 minuti (massimo)
    },
    AFTER_LIKE: 2000,           // 2 secondi
    AFTER_INTERACTION: 30000,   // 30 secondi prima del refresh
    AFTER_COMMENT_CLICK: 500,   // 0.5 secondi
    AFTER_COMMENT_TYPE: 1000,   // 1 secondo
    AFTER_COMMENT_POST: 3000,   // 3 secondi
    EXPAND_CAPTION: 1000,       // 1 secondo
    KEYBOARD_DELAY: 500         // 0.5 secondi
  },
  
  // Altre impostazioni
  MAX_POSTS_PER_SESSION: 50,
  
  // Programma di lavoro
  WORK_SCHEDULE: {
    USE_WORKING_HOURS: true,    // true = rispetta gli orari di lavoro, false = lavora 24/7
    WORK_ON_WEEKEND: false      // true = lavora anche sabato e domenica, false = solo lunedì-venerdì
  }
};

// Funzioni di utilità per la gestione degli orari
export interface Time {
  hour: number;
  minute: number;
}

export interface WorkingHours {
  START: {
    MIN: Time;
    MAX: Time;
  };
  END: {
    MIN: Time;
    MAX: Time;
  };
}

// Variabili per memorizzare gli orari randomici della sessione corrente
let currentStartTime: Time | null = null;
let currentEndTime: Time | null = null;

// Funzione per generare un orario randomico tra min e max
function getRandomTime(min: Time, max: Time): Time {
  const minTotalMinutes = min.hour * 60 + min.minute;
  const maxTotalMinutes = max.hour * 60 + max.minute;
  
  const randomTotalMinutes = Math.floor(Math.random() * (maxTotalMinutes - minTotalMinutes + 1)) + minTotalMinutes;
  
  return {
    hour: Math.floor(randomTotalMinutes / 60),
    minute: randomTotalMinutes % 60
  };
}

// Funzione per inizializzare gli orari della sessione corrente
export function initializeSessionTimes(): void {
  currentStartTime = getRandomTime(INSTAGRAM_CONFIG.WORKING_HOURS.START.MIN, INSTAGRAM_CONFIG.WORKING_HOURS.START.MAX);
  currentEndTime = getRandomTime(INSTAGRAM_CONFIG.WORKING_HOURS.END.MIN, INSTAGRAM_CONFIG.WORKING_HOURS.END.MAX);
  
  console.log(`🔄 Session times initialized: ${formatTime(currentStartTime)} - ${formatTime(currentEndTime)}`);
}

// Funzione per formattare l'orario
export function formatTime(time: Time): string {
  return `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
}

// Funzione per verificare se l'orario corrente è negli orari di lavoro
export function isWithinWorkingHours(): boolean {
  if (!currentStartTime || !currentEndTime) {
    initializeSessionTimes();
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  const startTotalMinutes = currentStartTime!.hour * 60 + currentStartTime!.minute;
  const endTotalMinutes = currentEndTime!.hour * 60 + currentEndTime!.minute;
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  
  return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;
}

// Funzione per calcolare il tempo fino al prossimo periodo di lavoro
export function getTimeUntilWorkingHours(): number {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  
  if (!currentStartTime) {
    initializeSessionTimes();
  }
  
  const startTotalMinutes = currentStartTime!.hour * 60 + currentStartTime!.minute;
  
  if (currentTotalMinutes < startTotalMinutes) {
    // Prima dell'orario di inizio - aspetta fino all'orario di inizio oggi
    const target = new Date(now);
    target.setHours(currentStartTime!.hour, currentStartTime!.minute, 0, 0);
    return target.getTime() - now.getTime();
  } else {
    // Dopo l'orario di fine - aspetta fino all'orario di inizio domani
    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(currentStartTime!.hour, currentStartTime!.minute, 0, 0);
    return target.getTime() - now.getTime();
  }
}

// Funzione per ottenere un delay randomico tra min e max
export function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Funzione per verificare se oggi è un giorno lavorativo
export function isWorkDay(): boolean {
  const dayOfWeek = new Date().getDay(); // 0 = Domenica, 1 = Lunedì, ..., 6 = Sabato
  
  if (INSTAGRAM_CONFIG.WORK_SCHEDULE.WORK_ON_WEEKEND) {
    return true; // Lavora tutti i giorni
  } else {
    return dayOfWeek >= 1 && dayOfWeek <= 5; // Solo lunedì-venerdì (1-5)
  }
}

// Funzione combinata che verifica sia l'orario che il giorno lavorativo
export function shouldWork(): boolean {
  const isDayOk = INSTAGRAM_CONFIG.WORK_SCHEDULE.WORK_ON_WEEKEND ? true : isWorkDay();
  const isTimeOk = INSTAGRAM_CONFIG.WORK_SCHEDULE.USE_WORKING_HOURS ? isWithinWorkingHours() : true;
  
  return isDayOk && isTimeOk;
}
