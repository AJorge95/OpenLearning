export type Role = 'admin' | 'moderator' | 'learner';

export interface User {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt?: string;
}

export interface QuizChoice {
  id?: string;
  text: string;
  isCorrect?: boolean;
}

export interface QuizQuestion {
  id?: string;
  prompt: string;
  explanation?: string;
  choices: QuizChoice[];
}

export interface QuizAttempt {
  id: string;
  score: number;
  passed: boolean;
  passMark?: number;
  submittedAt?: string;
  questions?: Array<QuizQuestion & { correctChoiceId: string; selectedChoiceId: string }>;
}

export interface Quiz {
  id: string;
  title: string;
  passMark: number;
  questions: QuizQuestion[];
  latestAttempt: QuizAttempt | null;
  passed: boolean;
}

export interface LessonResource {
  id: string;
  kind: 'link' | 'document';
  title: string;
  url: string;
  fileName: string | null;
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  position: number;
  mediaId: string | null;
  mediaUrl: string | null;
  videoName: string | null;
  hasVideo: boolean;
  resources: LessonResource[];
  completed: boolean;
}

export interface CourseModule {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
  quiz: Quiz | null;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  visibility: 'public' | 'private';
  status: 'draft' | 'published' | 'archived';
  coverMediaId: string | null;
  coverUrl: string | null;
  createdBy: string;
  owner: string;
  updatedAt: string;
  moduleCount: number;
  lessonCount: number;
  completedLessons: number;
  progress: number;
  completed: boolean;
  modules?: CourseModule[];
}

export interface CourseAccessUser {
  id: string;
  username: string;
  disabled: boolean;
  granted: boolean;
  grantedAt: string | null;
  grantedBy: string | null;
}

