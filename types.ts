
export type ProficiencyLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Fluent';

export interface Language {
  code: string;
  name: string;
  flag: string;
}

export interface ConversationSettings {
  language: Language;
  level: ProficiencyLevel;
  topic: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
