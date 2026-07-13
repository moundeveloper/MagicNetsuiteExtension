import type { SkillConversationSource } from "./skillsDb";

const STOP_WORDS = new Set([
  "about", "after", "also", "could", "from", "have", "into", "please", "should",
  "that", "their", "there", "these", "they", "this", "what", "when", "where", "which",
  "with", "would", "your"
]);

const cleanPrompt = (prompt: string): string =>
  prompt.replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();

const titleFromPrompt = (prompt: string): string => {
  const words = cleanPrompt(prompt).replace(/[^a-zA-Z0-9\s-]/g, "").split(/\s+/).filter(Boolean).slice(0, 8);
  const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return title || "Saved Conversation Skill";
};

const tagsFromPrompt = (prompt: string): string => {
  const tags = cleanPrompt(prompt).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  return [...new Set(tags.filter((tag) => !STOP_WORDS.has(tag)))].slice(0, 8).join(", ");
};

const triggersFromPrompt = (prompt: string): string => {
  const question = cleanPrompt(prompt);
  const sentenceTriggers = question
    .split(/[?.!;]+/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).length >= 2)
    .map((part) => part.slice(0, 180));
  const keywords = (question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word));
  const compactTrigger = [...new Set(keywords)].slice(0, 8).join(" ");
  return [...new Set([...sentenceTriggers, compactTrigger].filter(Boolean))].slice(0, 5).join("\n");
};

export interface CapturedSkillDraft {
  name: string;
  description: string;
  tags: string;
  triggers: string;
  content: string;
  sourceConversation: SkillConversationSource;
}

export const captureAnswerAsSkill = (
  userPrompt: string,
  assistantResponse: string,
  metadata: { threadId?: string; turnId?: string } = {}
): CapturedSkillDraft => {
  const question = cleanPrompt(userPrompt);
  const name = titleFromPrompt(question);
  const savedAt = new Date().toISOString();
  return {
    name,
    description: `Reusable guidance captured from: ${question.slice(0, 150)}`,
    tags: tagsFromPrompt(question),
    triggers: triggersFromPrompt(question),
    content: `# ${name}\n\n## When To Use\n\nUse when the user asks about:\n\n- ${question}\n\n## Instructions\n\n${assistantResponse.trim()}`,
    sourceConversation: {
      ...metadata,
      userPrompt: question,
      assistantResponse: assistantResponse.trim(),
      savedAt
    }
  };
};
