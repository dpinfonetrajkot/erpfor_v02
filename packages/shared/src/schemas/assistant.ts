import { z } from 'zod';

/**
 * "Ask ERP": staff type a question, the API works out what is asked and answers from the ERP data.
 * Everything runs inside the ERP (no outside AI service); each answer follows the asker's permissions.
 */

const contextParams = z.record(z.string().max(40), z.union([z.string().max(100), z.number()]));

export const assistantQuestionSchema = z.object({
  question: z.string().trim().min(1, 'Type a question').max(300, 'Keep the question under 300 letters'),
  /** What the previous answer was about, so "and last month?" works as a follow-up. */
  context: z.object({ topic: z.string().max(40), params: contextParams }).optional(),
});
export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>;

export interface AssistantAnswer {
  /** Which kind of question it was taken as; null when it was not understood. */
  topic: string | null;
  /** Short line saying how the question was read, e.g. "Raw material stock · 4130 90 MM ROUND". */
  understood?: string;
  /** e.g. Read "atendance" as "attendance". */
  note?: string;
  text: string;
  facts?: { label: string; value: string; tone?: 'good' | 'bad' }[];
  table?: { columns: { label: string; align?: 'right' }[]; rows: string[][]; more?: number };
  /** Numbered steps ("how do I ..." answers). */
  steps?: string[];
  /** One short extra line worth noticing, e.g. "12% more than last month". */
  insight?: string;
  /**
   * A small chart: `bars` = one value per row (by customer, by stage …), `columns` = over time (one or two series).
   * The numbers in it are also in the text / table, so the chart is never the only place to read them.
   */
  chart?: {
    kind: 'bars' | 'columns';
    title: string;
    unit: 'money' | 'qty' | 'count';
    series: string[];
    points: { label: string; values: number[] }[];
  };
  /** Buttons that start work (e.g. a new invoice for this customer); shown as main buttons. */
  actions?: { label: string; href: string }[];
  /** Screens to open for the full picture. */
  links?: { label: string; href: string }[];
  /** Questions to try next. */
  suggestions?: string[];
  /** Sent back with the next question for follow-ups. */
  context?: { topic: string; params: Record<string, string | number> };
}

/** "Was this helpful?" on an answer - kept in the API log so the questions it gets wrong can be added. */
export const assistantFeedbackSchema = z.object({
  question: z.string().trim().min(1).max(300),
  topic: z.string().max(40).nullable(),
  helpful: z.boolean(),
});
export type AssistantFeedback = z.infer<typeof assistantFeedbackSchema>;

export interface AssistantExamples {
  areas: { area: string; examples: string[] }[];
}
