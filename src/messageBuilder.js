/**
 * Message Builder
 * Constructs formatted Telegram messages for Peninei Halacha posts.
 */

/**
 * Escape Markdown v1 special characters for Telegram.
 * Only the 4 chars Telegram Markdown v1 needs: _ * ` [
 */
export function escMd(s) {
  return (s || '').replace(/([_*`\[])/g, '\\$1');
}

/**
 * Build caption for an audio/text message.
 * @param {{ url: string, title: string, audioUrl: string|null }} halacha
 * @param {number} index - 0 for first halacha, 1 for second
 * @returns {string} Markdown-formatted caption
 */
export function buildCaption(halacha, index) {
  const label = index === 0 ? 'א' : 'ב';
  const safeUrl = halacha.url.replace(/\)/g, '%29');
  return `📖 *הלכה ${label}:* ${escMd(halacha.title)}\n🔗 [לקריאה באתר](${safeUrl})`;
}

/**
 * Build the welcome message for new subscribers.
 */
export function buildWelcomeMessage() {
  return (
    '🕯️ ברוכים הבאים!\n\n' +
    'כל יום בשעה 5:00 תקבלו שתי הלכות מוקלטות מ"הפנינה היומית" של פניני הלכה.\n\n' +
    '/today — הלכות היום עכשיו\n' +
    '/stop — הפסקה'
  );
}
