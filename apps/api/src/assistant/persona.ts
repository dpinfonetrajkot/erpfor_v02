/**
 * The assistant's manner: greets by name and time of day, answers small talk (thanks, bye, "who are you"),
 * in plain friendly English with the Gujarati / Hindi words staff use. Plain rules - no outside service.
 */

export type SmallTalk = 'greeting' | 'how_are_you' | 'thanks' | 'bye' | 'who' | 'help' | 'date' | 'praise';

const PATTERNS: [SmallTalk, RegExp][] = [
  ['how_are_you', /^(how are you|how r u|how are u|how do you do|how is it going|kem cho|kem chho|kaise ho|kya haal|kem che|majama)\b/],
  ['greeting', /^(hi+|hello+|hey+|hii+|namaste|namaskar|jai shree krishna|jay shree krishna|ram ram|good (morning|afternoon|evening|day)|morning|start)\b/],
  ['thanks', /^(thanks?|thank (you|u)|thx|ty|tnx|dhanyavad|dhanyawad|aabhar|abhar|shukriya|ok thanks|okay thanks|thanks a lot|many thanks)\b/],
  ['praise', /^(good job|well done|nice|great|super|awesome|perfect|excellent|very good|mast|saras|bahut badhiya|badhiya|cool)\b/],
  ['bye', /^(bye+|good ?bye|good night|see you|see ya|tata|avjo|aavjo|chalo bye|ok bye)\b/],
  ['who', /^(who are you|what are you|what is your name|your name|are you (a )?(human|robot|bot|ai|real)|who made you|who built you|tame kon cho|tu kon che|aap kaun ho)\b/],
  ['help', /^(help|menu|what can (you|i) (do|ask)|what do you do|how (do i|to|can i) use (this|you|ask erp)|examples?|options|what should i ask)\b/],
  ['date', /^(what('?s| is) (the )?(date|day|time)( today)?|today('?s)? date|aaje (shu|kai) tarikh|which (financial )?year)\b/],
];

/** The kind of small talk, or null for a real question. Only short messages count ("thanks, show stock" is a question). */
export function smallTalk(raw: string): SmallTalk | null {
  const q = raw.toLowerCase().replace(/[!.?,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q || q.split(' ').length > 7) return null;
  for (const [kind, re] of PATTERNS) if (re.test(q)) return kind;
  return null;
}

/** Hour of the day in India. */
export const istHour = () => new Date(Date.now() + 330 * 60_000).getUTCHours();

export function timeGreeting(hour = istHour()): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Short replies for small talk that needs no data. */
export function smallTalkText(kind: Exclude<SmallTalk, 'greeting' | 'help' | 'date'>, name: string, company: string): { title: string; text: string } {
  const n = firstName(name);
  switch (kind) {
    case 'how_are_you':
      return { title: `Hello, ${n}`, text: 'I am well, thank you. Here is an overview of today.' };
    case 'thanks':
      return { title: `You're welcome, ${n}`, text: 'Let me know if you need anything else.' };
    case 'praise':
      return { title: `Thank you, ${n}`, text: 'Is there anything else I can help you with?' };
    case 'bye':
      return { title: istHour() >= 19 ? `Good night, ${n}` : `Goodbye, ${n}`, text: 'Have a good day.' };
    case 'who':
      return {
        title: 'About the ERP Assistant',
        text:
          `I am the ERP Assistant of ${company}. I answer questions on orders, stock, production, accounts and HR using live ERP data, and guide you through processes step by step. ` +
          'I show only the information your role is allowed to see. All data stays on the company server.',
      };
  }
}
