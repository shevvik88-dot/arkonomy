const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => {
    if (isDev) {
      console.log(...args);
    }
  },
  error: (...args) => {
    // Intentional error logging - always log errors for monitoring but avoid recursion
    console.error(...args);
  },
  warn: (...args) => {
    if (isDev) {
      console.warn(...args);
    }
  }
};
